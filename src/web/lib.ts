// Utilitaires partagés : DOM, API, icônes, notifications, état global.
import { DEFAULT_SETTINGS } from "../shared/defaults.ts";
import type { Info, Settings } from "../shared/types.ts";

export const state: { settings: Settings; info: Info | null; token: string } = {
  settings: { ...DEFAULT_SETTINGS },
  info: null,
  token: localStorage.getItem("rsvp.token") ?? "",
};

export type Kid = Node | string | number | null | undefined | false | Kid[];
export type Props = Record<string, unknown>;

/** Crée un élément DOM : propriétés, écouteurs (onclick…) et enfants. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else if (k in el && k !== "list") (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat(Infinity as 1) as Kid[]) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
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
  library: '<path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 5.2l3.6-1 3.4 14.6-3.6 1z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/>',
} as const;

export type IconName = keyof typeof ICONS;

export const icon = (name: IconName): HTMLElement =>
  h("span", { html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`, style: "display:contents" });

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string): void {
  let el = document.querySelector<HTMLElement>(".toast");
  if (!el) document.body.append((el = h("div", { class: "toast", role: "status" })));
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  const shown = el;
  toastTimer = setTimeout(() => shown.classList.remove("show"), 2800);
}

export async function copy(text: string): Promise<void> {
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

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? "GET",
    headers: { authorization: `Bearer ${state.token}`, ...(opts.body ? { "content-type": "application/json" } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) throw new AuthError("Jeton invalide");
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
  return data as T;
}

export function setToken(t: string): void {
  state.token = t;
  localStorage.setItem("rsvp.token", t);
}

export const minutes = (words: number, wpm: number): string => {
  const s = Math.round((words / wpm) * 60);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
};

export const ago = (iso: string): string => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "à l’instant";
  if (d < 3600) return `il y a ${Math.floor(d / 60)} min`;
  if (d < 86400) return `il y a ${Math.floor(d / 3600)} h`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
};

export const paintRange = (input: HTMLInputElement): void => {
  const { min, max, value } = input;
  input.style.setProperty("--p", `${((Number(value) - Number(min)) / (Number(max) - Number(min))) * 100}%`);
};

export const applyAccent = (color: string): void => document.documentElement.style.setProperty("--accent", color);

/** Contexte passé aux pages par le routeur. */
export interface Ctx {
  go: (path: string) => void;
  logout: () => void;
  refresh: () => void;
}
export type Cleanup = () => void;
