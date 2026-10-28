// Bibliothèque : un dossier par livre (meta.json, chapitres .md, couverture).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseBook } from "./formats.js";

export class Books {
  constructor(dataDir) {
    this.root = path.join(dataDir, "books");
    fs.mkdirSync(this.root, { recursive: true });
  }

  dir(id) {
    if (!/^[a-f0-9]{12}$/.test(id)) return null;
    return path.join(this.root, id);
  }

  meta(id) {
    const d = this.dir(id);
    try {
      return d ? JSON.parse(fs.readFileSync(path.join(d, "meta.json"), "utf8")) : null;
    } catch {
      return null;
    }
  }

  writeMeta(id, meta) {
    const f = path.join(this.dir(id), "meta.json");
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(meta));
    fs.renameSync(`${f}.tmp`, f);
  }

  list() {
    return fs
      .readdirSync(this.root)
      .map((id) => this.meta(id))
      .filter(Boolean)
      .map((m) => this.summary(m))
      .sort((a, b) => (b.progress?.updatedAt ?? b.addedAt).localeCompare(a.progress?.updatedAt ?? a.addedAt));
  }

  summary(m) {
    const { chapters, ...rest } = m;
    const total = chapters.reduce((n, c) => n + c.words, 0);
    return { ...rest, chapterCount: chapters.length, totalWords: total, percent: this.percent(m) };
  }

  percent(m) {
    const p = m.progress;
    if (!p) return 0;
    const total = m.chapters.reduce((n, c) => n + c.words, 0) || 1;
    const before = m.chapters.slice(0, p.chapter).reduce((n, c) => n + c.words, 0);
    const cur = m.chapters[p.chapter];
    const frac = cur && p.total ? Math.min(1, p.word / Math.max(1, p.total - 1)) : 0;
    return Math.min(100, Math.round(((before + (cur?.words ?? 0) * frac) / total) * 1000) / 10);
  }

  get(id) {
    const m = this.meta(id);
    return m && { ...this.summary(m), chapters: m.chapters };
  }

  async add(buffer, fileName = "") {
    const id = createHash("sha1").update(buffer).digest("hex").slice(0, 12);
    const existing = this.meta(id);
    if (existing) return { ...this.summary(existing), duplicate: true };
    const book = await parseBook(buffer, fileName);
    const d = this.dir(id);
    fs.mkdirSync(d, { recursive: true });
    book.chapters.forEach((c, i) => fs.writeFileSync(path.join(d, `${String(i).padStart(4, "0")}.md`), c.md));
    if (book.cover) fs.writeFileSync(path.join(d, `cover.${book.cover.ext}`), book.cover.data);
    const meta = {
      id,
      title: book.title,
      author: book.author,
      language: book.language,
      fileName: fileName.slice(0, 200),
      cover: book.cover ? `cover.${book.cover.ext}` : null,
      addedAt: new Date().toISOString(),
      chapters: book.chapters.map(({ title, words }) => ({ title, words })),
      progress: null,
    };
    this.writeMeta(id, meta);
    return this.summary(meta);
  }

  chapter(id, n) {
    const m = this.meta(id);
    if (!m || !Number.isInteger(n) || n < 0 || n >= m.chapters.length) return null;
    const md = fs.readFileSync(path.join(this.dir(id), `${String(n).padStart(4, "0")}.md`), "utf8");
    return { index: n, count: m.chapters.length, title: m.chapters[n].title, words: m.chapters[n].words, text: md };
  }

  coverPath(id) {
    const m = this.meta(id);
    return m?.cover ? path.join(this.dir(id), m.cover) : null;
  }

  setProgress(id, { chapter, word, total }) {
    const m = this.meta(id);
    if (!m) return null;
    const c = Math.min(m.chapters.length - 1, Math.max(0, Math.round(Number(chapter) || 0)));
    m.progress = { chapter: c, word: Math.max(0, Math.round(Number(word) || 0)), total: Math.max(0, Math.round(Number(total) || 0)), updatedAt: new Date().toISOString() };
    this.writeMeta(id, m);
    return this.summary(m);
  }

  remove(id) {
    const d = this.dir(id);
    if (!d || !fs.existsSync(d)) return false;
    fs.rmSync(d, { recursive: true, force: true });
    return true;
  }
}
