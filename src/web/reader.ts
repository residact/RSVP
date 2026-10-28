// Moteur RSVP et page du lecteur.
import type { Settings, TextItem } from "../shared/types.ts";
import { AuthError, api, h, icon, minutes, paintRange, state, type Cleanup, type Kid } from "./lib.ts";
import { renderMarkdown } from "./md.ts";

const pivotOf = (n: number): number => (n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4);

function delayFor(word: string, wpm: number, s: Settings): number {
  let d = 60000 / wpm;
  if (s.punctuationPause) {
    if (/[.!?…]["'»)”]*$/.test(word)) d *= 2.1;
    else if (/[,;:)»”]$/.test(word)) d *= 1.5;
  }
  if (s.longWordPause && word.length > 8) d *= 1 + Math.min(0.5, (word.length - 8) * 0.05);
  return d;
}

export interface ReaderOptions {
  title: string;
  subtitle?: string;
  /** Markdown à lire. */
  text: string;
  start?: number;
  autoplay?: boolean;
  onProgress?: (index: number, total: number) => void;
  onEnd?: () => void;
  headExtra?: Kid[];
}

export async function readerPage(root: HTMLElement, id?: string): Promise<Cleanup> {
  let item: TextItem | null;
  try {
    item = await api<TextItem>(id ? `/texts/${id}` : "/texts/latest");
  } catch (e) {
    if (e instanceof AuthError) throw e;
    item = null;
  }

  if (!item) {
    root.append(
      h("div", { class: "page" },
        h("div", { class: "card empty" },
          h("h2", {}, "Rien à lire pour le moment"),
          h("p", {}, "Colle un texte, ou demande à Claude de l’envoyer via le connecteur MCP."),
          h("a", { class: "btn primary", href: "#/paste" }, icon("paste"), "Coller un texte"))));
    return () => {};
  }
  return mountReader(root, { title: item.title, text: item.text, headExtra: [h("a", { class: "btn sm ghost", href: "#/paste" }, icon("paste"), "Nouveau")] });
}

/** Lecteur générique : un texte markdown lu mot à mot, avec progression et fin de lecture. */
export function mountReader(root: HTMLElement, opts: ReaderOptions): Cleanup {
  const s = state.settings;
  const md = renderMarkdown(opts.text);
  const spans = md.words;
  const words = spans.map((n) => n.textContent ?? "");
  let idx = Math.min(Math.max(0, opts.start ?? 0), Math.max(0, words.length - 1));
  let playing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: WakeLockSentinel | null = null;
  let wpm = s.wpm;
  let lastSaved = -1;

  const elL = h("span", { class: "l" }), elP = h("span", { class: "p" }), elR = h("span", { class: "r" });
  const wordEl = h("div", { class: "word" + (s.showPivot ? "" : " nopivot") }, elL, elP, elR);
  const stage = h("div", { class: "stage", style: `--fscale:${s.fontScale}`, role: "button", "aria-label": "Lecture / pause", tabIndex: 0 },
    wordEl, h("div", { class: "hintbar" }, "Touche pour lire · Espace · ← → mot · ↑ ↓ vitesse"));
  const scrub = h("input", { type: "range", class: "range", min: 0, max: Math.max(0, words.length - 1), value: 0, "aria-label": "Position" });
  const posEl = h("span"), leftEl = h("span");
  const speed = h("input", { type: "range", class: "range", min: s.minWpm, max: s.maxWpm, step: 25, value: wpm, "aria-label": "Mots par minute" });
  const speedVal = h("strong", {}, String(wpm), h("small", {}, "mots/min"));
  const playBtn = h("button", { class: "btn primary big", onclick: () => toggle() });
  const pane = h("div", { class: "card textpane", hidden: true }, md.el);
  pane.addEventListener("click", (e) => {
    const i = spans.indexOf((e.target as HTMLElement).closest<HTMLSpanElement>("span.w")!);
    if (i >= 0) seek(i);
  });

  function render(): void {
    const w = words[idx] ?? "";
    const k = Math.min(pivotOf(w.length), Math.max(0, w.length - 1));
    elL.textContent = s.showPivot ? w.slice(0, k) : w;
    elP.textContent = s.showPivot ? (w[k] ?? "") : "";
    elR.textContent = s.showPivot ? w.slice(k + 1) : "";
    // Réduit la taille d'un mot trop large pour la scène.
    wordEl.style.transform = "";
    const over = wordEl.scrollWidth / (stage.clientWidth - 32 || 1);
    if (over > 1) wordEl.style.transform = `scale(${1 / over})`;
    scrub.value = String(idx);
    paintRange(scrub);
    posEl.textContent = `${idx + 1} / ${words.length}`;
    leftEl.textContent = `${minutes(Math.max(0, words.length - idx - 1), wpm)} restantes`;
    if (!pane.hidden) markCurrent();
  }

  const setPlayBtn = (): void => playBtn.replaceChildren(icon(playing ? "pause" : "play"), playing ? "Pause" : idx >= words.length - 1 ? "Relire" : "Lire");

  async function lock(on: boolean): Promise<void> {
    try {
      if (on && s.keepAwake && "wakeLock" in navigator) wake = await navigator.wakeLock.request("screen");
      else if (wake) { await wake.release(); wake = null; }
    } catch { /* non bloquant */ }
  }

  const save = (): void => {
    if (idx !== lastSaved) { lastSaved = idx; opts.onProgress?.(idx, words.length); }
  };

  function tick(): void {
    render();
    if (idx % 25 === 0) save();
    if (idx >= words.length - 1) { pause(); opts.onEnd?.(); return; }
    timer = setTimeout(() => { idx++; tick(); }, delayFor(words[idx] ?? "", wpm, s));
  }
  function play(): void {
    if (idx >= words.length - 1) idx = 0;
    playing = true; setPlayBtn(); void lock(true); clearTimeout(timer); tick();
  }
  function pause(): void { playing = false; clearTimeout(timer); setPlayBtn(); void lock(false); render(); save(); }
  function toggle(): void { playing ? pause() : play(); }
  function seek(n: number): void {
    idx = Math.min(words.length - 1, Math.max(0, n));
    if (playing) { clearTimeout(timer); tick(); } else render();
  }
  function setSpeed(n: number): void {
    wpm = Math.min(s.maxWpm, Math.max(s.minWpm, Math.round(n)));
    speed.value = String(wpm); paintRange(speed);
    speedVal.firstChild!.textContent = String(wpm);
    api<Settings>("/settings", { method: "PUT", body: { wpm } }).then((v) => (state.settings = v)).catch(() => {});
    render();
  }

  function markCurrent(): void {
    pane.querySelector(".cur")?.classList.remove("cur");
    const el = spans[idx];
    if (el) { el.classList.add("cur"); el.scrollIntoView({ block: "nearest" }); }
  }
  function togglePane(): void {
    pane.hidden = !pane.hidden;
    if (!pane.hidden) markCurrent();
  }

  scrub.addEventListener("input", () => seek(Number(scrub.value)));
  speed.addEventListener("input", () => setSpeed(Number(speed.value)));
  stage.addEventListener("click", toggle);

  const onKey = (e: KeyboardEvent): void => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "") && e.key !== "Escape") return;
    const map: Record<string, () => void> = {
      " ": toggle, Enter: toggle,
      ArrowRight: () => { pause(); seek(idx + 1); }, ArrowLeft: () => { pause(); seek(idx - 1); },
      ArrowUp: () => setSpeed(wpm + 25), ArrowDown: () => setSpeed(wpm - 25),
      Home: () => seek(0), r: () => seek(0), t: togglePane,
    };
    const fn = map[e.key];
    if (fn) { e.preventDefault(); fn(); }
  };
  document.addEventListener("keydown", onKey);
  const onVis = (): void => { if (document.hidden && playing) pause(); };
  document.addEventListener("visibilitychange", onVis);

  root.append(
    h("div", { class: "reader" },
      h("div", { class: "rhead" },
        h("div", { style: "min-width:0" }, h("h1", {}, opts.title), h("span", { class: "muted" }, opts.subtitle ?? `${words.length} mots · ${minutes(words.length, wpm)}`)),
        h("div", { class: "row" },
          h("button", { class: "btn sm ghost", onclick: togglePane, title: "Afficher le texte (T)" }, icon("text"), "Texte"),
          ...(opts.headExtra ?? []))),
      stage,
      h("div", { class: "scrub" }, scrub, h("div", { class: "scrubmeta" }, posEl, leftEl)),
      h("div", { class: "controls" },
        h("button", { class: "btn icon", title: "Début", "aria-label": "Début", onclick: () => seek(0) }, icon("restart")),
        h("button", { class: "btn icon", title: "Mot précédent", "aria-label": "Mot précédent", onclick: () => { pause(); seek(idx - 1); } }, icon("prev")),
        playBtn,
        h("button", { class: "btn icon", title: "Mot suivant", "aria-label": "Mot suivant", onclick: () => { pause(); seek(idx + 1); } }, icon("next"))),
      h("div", { class: "speed" },
        h("div", { class: "sliderhead" }, h("span", {}, String(s.minWpm)), speedVal, h("span", {}, String(s.maxWpm))),
        speed),
      pane));

  paintRange(speed);
  setPlayBtn();
  render();
  addEventListener("resize", render);
  const autoTimer = opts.autoplay ? setTimeout(play, 400) : undefined;
  return () => {
    clearTimeout(autoTimer);
    save();
    clearTimeout(timer);
    void lock(false);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onVis);
    removeEventListener("resize", render);
  };
}
