// PDF, MOBI/AZW/AZW3, TXT et Markdown : même résultat que parseEpub (titre, auteur, couverture, chapitres).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseHtml } from "node-html-parser";
import { getDocumentProxy } from "unpdf";
import { initMobiFile, initKf8File } from "@lingo-reader/mobi-parser";
import type { ParsedBook } from "../shared/types.ts";
import { parseEpub, toMarkdown, wordCount } from "./epub.ts";
import { HttpError } from "./store.ts";

type Chapter = ParsedBook["chapters"][number];

const stem = (name: string) => name.replace(/\.[^.]+$/, "").replace(/_+/g, " ").trim();

export const EXTENSIONS = [".epub", ".pdf", ".mobi", ".azw", ".azw3", ".txt", ".md", ".markdown"] as const;

export type Kind = "epub" | "pdf" | "mobi" | "text";

export function detectFormat(buf: Uint8Array, name = ""): Kind | null {
  const ext = path.extname(name).toLowerCase();
  const at = (from: number, to: number) => Buffer.from(buf.subarray(from, to)).toString("latin1");
  if (at(0, 5) === "%PDF-") return "pdf";
  if (at(60, 68) === "BOOKMOBI" || at(60, 68) === "TEXtREAd") return "mobi";
  if (buf[0] === 0x50 && buf[1] === 0x4b) return "epub";
  if ([".txt", ".md", ".markdown"].includes(ext)) return "text";
  if ([".mobi", ".azw", ".azw3"].includes(ext)) return "mobi";
  return null;
}

/** Regroupe les petits fragments avec le précédent. */
export function mergeSmall(chapters: Chapter[], min = 200): Chapter[] {
  const out: Chapter[] = [];
  for (const c of chapters) {
    const last = out[out.length - 1];
    if (last && (last.words < min || c.words < min / 2)) {
      last.md += `\n\n${c.md}`;
      last.words += c.words;
    } else out.push({ ...c });
  }
  return out;
}

/** Découpe un long texte en parties d'environ `size` mots, aux limites de paragraphes. */
export function chunk(md: string, size = 2500, label = "Partie"): Chapter[] {
  const out: Chapter[] = [];
  let buf: string[] = [];
  let n = 0;
  const flush = () => {
    if (!buf.length) return;
    const t = buf.join("\n\n");
    out.push({ title: `${label} ${out.length + 1}`, md: t, words: wordCount(t) });
    buf = [];
    n = 0;
  };
  for (const p of md.split(/\n{2,}/)) {
    const w = wordCount(p);
    if (n + w > size && n > 0) flush();
    buf.push(p);
    n += w;
  }
  flush();
  return out;
}

// ---------- Texte brut / Markdown ----------
function parseText(buf: Uint8Array, name: string): ParsedBook {
  const md = Buffer.from(buf).toString("utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  if (!md) throw new HttpError(400, "Fichier texte vide.");
  const parts = md.split(/^(?=#{1,2}\s)/m).filter((p) => p.trim());
  const chapters =
    parts.length > 1
      ? mergeSmall(parts.map((p) => ({ title: p.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim() ?? "Introduction", md: p.trim(), words: wordCount(p) })), 150)
      : chunk(md);
  if (chapters.length === 1 && chapters[0]) chapters[0].title = "Texte";
  return { title: md.match(/^#\s+(.+)$/m)?.[1]?.trim() || stem(name) || "Sans titre", author: "", language: "", cover: null, chapters };
}

// ---------- PDF ----------
interface Line {
  y: number;
  h: number;
  text: string;
}

type PdfDoc = Awaited<ReturnType<typeof getDocumentProxy>>;

async function pageLines(page: Awaited<ReturnType<PdfDoc["getPage"]>>): Promise<Line[]> {
  const { items } = await page.getTextContent();
  const rows: { y: number; h: number; parts: { x: number; s: string }[] }[] = [];
  for (const it of items) {
    if (!("str" in it) || !it.str || !it.transform) continue;
    const y = it.transform[5] as number;
    const h = Math.abs(it.transform[3] as number) || it.height || 10;
    let row = rows.find((r) => Math.abs(r.y - y) < h * 0.4);
    if (!row) rows.push((row = { y, h, parts: [] }));
    row.parts.push({ x: it.transform[4] as number, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((r) => ({ y: r.y, h: r.h, text: r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim() }))
    .filter((r) => r.text);
}

async function parsePdf(buf: Uint8Array, name: string): Promise<ParsedBook> {
  let pdf: PdfDoc;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buf));
  } catch (e) {
    throw new HttpError(400, (e as Error)?.name === "PasswordException" ? "PDF protégé par mot de passe." : "PDF illisible.");
  }
  const pages: Line[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) pages.push(await pageLines(await pdf.getPage(i)));

  // En-têtes / pieds de page : lignes courtes qui reviennent sur beaucoup de pages, et numéros de page.
  const shape = (t: string) => t.replace(/\d+/g, "#");
  const freq = new Map<string, number>();
  for (const lines of pages) for (const t of new Set(lines.map((l) => shape(l.text)))) freq.set(t, (freq.get(t) ?? 0) + 1);
  const repeated = (t: string) => pdf.numPages > 4 && t.length < 80 && (freq.get(shape(t)) ?? 0) > pdf.numPages * 0.4;
  const pageText = pages.map((lines) => {
    const kept = lines.filter((l) => !/^\W*(page\s+)?\d{1,4}(\s*[/-]\s*\d{1,4})?\W*$/i.test(l.text) && !repeated(l.text));
    const paras: string[] = [];
    let cur: string[] = [];
    let prev: Line | null = null;
    for (const l of kept) {
      if (prev && prev.y - l.y > prev.h * 1.7) {
        paras.push(cur.join(" "));
        cur = [];
      }
      cur.push(l.text);
      prev = l;
    }
    if (cur.length) paras.push(cur.join(" "));
    return paras.join("\n\n").replace(/(\p{L})- (\p{Ll})/gu, "$1$2");
  });

  // Chapitres : signets de premier niveau, sinon découpage par taille.
  let starts: { page: number; title: string }[] = [];
  try {
    for (const o of (await pdf.getOutline()) ?? []) {
      let dest: unknown = o.dest;
      if (typeof dest === "string") dest = await pdf.getDestination(dest);
      if (!Array.isArray(dest) || !dest[0]) continue;
      starts.push({ page: await pdf.getPageIndex(dest[0]), title: (o.title ?? "").trim() });
    }
  } catch {
    /* pas de signets exploitables */
  }
  starts = starts.filter((s, i) => s.title && (i === 0 || s.page > (starts[i - 1]?.page ?? -1)));

  let chapters: Chapter[];
  if (starts.length >= 2) {
    if ((starts[0]?.page ?? 0) > 0) starts.unshift({ page: 0, title: "Début" });
    chapters = starts.map((s, i) => {
      const md = pageText.slice(s.page, starts[i + 1]?.page ?? pdf.numPages).join("\n\n").trim();
      return { title: s.title, md, words: wordCount(md) };
    });
    chapters = mergeSmall(chapters.filter((c) => c.words > 0), 80);
  } else {
    chapters = chunk(pageText.join("\n\n"), 2500, "Partie");
  }
  chapters = chapters.filter((c) => c.words >= 3);
  if (!chapters.length) throw new HttpError(400, "Aucun texte extractible : ce PDF est probablement une numérisation (images).");

  let info: Record<string, unknown> = {};
  try {
    info = ((await pdf.getMetadata()).info as Record<string, unknown>) ?? {};
  } catch {
    /* facultatif */
  }
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return { title: str(info.Title) || stem(name) || "Sans titre", author: str(info.Author), language: "", cover: null, chapters };
}

// ---------- MOBI / AZW / AZW3 ----------
interface MobiLike {
  getSpine(): { id: string; text?: string }[];
  loadChapter(id: string): { html: string } | undefined;
  getToc(): { label: string; href: string; children?: unknown[] }[];
  getCoverImage?(): string;
  getMetadata(): { title?: string; author?: string[] | string; language?: string };
  resolveHref(href: string): { id: string } | undefined;
}

async function parseMobi(buf: Uint8Array, name: string): Promise<ParsedBook> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-mobi-"));
  const data = new Uint8Array(buf);
  try {
    let book: MobiLike | null = null;
    const order = /\.azw3$/i.test(name) ? [initKf8File, initMobiFile] : [initMobiFile, initKf8File];
    for (const init of order) {
      try {
        book = (await init(data, tmp)) as unknown as MobiLike;
        if (book.getSpine().length) break;
      } catch {
        book = null;
      }
    }
    if (!book) throw new HttpError(400, "Fichier MOBI illisible (format non pris en charge, ou protégé par DRM).");

    const meta = book.getMetadata();
    const toc = new Map<string, string>();
    const walk = (items: { label: string; href: string; children?: unknown[] }[] = []): void =>
      items.forEach((it) => {
        try {
          const r = book!.resolveHref(it.href);
          if (r && !toc.has(String(r.id)) && it.label?.trim()) toc.set(String(r.id), it.label.trim());
        } catch {
          /* lien non résolu */
        }
        walk(it.children as typeof items);
      });
    try {
      walk(book.getToc());
    } catch {
      /* sans table des matières */
    }

    const chapters: Chapter[] = [];
    for (const ch of book.getSpine()) {
      const html = book.loadChapter(ch.id)?.html ?? ch.text ?? "";
      const root = parseHtml(html);
      const md = toMarkdown(root.querySelector("body") ?? root);
      const words = wordCount(md);
      if (words < 3) continue;
      chapters.push({ title: toc.get(String(ch.id)) || md.match(/^#{1,3}\s+(.+)$/m)?.[1] || `Partie ${chapters.length + 1}`, md, words });
    }
    if (!chapters.length) throw new HttpError(400, "Aucun texte lisible dans ce fichier MOBI.");

    let cover: ParsedBook["cover"] = null;
    try {
      const c = book.getCoverImage?.();
      if (c && fs.existsSync(c)) cover = { data: fs.readFileSync(c), ext: path.extname(c).slice(1).toLowerCase() || "jpg" };
    } catch {
      /* couverture facultative */
    }
    const a = meta.author;
    return { title: (meta.title ?? "").trim() || stem(name) || "Sans titre", author: Array.isArray(a) ? a.join(", ") : (a ?? ""), language: meta.language ?? "", cover, chapters: mergeSmall(chapters) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function parseBook(buf: Uint8Array, name = ""): Promise<ParsedBook> {
  switch (detectFormat(buf, name)) {
    case "epub":
      return parseEpub(buf);
    case "pdf":
      return parsePdf(buf, name);
    case "mobi":
      return parseMobi(buf, name);
    case "text":
      return parseText(buf, name);
    default:
      throw new HttpError(400, "Format non pris en charge. Formats acceptés : EPUB, PDF, MOBI, AZW3, TXT, Markdown.");
  }
}
