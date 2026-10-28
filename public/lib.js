// Utilitaires partagés : DOM, API, icônes, notifications, état global.
export const state = { settings: null, info: null, token: localStorage.getItem("rsvp.token") || "" };

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k in el && k !== "list") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

const ICONS = {
  play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 4h4v16H7zM13 4h4v16h-4z" fill="currentColor" stroke="none"/>',
  prev: '<path d="M6 5v14M19 5l-9 7 9 7z"/>',
  next: '<path d="M18 5v14M5 5l9 7-9 7z"/>',
  restart: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M9 7h6"/>',
  paste: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2M9 13h6M9 17h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  text: '<path d="M5 6h14M5 12h14M5 18h9"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  library: '<path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 5.2l3.6-1 3.4 14.6-3.6 1z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/>',
};
export const icon = (name) => h("span", { html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`, style: "display:contents" });

let toastTimer;
export function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) document.body.append((el = h("div", { class: "toast", role: "status" })));
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = h("textarea", { value: text, style: "position:fixed;opacity:0" });
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
  toast("Copié dans le presse-papiers");
}

export class AuthError extends Error {}

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { authorization: `Bearer ${state.token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new AuthError("Jeton invalide");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
  return data;
}

export function setToken(t) {
  state.token = t;
  localStorage.setItem("rsvp.token", t);
}

export const minutes = (words, wpm) => {
  const s = Math.round((words / wpm) * 60);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
};

export const ago = (iso) => {
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 60) return "à l’instant";
  if (d < 3600) return `il y a ${Math.floor(d / 60)} min`;
  if (d < 86400) return `il y a ${Math.floor(d / 3600)} h`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};

export const paintRange = (input) => {
  const { min, max, value } = input;
  input.style.setProperty("--p", `${((value - min) / (max - min)) * 100}%`);
};

export function applyAccent(color) {
  document.documentElement.style.setProperty("--accent", color);
}
