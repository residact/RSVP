// Serveur HTTP : interface web, API REST, flux SSE et MCP, sans framework.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, events } from "./store.js";
import { handleMcp } from "./mcp.js";
import { Books } from "./books.js";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public");
const MAX_BODY = 2 * 1024 * 1024;

const store = new Store(DATA_DIR);
const books = new Books(DATA_DIR);
const MAX_UPLOAD = 100 * 1024 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const json = (res, status, data) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
};

const fail = (res, status, message) => json(res, status, { error: message });

function baseUrl(req) {
  if (process.env.RSVP_PUBLIC_URL) return process.env.RSVP_PUBLIC_URL.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] ?? "http";
  return `${proto}://${req.headers["x-forwarded-host"] ?? req.headers.host}`;
}

function readBuffer(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error(`Corps trop volumineux (${Math.round(limit / 1048576)} Mo max).`), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const readBody = async (req) => (await readBuffer(req)).toString("utf8");

const parseJson = (raw) => {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("JSON invalide."), { status: 400 });
  }
};

function authorized(req, url) {
  const h = req.headers.authorization ?? "";
  const bearer = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  return store.checkToken(bearer || req.headers["x-api-key"] || url.searchParams.get("token"));
}

function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname));
  if (!file.startsWith(PUBLIC_DIR)) return fail(res, 403, "Interdit.");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC_DIR, "index.html");
  const ext = path.extname(file);
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  fs.createReadStream(file).pipe(res);
}

function sse(req, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const onText = ({ text, ...meta }) => send("text", meta);
  const onSettings = (s) => send("settings", s);
  events.on("text", onText);
  events.on("settings", onSettings);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  send("hello", { ok: true });
  req.on("close", () => {
    clearInterval(ping);
    events.off("text", onText);
    events.off("settings", onSettings);
  });
}

async function api(req, res, url) {
  const { pathname } = url;
  const m = req.method;

  if (pathname === "/api/health") return json(res, 200, { ok: true });
  if (!authorized(req, url)) return fail(res, 401, "Jeton manquant ou invalide.");

  if (pathname === "/api/events" && m === "GET") return sse(req, res);

  if (pathname === "/api/info" && m === "GET") {
    const base = baseUrl(req);
    return json(res, 200, { baseUrl: base, mcpUrl: `${base}/mcp`, token: store.db.token, version: "1.0.0" });
  }

  if (pathname === "/api/token/regenerate" && m === "POST") return json(res, 200, { token: store.regenerateToken() });

  if (pathname === "/api/settings") {
    if (m === "GET") return json(res, 200, store.settings);
    if (m === "PUT" || m === "PATCH") return json(res, 200, store.updateSettings(parseJson(await readBody(req))));
  }

  if (pathname === "/api/texts") {
    if (m === "GET") return json(res, 200, store.list());
    if (m === "POST") {
      const b = parseJson(await readBody(req));
      const item = store.add({ title: b.title, text: b.text, source: b.source ?? "api" });
      return json(res, 201, { ...item, url: `${baseUrl(req)}/#/reader/${item.id}` });
    }
    if (m === "DELETE") {
      store.clear();
      return json(res, 200, { ok: true });
    }
  }

  if (pathname === "/api/texts/latest" && m === "GET") {
    const item = store.latest();
    return item ? json(res, 200, item) : fail(res, 404, "Aucun texte.");
  }

  const one = pathname.match(/^\/api\/texts\/([\w-]+)$/);
  if (one) {
    if (m === "GET") {
      const item = store.get(one[1]);
      return item ? json(res, 200, item) : fail(res, 404, "Texte introuvable.");
    }
    if (m === "DELETE") return store.remove(one[1]) ? json(res, 200, { ok: true }) : fail(res, 404, "Texte introuvable.");
  }

  if (pathname === "/api/books") {
    if (m === "GET") return json(res, 200, books.list());
    if (m === "POST") {
      const buf = await readBuffer(req, MAX_UPLOAD);
      if (!buf.length) return fail(res, 400, "Fichier vide.");
      const book = await books.add(buf, url.searchParams.get("name") ?? "");
      return json(res, book.duplicate ? 200 : 201, book);
    }
  }

  const bk = pathname.match(/^\/api\/books\/([a-f0-9]{12})(?:\/(cover|progress|chapters\/(\d+)))?$/);
  if (bk) {
    const [, id, sub, chap] = bk;
    if (!sub) {
      if (m === "GET") {
        const b = books.get(id);
        return b ? json(res, 200, b) : fail(res, 404, "Livre introuvable.");
      }
      if (m === "DELETE") return books.remove(id) ? json(res, 200, { ok: true }) : fail(res, 404, "Livre introuvable.");
    }
    if (sub === "cover" && m === "GET") {
      const f = books.coverPath(id);
      if (!f) return fail(res, 404, "Pas de couverture.");
      res.writeHead(200, { "content-type": MIME[path.extname(f)] ?? "image/jpeg", "cache-control": "private, max-age=86400" });
      return void fs.createReadStream(f).pipe(res);
    }
    if (chap !== undefined && m === "GET") {
      const c = books.chapter(id, Number(chap));
      return c ? json(res, 200, c) : fail(res, 404, "Chapitre introuvable.");
    }
    if (sub === "progress" && (m === "PUT" || m === "POST")) {
      const b = books.setProgress(id, parseJson(await readBody(req)));
      return b ? json(res, 200, b) : fail(res, 404, "Livre introuvable.");
    }
  }

  return fail(res, 404, "Route inconnue.");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "authorization, content-type, x-api-key, mcp-session-id, mcp-protocol-version");
  res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return void res.writeHead(204).end();

  try {
    if (url.pathname === "/mcp") {
      if (!authorized(req, url)) {
        res.setHeader("www-authenticate", 'Bearer realm="rsvp"');
        return fail(res, 401, "Jeton manquant ou invalide.");
      }
      if (req.method !== "POST") return fail(res, 405, "Utilise POST (MCP Streamable HTTP, sans session).");
      const body = parseJson(await readBody(req));
      return await handleMcp(req, res, store, baseUrl(req), body);
    }
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    if (!res.headersSent) fail(res, e.status ?? 500, e.status ? e.message : "Erreur interne.");
    if (!e.status) console.error(e);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`RSVP prêt sur http://localhost:${PORT}`);
  console.log(`Jeton d'accès : ${store.db.token}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
