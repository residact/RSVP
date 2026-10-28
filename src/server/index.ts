// Serveur HTTP (Bun.serve) : interface web, API REST, flux SSE et MCP.
import path from "node:path";
import type { Settings, TextItem } from "../shared/types.ts";
import { Books } from "./books.ts";
import { config } from "./config.ts";
import { handleMcp } from "./mcp.ts";
import { HttpError, Store, events } from "./store.ts";

const store = new Store(config.dataDir, config.token);
const books = new Books(config.dataDir);

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-api-key, mcp-session-id, mcp-protocol-version",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const fail = (status: number, message: string) => json(status, { error: message });

function baseUrl(req: Request): string {
  if (config.publicUrl) return config.publicUrl;
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${req.headers.get("x-forwarded-host") ?? req.headers.get("host")}`;
}

function authorized(req: Request, url: URL): boolean {
  const h = req.headers.get("authorization") ?? "";
  const bearer = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  return store.checkToken(bearer || req.headers.get("x-api-key") || url.searchParams.get("token"));
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (raw.length > config.maxBody) throw new HttpError(413, "Corps trop volumineux (2 Mo max).");
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, "JSON invalide.");
  }
}

function sse(req: Request): Response {
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const onText = ({ text: _text, ...meta }: TextItem) => send("text", meta);
      const onSettings = (s: Settings) => send("settings", s);
      events.on("text", onText);
      events.on("settings", onSettings);
      const ping = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 20_000);
      cleanup = () => {
        clearInterval(ping);
        events.off("text", onText);
        events.off("settings", onSettings);
      };
      req.signal.addEventListener("abort", cleanup);
      send("hello", { ok: true });
    },
    cancel: () => cleanup(),
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
}

async function api(req: Request, url: URL, server: Bun.Server<undefined>): Promise<Response> {
  const { pathname } = url;
  const m = req.method;

  if (pathname === "/api/health") return json(200, { ok: true });
  if (!authorized(req, url)) return fail(401, "Jeton manquant ou invalide.");

  if (pathname === "/api/events" && m === "GET") {
    server.timeout(req, 0);
    return sse(req);
  }
  if (pathname === "/api/info" && m === "GET") {
    const base = baseUrl(req);
    return json(200, { baseUrl: base, mcpUrl: `${base}/mcp`, token: store.token, version: "2.0.0" });
  }
  if (pathname === "/api/token/regenerate" && m === "POST") return json(200, { token: store.regenerateToken() });

  if (pathname === "/api/settings") {
    if (m === "GET") return json(200, store.settings);
    if (m === "PUT" || m === "PATCH") return json(200, store.updateSettings(await readJson(req)));
  }

  if (pathname === "/api/texts") {
    if (m === "GET") return json(200, store.list());
    if (m === "POST") {
      const b = await readJson(req);
      const item = store.add({ title: typeof b.title === "string" ? b.title : undefined, text: b.text, source: typeof b.source === "string" ? b.source : "api" });
      return json(201, { ...item, url: `${baseUrl(req)}/#/reader/${item.id}` });
    }
    if (m === "DELETE") {
      store.clear();
      return json(200, { ok: true });
    }
  }
  if (pathname === "/api/texts/latest" && m === "GET") {
    const item = store.latest();
    return item ? json(200, item) : fail(404, "Aucun texte.");
  }
  const one = pathname.match(/^\/api\/texts\/([\w-]+)$/);
  if (one?.[1]) {
    if (m === "GET") {
      const item = store.get(one[1]);
      return item ? json(200, item) : fail(404, "Texte introuvable.");
    }
    if (m === "DELETE") return store.remove(one[1]) ? json(200, { ok: true }) : fail(404, "Texte introuvable.");
  }

  if (pathname === "/api/books") {
    if (m === "GET") return json(200, books.list());
    if (m === "POST") {
      const buf = new Uint8Array(await req.arrayBuffer());
      if (!buf.length) return fail(400, "Fichier vide.");
      if (buf.length > config.maxUpload) return fail(413, "Fichier trop volumineux (100 Mo max).");
      const book = await books.add(buf, url.searchParams.get("name") ?? "");
      return json(book.duplicate ? 200 : 201, book);
    }
  }
  const bk = pathname.match(/^\/api\/books\/([a-f0-9]{12})(?:\/(cover|progress|chapters\/(\d+)))?$/);
  if (bk?.[1]) {
    const [, id, sub, chap] = bk;
    if (!sub) {
      if (m === "GET") {
        const b = books.get(id);
        return b ? json(200, b) : fail(404, "Livre introuvable.");
      }
      if (m === "DELETE") return books.remove(id) ? json(200, { ok: true }) : fail(404, "Livre introuvable.");
    }
    if (sub === "cover" && m === "GET") {
      const f = books.coverPath(id);
      if (!f) return fail(404, "Pas de couverture.");
      return new Response(Bun.file(f), { headers: { "content-type": IMAGE_TYPES[path.extname(f).toLowerCase()] ?? "image/jpeg", "cache-control": "private, max-age=86400" } });
    }
    if (chap !== undefined && m === "GET") {
      const c = books.chapter(id, Number(chap));
      return c ? json(200, c) : fail(404, "Chapitre introuvable.");
    }
    if (sub === "progress" && (m === "PUT" || m === "POST")) {
      const b = books.setProgress(id, await readJson(req));
      return b ? json(200, b) : fail(404, "Livre introuvable.");
    }
  }
  return fail(404, "Route inconnue.");
}

async function serveStatic(pathname: string): Promise<Response> {
  const root = path.resolve(config.webDir);
  const wanted = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!wanted.startsWith(root)) return fail(403, "Interdit.");
  let file = Bun.file(wanted);
  if (!(await file.exists()) || wanted === root) file = Bun.file(path.join(root, "index.html"));
  if (!(await file.exists())) return fail(503, "Interface non construite : lance « bun run build:web ».");
  return new Response(file, { headers: { "cache-control": "no-cache" } });
}

const start = (hostname: string) => Bun.serve({
  port: config.port,
  hostname,
  maxRequestBodySize: config.maxUpload + 1024,
  idleTimeout: 120,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      let res: Response;
      if (url.pathname === "/mcp") {
        if (!authorized(req, url)) res = new Response(JSON.stringify({ error: "Jeton manquant ou invalide." }), { status: 401, headers: { ...JSON_HEADERS, "www-authenticate": 'Bearer realm="rsvp"' } });
        else if (req.method !== "POST") res = fail(405, "Utilise POST (MCP Streamable HTTP, sans session).");
        else res = await handleMcp(req, store, books, baseUrl(req));
      } else if (url.pathname.startsWith("/api/")) res = await api(req, url, srv);
      else res = await serveStatic(url.pathname);
      for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
      return res;
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message);
      console.error(e);
      return fail(500, "Erreur interne.");
    }
  },
});

/** Écoute en double pile (IPv4 + IPv6) : `localhost` peut résoudre vers ::1, notamment avec Podman. */
function listen(): ReturnType<typeof start> {
  let error: unknown;
  for (const host of config.hosts) {
    try {
      return start(host);
    } catch (e) {
      error = e;
    }
  }
  throw error;
}

const server = listen();
console.log(`RSVP prêt sur http://localhost:${server.port}`);
if (!config.token) console.log(`Jeton d'accès : ${store.token}`);
else console.log("Jeton d'accès : défini par RSVP_TOKEN (.env)");

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => void server.stop().then(() => process.exit(0)));
