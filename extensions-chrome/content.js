(() => {
  if (window.__rsvpLoaded) return;
  window.__rsvpLoaded = true;

  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;top:0;left:0;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
<style>
  *{box-sizing:border-box;font-family:system-ui,sans-serif}
  .btn{position:fixed;display:none;padding:6px 12px;border:0;border-radius:8px;background:#d97757;color:#fff;font-size:13px;cursor:pointer;box-shadow:0 2px 8px #0005}
  .ov{position:fixed;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;background:#141413f2;color:#f0eee6}
  .ov.open{display:flex}
  .close{position:absolute;top:16px;right:20px;background:none;border:0;color:#aaa;font-size:28px;cursor:pointer}
  .word{display:grid;grid-template-columns:1fr auto 1fr;width:min(90vw,900px);font-size:clamp(32px,7vw,64px);font-family:Georgia,serif;line-height:1.4;height:1.4em}
  .l{text-align:right;white-space:pre}.r{text-align:left;white-space:pre}
  .p{color:#e5533d}
  .guide{width:min(90vw,900px);display:grid;grid-template-columns:1fr auto 1fr;height:14px;margin:6px 0}
  .guide i{grid-column:2;width:2px;height:100%;background:#e5533d88;margin:0 auto}
  .bar{width:min(90vw,600px);height:6px;background:#333;border-radius:3px;cursor:pointer;margin-top:40px}
  .bar div{height:100%;width:0;background:#d97757;border-radius:3px}
  .ctl{display:flex;gap:14px;align-items:center;margin-top:20px;font-size:14px;color:#bbb}
  .ctl button{background:#2a2a28;color:#f0eee6;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:14px}
  .ctl input{width:160px}
  .hint{position:absolute;bottom:16px;font-size:12px;color:#777}
</style>
<button class="btn">RSVP</button>
<div class="ov">
  <button class="close" title="Échap">×</button>
  <div class="guide"><i></i></div>
  <div class="word"><span class="l"></span><span class="p"></span><span class="r"></span></div>
  <div class="guide"><i></i></div>
  <div class="bar"><div></div></div>
  <div class="ctl">
    <button class="prev">⏮</button><button class="play">⏸</button><button class="next">⏭</button>
    <input type="range" min="100" max="1000" step="25" class="wpm"><span class="wpmv"></span>
    <span class="pos"></span>
  </div>
  <div class="hint">Espace : pause · ←/→ : mot · ↑/↓ : vitesse · Échap : fermer</div>
</div>`;
  document.documentElement.appendChild(host);

  const $ = (s) => root.querySelector(s);
  const btn = $(".btn"), ov = $(".ov");
  const L = $(".l"), P = $(".p"), R = $(".r");
  const bar = $(".bar"), fill = $(".bar div");
  const wpmEl = $(".wpm"), wpmV = $(".wpmv"), posEl = $(".pos"), playBtn = $(".play");

  let words = [], i = 0, wpm = 300, timer = null, playing = false, lastSel = "";

  try { chrome.storage.local.get("wpm", (d) => { if (d.wpm) setWpm(d.wpm); }); } catch {}

  function setWpm(v) {
    wpm = Math.max(100, Math.min(1000, v));
    wpmEl.value = wpm; wpmV.textContent = wpm + " mpm";
    try { chrome.storage.local.set({ wpm }); } catch {}
  }
  setWpm(wpm);

  const orp = (n) => (n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4);

  function delay(w) {
    let d = 60000 / wpm;
    if (/[.!?…]["')»]*$/.test(w)) d *= 2;
    else if (/[,;:)»]$/.test(w)) d *= 1.5;
    if (w.length > 8) d *= 1.0 + Math.min(0.5, (w.length - 8) * 0.05);
    return d;
  }

  function show() {
    const w = words[i] || "";
    const k = Math.min(orp(w.length), Math.max(0, w.length - 1));
    L.textContent = w.slice(0, k);
    P.textContent = w[k] || "";
    R.textContent = w.slice(k + 1);
    fill.style.width = (words.length > 1 ? (i / (words.length - 1)) * 100 : 100) + "%";
    posEl.textContent = `${i + 1}/${words.length}`;
  }

  function tick() {
    show();
    if (i >= words.length - 1) { pause(); return; }
    timer = setTimeout(() => { i++; tick(); }, delay(words[i]));
  }
  function play() {
    if (i >= words.length - 1) i = 0;
    playing = true; playBtn.textContent = "⏸"; clearTimeout(timer); tick();
  }
  function pause() { playing = false; playBtn.textContent = "▶"; clearTimeout(timer); }
  function toggle() { playing ? pause() : play(); }
  function step(d) {
    pause(); i = Math.max(0, Math.min(words.length - 1, i + d)); show();
  }

  function open(text) {
    words = text.split(/\s+/).filter(Boolean);
    if (!words.length) return;
    i = 0; ov.classList.add("open"); btn.style.display = "none"; play();
  }
  function close() { pause(); ov.classList.remove("open"); }

  document.addEventListener("selectionchange", () => {
    const s = getSelection();
    lastSel = s ? s.toString().trim() : "";
  });
  document.addEventListener("mouseup", (e) => {
    if (e.composedPath().includes(host)) return;
    setTimeout(() => {
      const s = getSelection();
      const t = s ? s.toString().trim() : "";
      if (t.split(/\s+/).length < 3) { btn.style.display = "none"; return; }
      const r = s.getRangeAt(0).getBoundingClientRect();
      btn.style.left = Math.min(innerWidth - 80, Math.max(8, r.right - 30)) + "px";
      btn.style.top = Math.max(8, r.top - 40) + "px";
      btn.style.display = "block";
    }, 10);
  });
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", () => open(lastSel));

  $(".close").onclick = close;
  playBtn.onclick = toggle;
  $(".prev").onclick = () => step(-1);
  $(".next").onclick = () => step(1);
  wpmEl.oninput = () => setWpm(+wpmEl.value);
  bar.onclick = (e) => {
    const r = bar.getBoundingClientRect();
    i = Math.round(((e.clientX - r.left) / r.width) * (words.length - 1));
    show(); if (playing) { clearTimeout(timer); tick(); }
  };

  window.addEventListener("keydown", (e) => {
    if (!ov.classList.contains("open")) return;
    const map = {
      " ": toggle, Escape: close,
      ArrowLeft: () => step(-1), ArrowRight: () => step(1),
      ArrowUp: () => setWpm(wpm + 25), ArrowDown: () => setWpm(wpm - 25),
    };
    if (map[e.key]) { e.preventDefault(); e.stopPropagation(); map[e.key](); }
  }, true);

  chrome.runtime.onMessage.addListener((m) => {
    if (m.type === "rsvp-start") open(m.text || lastSel);
  });
})();
