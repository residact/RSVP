// PDF, MOBI/AZW/AZW3, TXT et Markdown : même résultat que parseEpub (titre, auteur, couverture, chapitres).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseHtml } from "node-html-parser";
import { getDocumentProxy } from "unpdf";
import { initMobiFile, initKf8File } from "@lingo-reader/mobi-parser";
import { parseEpub, toMarkdown } from "./epub.js";

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const wordCount = (s) => s.split(/\s+/).filter(Boolean).length;
const stem = (name) => name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();

export const EXTENSIONS = [".epub", ".pdf", ".mobi", ".azw", ".azw3", ".txt", ".md", ".markdown"];

export function detectFormat(buf, name = "") {
  const ext = path.extname(name).toLowerCase();
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buf.subarray(60, 68).toString("latin1") === "BOOKMOBI" || buf.subarray(60, 68).toString("latin1") === "TEXtREAd") return "mobi";
  if (buf[0] === 0x50 && buf[1] === 0x4b) return "epub";
  if ([".txt", ".md", ".markdown"].includes(ext)) return "text";
  if ([".mobi", ".azw", ".azw3"].includes(ext)) return "mobi";
  return null;
}

/** Regroupe en morceaux d'au moins `min` mots (les petits fragments sont fusionnés au précédent). */
function mergeSmall(chapters, min = 200) {
  const out = [];
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
function chunk(md, size = 2500, label = "Partie") {
  const paras = md.split(/\n{2,}/);
  const out = [];
  let buf = [], n = 0;
  const flush = () => { if (buf.length) { const t = buf.join("\n\n"); out.push({ title: `${label} ${out.length + 1}`, md: t, words: wordCount(t) }); buf = []; n = 0; } };
  for (const p of paras) {
    const w = wordCount(p);
    if (n + w > size && n > 0) flush();
    buf.push(p); n += w;
  }
  flush();
  return out;
}

// ---------- Texte brut / Markdown ----------
function parseText(buf, name) {
  const md = buf.toString("utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  if (!md) throw bad("Fichier texte vide.");
  const parts = md.split(/^(?=#{1,2}\s)/m).filter((p) => p.trim());
  let chapters = parts.length > 1
    ? mergeSmall(parts.map((p) => ({ title: p.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim() ?? "Introduction", md: p.trim(), words: wordCount(p) })), 150)
    : chunk(md);
  if (chapters.length === 1) chapters[0].title = "Texte";
  const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim() || stem(name) || "Sans titre";
  return { title, author: "", language: "", cover: null, chapters };
}

// ---------- PDF ----------
async function pageLines(page) {
  const { items } = await page.getTextContent();
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.transform) continue;
    const y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
    let row = rows.find((r) => Math.abs(r.y - y) < h * 0.4);
    if (!row) rows.push((row = { y, h, parts: [] }));
    row.parts.push({ x: it.transform[4], s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => ({ y: r.y, h: r.h, text: r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim() })).filter((r) => r.text);
}

async function parsePdf(buf, name) {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buf));
  } catch (e) {
    throw bad(e?.name === "PasswordException" ? "PDF protégé par mot de passe." : "PDF illisible.");
  }
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) pages.push(await pageLines(await pdf.getPage(i)));

  // En-têtes / pieds de page : lignes courtes qui reviennent sur beaucoup de pages, et numéros de page.
  const freq = new Map();
  for (const lines of pages) for (const t of new Set(lines.map((l) => l.text.replace(/\d+/g, "#")))) freq.set(t, (freq.get(t) ?? 0) + 1);
  const repeated = (t) => pdf.numPages > 4 && t.length < 80 && (freq.get(t.replace(/\d+/g, "#")) ?? 0) > pdf.numPages * 0.4;
  const pageText = pages.map((lines) => {
    const kept = lines.filter((l) => !/^\W*(page\s+)?\d{1,4}(\s*[/\-]\s*\d{1,4})?\W*$/i.test(l.text) && !repeated(l.text));
    const paras = [];
    let cur = [], prev = null;
    for (const l of kept) {
      if (prev && prev.y - l.y > prev.h * 1.7) { paras.push(cur.join(" ")); cur = []; }
      cur.push(l.text);
      prev = l;
    }
    if (cur.length) paras.push(cur.join(" "));
    return paras.join("\n\n").replace(/(\p{L})- (\p{Ll})/gu, "$1$2");
  });

  // Chapitres : signets de premier niveau, sinon découpage par taille.
  let starts = [];
  try {
    const outline = (await pdf.getOutline()) ?? [];
    for (const o of outline) {
      let dest = o.dest;
      if (typeof dest === "string") dest = await pdf.getDestination(dest);
      if (!Array.isArray(dest) || !dest[0]) continue;
      const pageIdx = await pdf.getPageIndex(dest[0]);
      starts.push({ page: pageIdx, title: (o.title ?? "").trim() });
    }
  } catch { /* pas de signets exploitables */ }
  starts = starts.filter((s, i) => s.title && (i === 0 || s.page > starts[i - 1].page));

  let chapters;
  if (starts.length >= 2) {
    if (starts[0].page > 0) starts.unshift({ page: 0, title: "Début" });
    chapters = starts.map((s, i) => {
      const md = pageText.slice(s.page, starts[i + 1]?.page ?? pdf.numPages).join("\n\n").trim();
      return { title: s.title, md, words: wordCount(md) };
    });
    chapters = mergeSmall(chapters.filter((c) => c.words > 0), 80);
  } else {
    chapters = chunk(pageText.join("\n\n"), 2500, "Partie");
  }
  chapters = chapters.filter((c) => c.words >= 3);
  if (!chapters.length) throw bad("Aucun texte extractible : ce PDF est probablement une numérisation (images).");

  let info = {};
  try { info = (await pdf.getMetadata()).info ?? {}; } catch { /* facultatif */ }
  return { title: (info.Title ?? "").trim() || stem(name) || "Sans titre", author: (info.Author ?? "").trim(), language: "", cover: null, chapters };
}

// ---------- MOBI / AZW / AZW3 ----------
async function parseMobi(buf, name) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-mobi-"));
  const data = new Uint8Array(buf);
  try {
    let book;
    const kf8First = /\.azw3$/i.test(name);
    const order = kf8First ? [initKf8File, initMobiFile] : [initMobiFile, initKf8File];
    for (const init of order) {
      try { book = await init(data, tmp); if (book.getSpine().length) break; } catch { book = null; }
    }
    if (!book) throw bad("Fichier MOBI illisible (format non pris en charge, ou protégé par DRM).");

    const meta = book.getMetadata?.() ?? {};
    const spine = book.getSpine();
    const toc = new Map();
    const walk = (items = []) => items.forEach((it) => {
      try { const r = book.resolveHref(it.href); if (r && !toc.has(r.id) && it.label?.trim()) toc.set(String(r.id), it.label.trim()); } catch { /* lien non résolu */ }
      walk(it.children);
    });
    try { walk(book.getToc()); } catch { /* sans table des matières */ }

    const chapters = [];
    for (const ch of spine) {
      const html = book.loadChapter(ch.id)?.html ?? ch.text ?? "";
      const body = parseHtml(html).querySelector("body") ?? parseHtml(html);
      const md = toMarkdown(body);
      const words = wordCount(md);
      if (words < 3) continue;
      const heading = md.match(/^#{1,3}\s+(.+)$/m)?.[1];
      chapters.push({ title: toc.get(String(ch.id)) || heading || `Partie ${chapters.length + 1}`, md, words });
    }
    if (!chapters.length) throw bad("Aucun texte lisible dans ce fichier MOBI.");

    let cover = null;
    try {
      const c = book.getCoverImage?.();
      if (c && fs.existsSync(c)) cover = { data: fs.readFileSync(c), ext: path.extname(c).slice(1).toLowerCase() || "jpg" };
    } catch { /* couverture facultative */ }
    const a = meta.author;
    return { title: (meta.title ?? "").trim() || stem(name) || "Sans titre", author: Array.isArray(a) ? a.join(", ") : (a ?? ""), language: meta.language ?? "", cover, chapters: mergeSmall(chapters) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function parseBook(buf, name = "") {
  const kind = detectFormat(buf, name);
  if (kind === "epub") return parseEpub(buf);
  if (kind === "pdf") return parsePdf(buf, name);
  if (kind === "mobi") return parseMobi(buf, name);
  if (kind === "text") return parseText(buf, name);
  throw bad("Format non pris en charge. Formats acceptés : EPUB, PDF, MOBI, AZW3, TXT, Markdown.");
}
