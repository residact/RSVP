// Point d'entrée : connexion, coque, routeur, flux temps réel.
import type { Settings, TextMeta } from "../shared/types.ts";
import { AuthError, api, applyAccent, h, icon, setToken, state, toast, type Cleanup, type Ctx, type IconName } from "./lib.ts";
import { bookPage, bookReaderPage, libraryPage } from "./books.ts";
import { pastePage, settingsPage } from "./pages.ts";
import { readerPage } from "./reader.ts";

document.head.append(h("link", { rel: "manifest", href: "/manifest.webmanifest" }));
const app = document.getElementById("app")!;
let cleanup: Cleanup = () => {};
let events: EventSource | null = null;

const ROUTES: { path: string; label: string; icon: IconName }[] = [
  { path: "reader", label: "Lecteur", icon: "book" },
  { path: "books", label: "Livres", icon: "library" },
  { path: "paste", label: "Coller", icon: "paste" },
  { path: "settings", label: "Config", icon: "gear" },
];

const go = (p: string): void => { location.hash = `#${p}`; };

function login(error?: string): void {
  const input = h("input", { class: "field", type: "password", placeholder: "Jeton d’accès", autocomplete: "current-password", autofocus: true });
  const msg = h("p", { class: "muted", style: "color:var(--danger);margin:0", hidden: !error }, error ?? "");
  const form = h("form", { class: "card stack", onsubmit: (e: Event) => { e.preventDefault(); setToken(input.value.trim()); void boot(); } },
    h("div", { class: "brand", style: "padding:0" }, h("div", { class: "logo" }, h("i")), h("div", {}, h("b", {}, "RSVP"), h("small", {}, "Lecteur auto-hébergé"))),
    h("p", { class: "hint", style: "margin:0" }, "Saisis le jeton RSVP_TOKEN défini dans le fichier .env (ou affiché dans les logs : ", h("code", {}, "bun run docker:logs"), ")."),
    input, msg, h("button", { class: "btn primary", type: "submit" }, "Se connecter"));
  app.replaceChildren(h("div", { class: "login" }, form));
  input.focus();
}

function shell(): HTMLElement {
  const main = h("main", { class: "main", id: "main" });
  const dot = h("span", { class: "dot", id: "livedot" });
  const side = h("nav", { class: "side", "aria-label": "Navigation" },
    h("div", { class: "brand" }, h("div", { class: "logo" }, h("i")), h("div", {}, h("b", {}, "RSVP"), h("small", {}, "Lecteur"))),
    ...ROUTES.map((r) => h("a", { class: "nav", href: `#/${r.path}`, "data-route": r.path }, icon(r.icon), h("span", {}, r.label))),
    h("div", { class: "grow" }),
    h("div", { class: "status", title: "Flux temps réel" }, dot, h("span", { id: "livetxt" }, "Connexion…")));
  app.replaceChildren(h("div", { class: "shell" }, main, side));
  return main;
}

async function route(): Promise<void> {
  const main = document.getElementById("main");
  if (!main) return;
  cleanup();
  cleanup = () => {};
  const [, name = "reader", id = "", chap, flag] = location.hash.replace(/^#/, "").split("/");
  const navName = name === "book" || name === "read" ? "books" : name;
  document.querySelectorAll<HTMLElement>(".nav").forEach((a) => {
    if (a.dataset.route === navName) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  main.replaceChildren();
  main.scrollTop = 0;
  const ctx: Ctx = { go, logout, refresh: () => void route() };
  try {
    if (name === "paste") cleanup = await pastePage(main, ctx);
    else if (name === "settings") cleanup = await settingsPage(main, ctx);
    else if (name === "books") cleanup = await libraryPage(main, ctx);
    else if (name === "book") cleanup = await bookPage(main, id, ctx);
    else if (name === "read") cleanup = await bookReaderPage(main, id, chap, flag === "play", ctx);
    else cleanup = await readerPage(main, id || undefined);
  } catch (e) {
    if (e instanceof AuthError) return login("Jeton invalide ou expiré.");
    main.replaceChildren(h("div", { class: "page" }, h("div", { class: "card empty" }, h("h2", {}, "Oups"), h("p", {}, (e as Error).message))));
  }
}

function connect(): void {
  events?.close();
  events = new EventSource(`/api/events?token=${encodeURIComponent(state.token)}`);
  const live = (ok: boolean, txt: string): void => {
    const d = document.getElementById("livedot"), t = document.getElementById("livetxt");
    if (d) d.className = `dot ${ok ? "ok" : "bad"}`;
    if (t) t.textContent = txt;
  };
  events.addEventListener("hello", () => live(true, "En direct"));
  events.onerror = () => live(false, "Reconnexion…");
  events.addEventListener("settings", (e) => { state.settings = JSON.parse((e as MessageEvent<string>).data) as Settings; applyAccent(state.settings.accent); });
  events.addEventListener("text", (e) => {
    const t = JSON.parse((e as MessageEvent<string>).data) as TextMeta;
    if (t.source === "web") return;
    toast(`Nouveau texte : ${t.title}`);
    if (state.settings.autoOpen) go(`/reader/${t.id}`);
  });
}

function logout(): void {
  events?.close();
  setToken("");
  login();
}

async function boot(): Promise<void> {
  // Lien pratique : http://hôte:8787/?token=… connecte l'appareil puis nettoie l'URL.
  const q = new URLSearchParams(location.search).get("token");
  if (q) { setToken(q); history.replaceState(null, "", location.pathname + location.hash); }
  if (!state.token) return login();
  try {
    state.settings = await api<Settings>("/settings");
  } catch (e) {
    return login(e instanceof AuthError ? "Jeton invalide." : (e as Error).message);
  }
  applyAccent(state.settings.accent);
  shell();
  connect();
  await route();
}

addEventListener("hashchange", () => void route());
void boot();
