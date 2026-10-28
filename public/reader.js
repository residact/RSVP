// Moteur RSVP et page du lecteur.
import { h, icon, api, state, minutes, paintRange, AuthError } from "./lib.js";
import { renderMarkdown } from "./md.js";

const pivotOf = (n) => (n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4);

function delayFor(word, wpm, s) {
  let d = 60000 / wpm;
  if (s.punctuationPause) {
    if (/[.!?…]["'»)”]*$/.test(word)) d *= 2.1;
    else if (/[,;:)»”]$/.test(word)) d *= 1.5;
  }
  if (s.longWordPause && word.length > 8) d *= 1 + Math.min(0.5, (word.length - 8) * 0.05);
  return d;
}

export async function readerPage(root, id) {
  let item;
  try {
    item = id ? await api(`/texts/${id}`) : await api("/texts/latest");
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
  return mountReader(root, {
    title: item.title,
    text: item.text,
    headExtra: [h("a", { class: "btn sm ghost", href: "#/paste" }, icon("paste"), "Nouveau")],
  });
}

/**
 * Lecteur générique. opts : title, subtitle?, text (markdown), start?, autoplay?,
 * onProgress(idx, total)?, onEnd()?, headExtra? (nœuds), endLabel?
 */
export function mountReader(root, opts) {
  const s = state.settings;
  const item = { title: opts.title, text: opts.text };
  const md = renderMarkdown(item.text);
  const spans = md.words;
  const words = spans.map((n) => n.textContent);
  let idx = Math.min(Math.max(0, opts.start ?? 0), Math.max(0, words.length - 1)), playing = false, timer = null, wake = null, wpm = s.wpm;

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
  pane.addEventListener("click", (e) => { const i = spans.indexOf(e.target.closest("span.w")); if (i >= 0) seek(i); });

  function render() {
    const w = words[idx] ?? "";
    const k = Math.min(pivotOf(w.length), Math.max(0, w.length - 1));
    elL.textContent = s.showPivot ? w.slice(0, k) : w;
    elP.textContent = s.showPivot ? (w[k] ?? "") : "";
    elR.textContent = s.showPivot ? w.slice(k + 1) : "";
    // Réduit la taille d'un mot trop large pour la scène.
    wordEl.style.transform = "";
    const over = wordEl.scrollWidth / (stage.clientWidth - 32 || 1);
    if (over > 1) wordEl.style.transform = `scale(${1 / over})`;
    scrub.value = idx;
    paintRange(scrub);
    posEl.textContent = `${idx + 1} / ${words.length}`;
    leftEl.textContent = `${minutes(Math.max(0, words.length - idx - 1), wpm)} restantes`;
    if (!pane.hidden) markCurrent();
  }

  function setPlayBtn() {
    playBtn.replaceChildren(icon(playing ? "pause" : "play"), playing ? "Pause" : idx >= words.length - 1 ? "Relire" : "Lire");
  }

  async function lock(on) {
    try {
      if (on && s.keepAwake && "wakeLock" in navigator) wake = await navigator.wakeLock.request("screen");
      else if (wake) { await wake.release(); wake = null; }
    } catch { /* non bloquant */ }
  }

  let lastSaved = -1;
  const save = () => { if (idx !== lastSaved) { lastSaved = idx; opts.onProgress?.(idx, words.length); } };

  function tick() {
    render();
    if (idx % 25 === 0) save();
    if (idx >= words.length - 1) { pause(); opts.onEnd?.(); return; }
    timer = setTimeout(() => { idx++; tick(); }, delayFor(words[idx], wpm, s));
  }
  function play() {
    if (idx >= words.length - 1) idx = 0;
    playing = true; setPlayBtn(); lock(true); clearTimeout(timer); tick();
  }
  function pause() { playing = false; clearTimeout(timer); setPlayBtn(); lock(false); render(); save(); }
  function toggle() { playing ? pause() : play(); }
  function seek(n) { idx = Math.min(words.length - 1, Math.max(0, n)); if (playing) { clearTimeout(timer); tick(); } else render(); }
  function setSpeed(n) {
    wpm = Math.min(s.maxWpm, Math.max(s.minWpm, Math.round(n)));
    speed.value = wpm; paintRange(speed);
    speedVal.firstChild.textContent = String(wpm);
    api("/settings", { method: "PUT", body: { wpm } }).then((v) => (state.settings = v)).catch(() => {});
    render();
  }

  function markCurrent() {
    pane.querySelector(".cur")?.classList.remove("cur");
    const el = spans[idx];
    if (el) { el.classList.add("cur"); el.scrollIntoView({ block: "nearest" }); }
  }
  function togglePane() {
    pane.hidden = !pane.hidden;
    if (!pane.hidden) markCurrent();
  }

  scrub.addEventListener("input", () => seek(Number(scrub.value)));
  speed.addEventListener("input", () => setSpeed(Number(speed.value)));
  stage.addEventListener("click", toggle);

  const onKey = (e) => {
    if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName) && e.key !== "Escape") return;
    const map = {
      " ": toggle, Enter: toggle,
      ArrowRight: () => { pause(); seek(idx + 1); }, ArrowLeft: () => { pause(); seek(idx - 1); },
      ArrowUp: () => setSpeed(wpm + 25), ArrowDown: () => setSpeed(wpm - 25),
      Home: () => seek(0), r: () => seek(0), t: togglePane,
    };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  };
  document.addEventListener("keydown", onKey);
  const onVis = () => { if (document.hidden && playing) pause(); };
  document.addEventListener("visibilitychange", onVis);

  root.append(
    h("div", { class: "reader" },
      h("div", { class: "rhead" },
        h("div", { style: "min-width:0" }, h("h1", {}, item.title), h("span", { class: "muted" }, opts.subtitle ?? `${words.length} mots · ${minutes(words.length, wpm)}`)),
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
  const autoTimer = opts.autoplay ? setTimeout(play, 400) : 0;
  return () => {
    clearTimeout(autoTimer);
    save();
    clearTimeout(timer); lock(false);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onVis);
    removeEventListener("resize", render);
  };
}
