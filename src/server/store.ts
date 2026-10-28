// Stockage : un fichier JSON dans le volume de données, écrit de façon atomique.
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS } from "../shared/defaults.ts";
import type { Settings, TextItem, TextMeta } from "../shared/types.ts";

const MAX_TEXTS = 200;
const BOOLEAN_KEYS = ["showPivot", "punctuationPause", "longWordPause", "autoOpen", "keepAwake"] as const;

interface Db {
  token: string;
  settings: Settings;
  texts: TextItem[];
}

export const events = new EventEmitter();

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;

export class Store {
  private file: string;
  private db: Db;

  constructor(dir: string, fixedToken?: string) {
    this.file = path.join(dir, "db.json");
    fs.mkdirSync(dir, { recursive: true });
    this.db = { token: "", settings: { ...DEFAULT_SETTINGS }, texts: [] };
    if (fs.existsSync(this.file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<Db>;
        this.db = { token: raw.token ?? "", texts: raw.texts ?? [], settings: { ...DEFAULT_SETTINGS, ...raw.settings } };
      } catch (e) {
        fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`);
        console.error("db.json illisible, copie de sauvegarde créée :", (e as Error).message);
      }
    }
    if (fixedToken) this.db.token = fixedToken;
    if (!this.db.token) this.db.token = randomBytes(24).toString("base64url");
    this.save();
  }

  get token(): string {
    return this.db.token;
  }

  get settings(): Settings {
    return this.db.settings;
  }

  private save(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.file);
  }

  checkToken(candidate: unknown): boolean {
    const a = Buffer.from(String(candidate ?? ""));
    const b = Buffer.from(this.db.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  regenerateToken(): string {
    this.db.token = randomBytes(24).toString("base64url");
    this.save();
    return this.db.token;
  }

  updateSettings(patch: Record<string, unknown>): Settings {
    const s: Settings = { ...this.db.settings };
    const num = (k: "minWpm" | "maxWpm" | "fontScale", lo: number, hi: number) => {
      const n = Number(patch[k]);
      if (patch[k] !== undefined && Number.isFinite(n)) s[k] = Math.min(hi, Math.max(lo, Math.round(n * 100) / 100));
    };
    num("minWpm", 50, 1000);
    num("maxWpm", 100, 2000);
    num("fontScale", 0.6, 2);
    for (const k of BOOLEAN_KEYS) if (typeof patch[k] === "boolean") s[k] = patch[k] as boolean;
    if (typeof patch.accent === "string" && /^#[0-9a-f]{6}$/i.test(patch.accent)) s.accent = patch.accent;
    if (s.maxWpm <= s.minWpm) s.maxWpm = s.minWpm + 50;
    if (patch.wpm !== undefined && Number.isFinite(Number(patch.wpm))) s.wpm = Math.round(Number(patch.wpm));
    s.wpm = Math.min(s.maxWpm, Math.max(s.minWpm, s.wpm));
    this.db.settings = s;
    this.save();
    events.emit("settings", s);
    return s;
  }

  list(): TextMeta[] {
    return this.db.texts.map(({ text, ...meta }) => ({ ...meta, preview: text.slice(0, 140) }));
  }

  get(id: string): TextItem | null {
    return this.db.texts.find((t) => t.id === id) ?? null;
  }

  latest(): TextItem | null {
    return this.db.texts[0] ?? null;
  }

  add(input: { title?: string; text: unknown; source?: string }): TextItem {
    const clean = String(input.text ?? "").replace(/\r\n?/g, "\n").trim();
    if (!clean) throw new HttpError(400, "Le texte est vide.");
    const item: TextItem = {
      id: randomUUID().slice(0, 8),
      title: input.title?.trim() || clean.split("\n")[0]?.slice(0, 60) || "Sans titre",
      text: clean,
      words: countWords(clean),
      source: String(input.source ?? "api").slice(0, 40),
      createdAt: new Date().toISOString(),
    };
    this.db.texts.unshift(item);
    this.db.texts.length = Math.min(this.db.texts.length, MAX_TEXTS);
    this.save();
    events.emit("text", item);
    return item;
  }

  remove(id: string): boolean {
    const before = this.db.texts.length;
    this.db.texts = this.db.texts.filter((t) => t.id !== id);
    const removed = this.db.texts.length !== before;
    if (removed) this.save();
    return removed;
  }

  clear(): void {
    this.db.texts = [];
    this.save();
  }
}
