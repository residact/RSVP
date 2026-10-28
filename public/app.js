// Point d'entrée : connexion, coque, routeur, flux temps réel.
import { h, icon, api, state, toast, applyAccent, setToken, AuthError } from "./lib.js";
import { readerPage } from "./reader.js";
import { pastePage, settingsPage } from "./pages.js";
import { libraryPage, bookPage, bookReaderPage } from "./books.js";

const app = document.getElementById("app");
let cleanup = () => {};
let evt = null;

const ROUTES = [
  { path: "reader", label: "Lecteur", icon: "book" },
  { path: "books", label: "Livres", icon: "library" },
  { path: "paste", label: "Coller", icon: "paste" },
  { path: "settings", label: "Config", icon: "gear" },
];

const go = (p) => { location.hash = `#${p}`; };

function login(error) {
  const input = h("input", { class: "field", type: "password", placeholder: "Jeton d’accès", autocomplete: "current-password", autofocus: true });
  const msg = h("p", { class: "muted", style: "color:var(--danger);margin:0", hidden: !error }, error ?? "");
  const form = h("form", { class: "card stack", onsubmit: async (e) => {
    e.preventDefault();
    setToken(input.value.trim());
    boot();
  } },
    h("div", { class: "brand", style: "padding:0" }, h("div", { class: "logo" }, h("i")), h("div", {}, h("b", {}, "RSVP"), h("small", {}, "Lecteur auto-hébergé"))),
    h("p", { class: "hint", style: "margin:0" }, "Saisis le jeton affiché dans les logs du conteneur (", h("code", {}, "docker compose logs rsvp"), ") ou défini par RSVP_TOKEN."),
    input, msg, h("button", { class: "btn primary", type: "submit" }, "Se connecter"));
  app.replaceChildren(h("div", { class: "login" }, form));
  input.focus();
}

function shell() {
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

async function route() {
  const main = document.getElementById("main");
  if (!main) return;
  cleanup();
  cleanup = () => {};
  const [, name = "reader", id, chap, flag] = location.hash.replace(/^#/, "").split("/");
  const navName = name === "book" || name === "read" ? "books" : name;
  document.querySelectorAll(".nav").forEach((a) => a.removeAttribute("aria-current"));
  document.querySelectorAll(".nav").forEach((a) => { if (a.dataset.route === navName) a.setAttribute("aria-current", "page"); });
  main.replaceChildren();
  main.scrollTop = 0;
  const ctx = { go, logout, refresh: () => route() };
  try {
    if (name === "paste") cleanup = (await pastePage(main, ctx)) ?? cleanup;
    else if (name === "settings") cleanup = (await settingsPage(main, ctx)) ?? cleanup;
    else if (name === "books") cleanup = (await libraryPage(main, ctx)) ?? cleanup;
    else if (name === "book") cleanup = (await bookPage(main, id, ctx)) ?? cleanup;
    else if (name === "read") cleanup = (await bookReaderPage(main, id, chap, flag === "play", ctx)) ?? cleanup;
    else cleanup = (await readerPage(main, id)) ?? cleanup;
  } catch (e) {
    if (e instanceof AuthError) return login("Jeton invalide ou expiré.");
    main.replaceChildren(h("div", { class: "page" }, h("div", { class: "card empty" }, h("h2", {}, "Oups"), h("p", {}, e.message))));
  }
}

function connect() {
  evt?.close();
  evt = new EventSource(`/api/events?token=${encodeURIComponent(state.token)}`);
  const live = (ok, txt) => {
    const d = document.getElementById("livedot"), t = document.getElementById("livetxt");
    if (d) d.className = `dot ${ok ? "ok" : "bad"}`;
    if (t) t.textContent = txt;
  };
  evt.addEventListener("hello", () => live(true, "En direct"));
  evt.onerror = () => live(false, "Reconnexion…");
  evt.addEventListener("settings", (e) => { state.settings = JSON.parse(e.data); applyAccent(state.settings.accent); });
  evt.addEventListener("text", (e) => {
    const t = JSON.parse(e.data);
    if (t.source === "web") return;
    toast(`Nouveau texte : ${t.title}`);
    if (state.settings?.autoOpen) go(`/reader/${t.id}`);
  });
}

function logout() {
  evt?.close();
  setToken("");
  login();
}

async function boot() {
  // Lien pratique : http://hôte:8787/?token=… connecte l'appareil puis nettoie l'URL.
  const q = new URLSearchParams(location.search).get("token");
  if (q) { setToken(q); history.replaceState(null, "", location.pathname + location.hash); }
  if (!state.token) return login();
  try {
    state.settings = await api("/settings");
  } catch (e) {
    return login(e instanceof AuthError ? "Jeton invalide." : e.message);
  }
  applyAccent(state.settings.accent);
  shell();
  connect();
  await route();
}

addEventListener("hashchange", route);
boot();
