// Bibliothèque : un dossier par livre (meta.json, chapitres .md, couverture).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BookDetail, BookSummary, ChapterContent, ChapterInfo, Progress } from "../shared/types.ts";
import { parseBook } from "./formats.ts";

interface BookMeta {
  id: string;
  title: string;
  author: string;
  language: string;
  fileName: string;
  cover: string | null;
  addedAt: string;
  chapters: ChapterInfo[];
  progress: Progress | null;
}

const ID_RE = /^[a-f0-9]{12}$/;
const pad = (n: number) => String(n).padStart(4, "0");

export class Books {
  private root: string;

  constructor(dataDir: string) {
    this.root = path.join(dataDir, "books");
    fs.mkdirSync(this.root, { recursive: true });
  }

  private dir(id: string): string | null {
    return ID_RE.test(id) ? path.join(this.root, id) : null;
  }

  private meta(id: string): BookMeta | null {
    const d = this.dir(id);
    try {
      return d ? (JSON.parse(fs.readFileSync(path.join(d, "meta.json"), "utf8")) as BookMeta) : null;
    } catch {
      return null;
    }
  }

  private writeMeta(meta: BookMeta): void {
    const f = path.join(this.dir(meta.id)!, "meta.json");
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(meta));
    fs.renameSync(`${f}.tmp`, f);
  }

  private percent(m: BookMeta): number {
    const p = m.progress;
    if (!p) return 0;
    const total = m.chapters.reduce((n, c) => n + c.words, 0) || 1;
    const before = m.chapters.slice(0, p.chapter).reduce((n, c) => n + c.words, 0);
    const cur = m.chapters[p.chapter];
    const frac = cur && p.total ? Math.min(1, p.word / Math.max(1, p.total - 1)) : 0;
    return Math.min(100, Math.round(((before + (cur?.words ?? 0) * frac) / total) * 1000) / 10);
  }

  private summary(m: BookMeta): BookSummary {
    const { chapters, ...rest } = m;
    return { ...rest, chapterCount: chapters.length, totalWords: chapters.reduce((n, c) => n + c.words, 0), percent: this.percent(m) };
  }

  list(): BookSummary[] {
    return fs
      .readdirSync(this.root)
      .map((id) => this.meta(id))
      .filter((m): m is BookMeta => m !== null)
      .map((m) => this.summary(m))
      .sort((a, b) => (b.progress?.updatedAt ?? b.addedAt).localeCompare(a.progress?.updatedAt ?? a.addedAt));
  }

  get(id: string): BookDetail | null {
    const m = this.meta(id);
    return m && { ...this.summary(m), chapters: m.chapters };
  }

  async add(buffer: Uint8Array, fileName = ""): Promise<BookSummary> {
    const id = createHash("sha1").update(buffer).digest("hex").slice(0, 12);
    const existing = this.meta(id);
    if (existing) return { ...this.summary(existing), duplicate: true };
    const book = await parseBook(buffer, fileName);
    const d = this.dir(id)!;
    fs.mkdirSync(d, { recursive: true });
    book.chapters.forEach((c, i) => fs.writeFileSync(path.join(d, `${pad(i)}.md`), c.md));
    if (book.cover) fs.writeFileSync(path.join(d, `cover.${book.cover.ext}`), book.cover.data);
    const meta: BookMeta = {
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
    this.writeMeta(meta);
    return this.summary(meta);
  }

  chapter(id: string, n: number): ChapterContent | null {
    const m = this.meta(id);
    const c = m?.chapters[n];
    if (!m || !c || !Number.isInteger(n)) return null;
    const text = fs.readFileSync(path.join(this.dir(id)!, `${pad(n)}.md`), "utf8");
    return { index: n, count: m.chapters.length, title: c.title, words: c.words, text };
  }

  coverPath(id: string): string | null {
    const m = this.meta(id);
    return m?.cover ? path.join(this.dir(id)!, m.cover) : null;
  }

  setProgress(id: string, p: { chapter?: unknown; word?: unknown; total?: unknown }): BookSummary | null {
    const m = this.meta(id);
    if (!m) return null;
    const int = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
    m.progress = { chapter: Math.min(m.chapters.length - 1, int(p.chapter)), word: int(p.word), total: int(p.total), updatedAt: new Date().toISOString() };
    this.writeMeta(m);
    return this.summary(m);
  }

  remove(id: string): boolean {
    const d = this.dir(id);
    if (!d || !fs.existsSync(d)) return false;
    fs.rmSync(d, { recursive: true, force: true });
    return true;
  }
}
