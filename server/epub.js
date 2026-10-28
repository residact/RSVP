// Lecture d'un EPUB : métadonnées, couverture, chapitres convertis en markdown.
import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { parse as parseHtml } from "node-html-parser";
import path from "node:path";

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, trimValues: true });
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v) => (typeof v === "object" && v !== null ? (v["#text"] ?? "") : (v ?? "")).toString().trim();
const dir = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
const norm = (base, href) => path.posix.normalize(dir(base) + decodeURIComponent(href.split("#")[0]));

const BLOCK = new Set(["p", "div", "section", "article", "li", "blockquote", "tr", "figure", "figcaption", "dd", "dt"]);

/** Convertit un nœud XHTML en markdown léger (titres, listes, gras, italique, code). */
export function toMarkdown(node) {
  const out = [];
  const inline = (n) => {
    if (n.nodeType === 3) return n.rawText.replace(/\s+/g, " ");
    const tag = (n.rawTagName ?? "").toLowerCase();
    if (["script", "style", "svg", "img", "head"].includes(tag)) return "";
    if (tag === "br") return "  \n";
    const inner = n.childNodes.map(inline).join("");
    if (tag === "em" || tag === "i") return inner.trim() ? `*${inner.trim()}*` : inner;
    if (tag === "strong" || tag === "b") return inner.trim() ? `**${inner.trim()}**` : inner;
    if (tag === "code") return `\`${inner}\``;
    return inner;
  };
  const walk = (n, ctx = {}) => {
    if (n.nodeType === 3) {
      const t = n.rawText.replace(/\s+/g, " ").trim();
      if (t) out.push(t, "");
      return;
    }
    const tag = (n.rawTagName ?? "").toLowerCase();
    if (["script", "style", "svg", "head", "nav"].includes(tag)) return;
    if (/^h[1-6]$/.test(tag)) {
      const t = n.childNodes.map(inline).join("").replace(/\s+/g, " ").trim();
      if (t) out.push(`${"#".repeat(Number(tag[1]))} ${t}`, "");
    } else if (tag === "pre") {
      out.push("```", n.text.replace(/\n+$/, ""), "```", "");
    } else if (tag === "ul" || tag === "ol") {
      let i = 1;
      for (const li of n.childNodes.filter((c) => (c.rawTagName ?? "").toLowerCase() === "li")) {
        const t = li.childNodes.map(inline).join("").replace(/\s+/g, " ").trim();
        if (t) out.push(`${tag === "ol" ? `${i++}.` : "-"} ${t}`);
      }
      out.push("");
    } else if (tag === "blockquote") {
      const sub = toMarkdown(n).split("\n").map((l) => (l ? `> ${l}` : ">"));
      out.push(...sub, "");
    } else if (BLOCK.has(tag) && !n.childNodes.some((c) => c.nodeType === 1 && (BLOCK.has((c.rawTagName ?? "").toLowerCase()) || /^h[1-6]$|^(ul|ol|pre|table)$/.test((c.rawTagName ?? "").toLowerCase())))) {
      const t = n.childNodes.map(inline).join("").replace(/[ \t]+/g, " ").trim();
      if (t) out.push(t, "");
    } else {
      for (const c of n.childNodes) walk(c, ctx);
    }
  };
  walk(node);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const wordCount = (s) => s.split(/\s+/).filter(Boolean).length;

function findFile(files, name) {
  return files[name] ?? files[Object.keys(files).find((k) => k.toLowerCase() === name.toLowerCase())];
}

export function parseEpub(buffer) {
  let files;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw Object.assign(new Error("Fichier EPUB invalide (archive illisible)."), { status: 400 });
  }
  const container = findFile(files, "META-INF/container.xml");
  if (!container) throw Object.assign(new Error("EPUB invalide : container.xml introuvable."), { status: 400 });
  const opfPath = arr(xml.parse(strFromU8(container)).container?.rootfiles?.rootfile)[0]?.["@full-path"];
  const opfRaw = opfPath && findFile(files, opfPath);
  if (!opfRaw) throw Object.assign(new Error("EPUB invalide : fichier OPF introuvable."), { status: 400 });
  const pkg = xml.parse(strFromU8(opfRaw)).package;

  const md = pkg.metadata ?? {};
  const title = text(arr(md.title)[0]) || "Sans titre";
  const author = arr(md.creator).map(text).filter(Boolean).join(", ");
  const language = text(arr(md.language)[0]);

  const manifest = new Map(arr(pkg.manifest?.item).map((i) => [i["@id"], i]));
  const spine = arr(pkg.spine?.itemref).map((r) => manifest.get(r["@idref"])).filter(Boolean);

  // Couverture
  let cover = null;
  const coverMeta = arr(md.meta).find((m) => m["@name"] === "cover");
  const coverItem = [...manifest.values()].find((i) => (i["@properties"] ?? "").split(" ").includes("cover-image")) ?? (coverMeta && manifest.get(coverMeta["@content"]));
  if (coverItem) {
    const data = findFile(files, norm(opfPath, coverItem["@href"]));
    if (data) cover = { data: Buffer.from(data), ext: ({ "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" })[coverItem["@media-type"]] ?? "jpg" };
  }

  // Table des matières : EPUB 3 (nav) puis EPUB 2 (ncx)
  const tocTitles = new Map();
  const navItem = [...manifest.values()].find((i) => (i["@properties"] ?? "").split(" ").includes("nav"));
  const ncxItem = [...manifest.values()].find((i) => i["@media-type"] === "application/x-dtbncx+xml");
  try {
    if (navItem) {
      const navPath = norm(opfPath, navItem["@href"]);
      const root = parseHtml(strFromU8(findFile(files, navPath)));
      for (const a of root.querySelectorAll("nav a")) {
        const href = a.getAttribute("href");
        const t = a.text.replace(/\s+/g, " ").trim();
        if (href && t) { const key = norm(navPath, href); if (!tocTitles.has(key)) tocTitles.set(key, t); }
      }
    } else if (ncxItem) {
      const ncxPath = norm(opfPath, ncxItem["@href"]);
      const walk = (pts) => arr(pts).forEach((p) => {
        const href = p.content?.["@src"];
        const t = text(p.navLabel?.text);
        if (href && t) { const key = norm(ncxPath, href); if (!tocTitles.has(key)) tocTitles.set(key, t); }
        walk(p.navPoint);
      });
      walk(xml.parse(strFromU8(findFile(files, ncxPath))).ncx?.navMap?.navPoint);
    }
  } catch { /* table des matières facultative */ }

  const chapters = [];
  for (const item of spine) {
    if (!/x?html/.test(item["@media-type"] ?? "")) continue;
    const file = norm(opfPath, item["@href"]);
    const raw = findFile(files, file);
    if (!raw) continue;
    const body = parseHtml(strFromU8(raw)).querySelector("body");
    if (!body) continue;
    const md = toMarkdown(body);
    const words = wordCount(md);
    if (words < 3) continue;
    const firstHeading = md.match(/^#{1,3}\s+(.+)$/m)?.[1];
    chapters.push({ title: tocTitles.get(file) || firstHeading || `Partie ${chapters.length + 1}`, md, words });
  }
  if (!chapters.length) throw Object.assign(new Error("Aucun texte lisible trouvé dans cet EPUB."), { status: 400 });
  return { title, author, language, cover, chapters };
}
