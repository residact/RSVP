// Stockage : un fichier JSON dans le volume /data, écrit de façon atomique.
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SETTINGS = {
  wpm: 300,
  minWpm: 200,
  maxWpm: 700,
  showPivot: true,
  punctuationPause: true,
  longWordPause: true,
  fontScale: 1,
  autoOpen: true, // ouvrir le lecteur dès qu'un texte arrive (MCP / API)
  keepAwake: true,
  accent: "#f68330",
};

const MAX_TEXTS = 200;

export const events = new EventEmitter();

export function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

export class Store {
  constructor(dir) {
    this.file = path.join(dir, "db.json");
    fs.mkdirSync(dir, { recursive: true });
    this.db = { token: "", settings: { ...DEFAULT_SETTINGS }, texts: [] };
    if (fs.existsSync(this.file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
        this.db = { ...this.db, ...raw, settings: { ...DEFAULT_SETTINGS, ...raw.settings } };
      } catch (e) {
        fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`);
        console.error("db.json illisible, copie de sauvegarde créée :", e.message);
      }
    }
    if (process.env.RSVP_TOKEN) this.db.token = process.env.RSVP_TOKEN;
    if (!this.db.token) this.db.token = randomBytes(24).toString("base64url");
    this.save();
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.file);
  }

  checkToken(candidate) {
    const a = Buffer.from(String(candidate ?? ""));
    const b = Buffer.from(this.db.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  regenerateToken() {
    this.db.token = randomBytes(24).toString("base64url");
    this.save();
    return this.db.token;
  }

  get settings() {
    return this.db.settings;
  }

  updateSettings(patch) {
    const s = { ...this.db.settings };
    const num = (k, lo, hi) => {
      if (patch[k] !== undefined) {
        const n = Number(patch[k]);
        if (Number.isFinite(n)) s[k] = Math.min(hi, Math.max(lo, Math.round(n * 100) / 100));
      }
    };
    num("minWpm", 50, 1000);
    num("maxWpm", 100, 2000);
    num("fontScale", 0.6, 2);
    for (const k of ["showPivot", "punctuationPause", "longWordPause", "autoOpen", "keepAwake"]) {
      if (typeof patch[k] === "boolean") s[k] = patch[k];
    }
    if (typeof patch.accent === "string" && /^#[0-9a-f]{6}$/i.test(patch.accent)) s.accent = patch.accent;
    if (s.maxWpm <= s.minWpm) s.maxWpm = s.minWpm + 50;
    if (patch.wpm !== undefined && Number.isFinite(Number(patch.wpm))) s.wpm = Math.round(Number(patch.wpm));
    s.wpm = Math.min(s.maxWpm, Math.max(s.minWpm, s.wpm));
    this.db.settings = s;
    this.save();
    events.emit("settings", s);
    return s;
  }

  list() {
    return this.db.texts.map(({ text, ...meta }) => ({ ...meta, preview: text.slice(0, 140) }));
  }

  get(id) {
    return this.db.texts.find((t) => t.id === id) ?? null;
  }

  latest() {
    return this.db.texts[0] ?? null;
  }

  add({ title, text, source = "api" }) {
    const clean = String(text ?? "").replace(/\r\n?/g, "\n").trim();
    if (!clean) throw Object.assign(new Error("Le texte est vide."), { status: 400 });
    const item = {
      id: randomUUID().slice(0, 8),
      title: (title?.trim() || clean.split("\n")[0].slice(0, 60)) || "Sans titre",
      text: clean,
      words: countWords(clean),
      source: String(source).slice(0, 40),
      createdAt: new Date().toISOString(),
    };
    this.db.texts.unshift(item);
    this.db.texts.length = Math.min(this.db.texts.length, MAX_TEXTS);
    this.save();
    events.emit("text", item);
    return item;
  }

  remove(id) {
    const n = this.db.texts.length;
    this.db.texts = this.db.texts.filter((t) => t.id !== id);
    if (this.db.texts.length !== n) this.save();
    return this.db.texts.length !== n;
  }

  clear() {
    this.db.texts = [];
    this.save();
  }
}
