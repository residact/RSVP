// Lecture d'un EPUB : métadonnées, couverture, chapitres convertis en markdown.
import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { parse as parseHtml, type HTMLElement, type Node } from "node-html-parser";
import path from "node:path";
import type { ParsedBook } from "../shared/types.ts";
import { HttpError } from "./store.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Xml = any;

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, trimValues: true });
const arr = <T>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: Xml): string => (typeof v === "object" && v !== null ? (v["#text"] ?? "") : (v ?? "")).toString().trim();
const dir = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
const norm = (base: string, href: string) => path.posix.normalize(dir(base) + decodeURIComponent(href.split("#")[0] ?? ""));

const SKIP = new Set(["script", "style", "svg", "img", "head"]);
const BLOCK = new Set(["p", "div", "section", "article", "li", "blockquote", "tr", "figure", "figcaption", "dd", "dt"]);
const tagOf = (n: Node): string => ((n as HTMLElement).rawTagName ?? "").toLowerCase();
const isHeading = (t: string) => /^h[1-6]$/.test(t);

export const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/** Convertit un nœud XHTML en markdown léger (titres, listes, gras, italique, code). */
export function toMarkdown(node: Node): string {
  const out: string[] = [];
  const inline = (n: Node): string => {
    if (n.nodeType === 3) return n.rawText.replace(/\s+/g, " ");
    const tag = tagOf(n);
    if (SKIP.has(tag)) return "";
    if (tag === "br") return "  \n";
    const inner = n.childNodes.map(inline).join("");
    if (tag === "em" || tag === "i") return inner.trim() ? `*${inner.trim()}*` : inner;
    if (tag === "strong" || tag === "b") return inner.trim() ? `**${inner.trim()}**` : inner;
    if (tag === "code") return `\`${inner}\``;
    return inner;
  };
  const walk = (n: Node): void => {
    if (n.nodeType === 3) {
      const t = n.rawText.replace(/\s+/g, " ").trim();
      if (t) out.push(t, "");
      return;
    }
    const tag = tagOf(n);
    if ([...SKIP, "nav"].includes(tag)) return;
    if (isHeading(tag)) {
      const t = n.childNodes.map(inline).join("").replace(/\s+/g, " ").trim();
      if (t) out.push(`${"#".repeat(Number(tag[1]))} ${t}`, "");
    } else if (tag === "pre") {
      out.push("```", n.text.replace(/\n+$/, ""), "```", "");
    } else if (tag === "ul" || tag === "ol") {
      let i = 1;
      for (const li of n.childNodes.filter((c) => tagOf(c) === "li")) {
        const t = li.childNodes.map(inline).join("").replace(/\s+/g, " ").trim();
        if (t) out.push(`${tag === "ol" ? `${i++}.` : "-"} ${t}`);
      }
      out.push("");
    } else if (tag === "blockquote") {
      out.push(...toMarkdown(n).split("\n").map((l) => (l ? `> ${l}` : ">")), "");
    } else if (BLOCK.has(tag) && !n.childNodes.some((c) => c.nodeType === 1 && (BLOCK.has(tagOf(c)) || isHeading(tagOf(c)) || /^(ul|ol|pre|table)$/.test(tagOf(c))))) {
      const t = n.childNodes.map(inline).join("").replace(/[ \t]+/g, " ").trim();
      if (t) out.push(t, "");
    } else {
      for (const c of n.childNodes) walk(c);
    }
  };
  walk(node);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function findFile(files: Record<string, Uint8Array>, name: string): Uint8Array | undefined {
  return files[name] ?? files[Object.keys(files).find((k) => k.toLowerCase() === name.toLowerCase()) ?? ""];
}

const COVER_EXT: Record<string, string> = { "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };

export function parseEpub(buffer: Uint8Array): ParsedBook {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buffer);
  } catch {
    throw new HttpError(400, "Fichier EPUB invalide (archive illisible).");
  }
  const container = findFile(files, "META-INF/container.xml");
  if (!container) throw new HttpError(400, "EPUB invalide : container.xml introuvable.");
  const opfPath: string | undefined = arr<Xml>(xml.parse(strFromU8(container)).container?.rootfiles?.rootfile)[0]?.["@full-path"];
  const opfRaw = opfPath ? findFile(files, opfPath) : undefined;
  if (!opfPath || !opfRaw) throw new HttpError(400, "EPUB invalide : fichier OPF introuvable.");
  const pkg: Xml = xml.parse(strFromU8(opfRaw)).package;

  const md: Xml = pkg.metadata ?? {};
  const title = text(arr<Xml>(md.title)[0]) || "Sans titre";
  const author = arr<Xml>(md.creator).map(text).filter(Boolean).join(", ");
  const language = text(arr<Xml>(md.language)[0]);

  const manifest = new Map<string, Xml>(arr<Xml>(pkg.manifest?.item).map((i) => [i["@id"], i]));
  const spine = arr<Xml>(pkg.spine?.itemref).map((r) => manifest.get(r["@idref"])).filter(Boolean);

  let cover: ParsedBook["cover"] = null;
  const coverMeta = arr<Xml>(md.meta).find((m) => m["@name"] === "cover");
  const coverItem = [...manifest.values()].find((i) => (i["@properties"] ?? "").split(" ").includes("cover-image")) ?? (coverMeta && manifest.get(coverMeta["@content"]));
  if (coverItem) {
    const data = findFile(files, norm(opfPath, coverItem["@href"]));
    if (data) cover = { data, ext: COVER_EXT[coverItem["@media-type"]] ?? "jpg" };
  }

  // Table des matières : EPUB 3 (nav) puis EPUB 2 (ncx)
  const tocTitles = new Map<string, string>();
  const navItem = [...manifest.values()].find((i) => (i["@properties"] ?? "").split(" ").includes("nav"));
  const ncxItem = [...manifest.values()].find((i) => i["@media-type"] === "application/x-dtbncx+xml");
  try {
    if (navItem) {
      const navPath = norm(opfPath, navItem["@href"]);
      const root = parseHtml(strFromU8(findFile(files, navPath)!));
      for (const a of root.querySelectorAll("nav a")) {
        const href = a.getAttribute("href");
        const t = a.text.replace(/\s+/g, " ").trim();
        if (href && t) {
          const key = norm(navPath, href);
          if (!tocTitles.has(key)) tocTitles.set(key, t);
        }
      }
    } else if (ncxItem) {
      const ncxPath = norm(opfPath, ncxItem["@href"]);
      const walk = (pts: Xml): void =>
        arr<Xml>(pts).forEach((p) => {
          const href = p.content?.["@src"];
          const t = text(p.navLabel?.text);
          if (href && t) {
            const key = norm(ncxPath, href);
            if (!tocTitles.has(key)) tocTitles.set(key, t);
          }
          walk(p.navPoint);
        });
      walk(xml.parse(strFromU8(findFile(files, ncxPath)!)).ncx?.navMap?.navPoint);
    }
  } catch {
    /* table des matières facultative */
  }

  const chapters: ParsedBook["chapters"] = [];
  for (const item of spine) {
    if (!/x?html/.test(item["@media-type"] ?? "")) continue;
    const file = norm(opfPath, item["@href"]);
    const raw = findFile(files, file);
    if (!raw) continue;
    const body = parseHtml(strFromU8(raw)).querySelector("body");
    if (!body) continue;
    const text = toMarkdown(body);
    const words = wordCount(text);
    if (words < 3) continue;
    const firstHeading = text.match(/^#{1,3}\s+(.+)$/m)?.[1];
    chapters.push({ title: tocTitles.get(file) || firstHeading || `Partie ${chapters.length + 1}`, md: text, words });
  }
  if (!chapters.length) throw new HttpError(400, "Aucun texte lisible trouvé dans cet EPUB.");
  return { title, author, language, cover, chapters };
}
