import { expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Books } from "../src/server/books.ts";
import { chunk, detectFormat, mergeSmall, parseBook } from "../src/server/formats.ts";

const para = (t: string, n: number) => Array.from({ length: n }, (_, i) => `<p>${t} ${i} avec <em>de l'italique</em> et assez de mots pour compter.</p>`).join("");

function makeEpub(): Uint8Array {
  const page = (title: string, n: number) => strToU8(`<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>${title}</h1>${para(title, n)}</body></html>`);
  return zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    "OEBPS/content.opf": strToU8('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Livre de test</dc:title><dc:creator>Jeanne</dc:creator><dc:language>fr</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>'),
    "OEBPS/nav.xhtml": strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><body><nav><ol><li><a href="a.xhtml">Début</a></li><li><a href="b.xhtml">Fin</a></li></ol></nav></body></html>'),
    "OEBPS/a.xhtml": page("Alpha", 10),
    "OEBPS/b.xhtml": page("Beta", 6),
  });
}

test("détection du format par signature puis extension", () => {
  expect(detectFormat(new TextEncoder().encode("%PDF-1.7 ..."))).toBe("pdf");
  expect(detectFormat(makeEpub(), "x.bin")).toBe("epub");
  expect(detectFormat(new TextEncoder().encode("bonjour"), "notes.md")).toBe("text");
  expect(detectFormat(new TextEncoder().encode("bonjour"), "x.docx")).toBeNull();
});

test("EPUB : métadonnées, table des matières et markdown des chapitres", async () => {
  const book = await parseBook(makeEpub(), "t.epub");
  expect(book.title).toBe("Livre de test");
  expect(book.author).toBe("Jeanne");
  expect(book.chapters.map((c) => c.title)).toEqual(["Début", "Fin"]);
  expect(book.chapters[0]?.md).toContain("# Alpha");
  expect(book.chapters[0]?.md).toContain("*de l'italique*");
});

test("Markdown : découpage par titres", async () => {
  const md = `# Mon livre\n\n${"mot ".repeat(200)}\n\n## Suite\n\n${"autre ".repeat(200)}`;
  const book = await parseBook(new TextEncoder().encode(md), "livre.md");
  expect(book.title).toBe("Mon livre");
  expect(book.chapters.map((c) => c.title)).toEqual(["Mon livre", "Suite"]);
});

test("format inconnu et fichier illisible renvoient une erreur claire", async () => {
  await expect(parseBook(new TextEncoder().encode("x"), "a.docx")).rejects.toThrow("Format non pris en charge");
  await expect(parseBook(new Uint8Array([0x50, 0x4b, 1, 2, 3]), "a.epub")).rejects.toThrow("EPUB invalide");
  await expect(parseBook(new TextEncoder().encode("garbage"), "a.mobi")).rejects.toThrow("MOBI illisible");
});

test("regroupement et découpage", () => {
  expect(mergeSmall([{ title: "a", md: "x", words: 10 }, { title: "b", md: "y", words: 500 }], 200)).toHaveLength(1);
  const long = Array.from({ length: 30 }, () => "mot ".repeat(100).trim()).join("\n\n");
  expect(chunk(long, 1000).length).toBeGreaterThanOrEqual(3);
});

test("bibliothèque : import, doublon, progression, pourcentage, suppression", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-books-"));
  try {
    const books = new Books(dir);
    const epub = makeEpub();
    const added = await books.add(epub, "t.epub");
    expect(added.chapterCount).toBe(2);
    expect((await books.add(epub, "t.epub")).duplicate).toBe(true);
    expect(books.list()).toHaveLength(1);
    expect(books.chapter(added.id, 1)?.title).toBe("Fin");
    expect(books.chapter(added.id, 9)).toBeNull();
    expect(books.chapter("../etc", 0)).toBeNull();
    const p = books.setProgress(added.id, { chapter: 1, word: 0, total: 50 });
    expect(p?.percent).toBeGreaterThan(40);
    expect(books.get(added.id)?.progress?.chapter).toBe(1);
    expect(books.remove(added.id)).toBe(true);
    expect(books.list()).toHaveLength(0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
