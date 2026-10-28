// Rendu markdown minimal et sûr (tout le HTML est échappé), plus découpage en mots.
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(src: string): string {
  const codes: string[] = [];
  let s = esc(src).replace(/`([^`]+)`/g, (_, c: string) => `\u0000${codes.push(`<code>${c}</code>`) - 1}\u0000`);
  s = s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a?: string, b?: string) => `<strong>${a ?? b}</strong>`)
    .replace(/(?<![\w*])\*([^*\s](?:[^*]*[^*\s])?)\*(?![\w*])/g, "<em>$1</em>")
    .replace(/(?<![\w_])_([^_\s](?:[^_]*[^_\s])?)_(?![\w_])/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)] ?? "");
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function list(lines: string[], start: number): [string, number] {
  let i = start;
  const first = lines[i]!.match(LIST_RE)!;
  const base = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  let html = ordered ? "<ol>" : "<ul>";
  while (i < lines.length) {
    const m = lines[i]!.match(LIST_RE);
    if (!m || m[1]!.length < base) break;
    if (m[1]!.length > base) {
      const [sub, next] = list(lines, i);
      html = html.replace(/<\/li>$/, `${sub}</li>`);
      i = next;
      continue;
    }
    html += `<li>${inline(m[3]!.replace(/^\[[ xX]\]\s+/, (c) => (/[xX]/.test(c) ? "☑ " : "☐ ")))}</li>`;
    i++;
  }
  return [html + (ordered ? "</ol>" : "</ul>"), i];
}

export function toHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) buf.push(lines[i++]!);
      i++;
      out.push(`<pre class="codeblock"><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const hd = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (hd) { out.push(`<h${hd[1]!.length}>${inline(hd[2]!)}</h${hd[1]!.length}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) buf.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${toHtml(buf.join("\n"))}</blockquote>`);
      continue;
    }
    if (LIST_RE.test(line)) {
      const [html, next] = list(lines, i);
      out.push(html);
      i = next;
      continue;
    }
    if (line.includes("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) rows.push(cells(lines[i++]!));
      out.push(`<div class="tablewrap"><table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(\s*(```|~~~)|#{1,6}\s|\s*>|\s*([-*+]|\d+[.)])\s)/.test(lines[i]!)) buf.push(lines[i++]!);
    out.push(`<p>${inline(buf.join(" ")).replace(/ {2,}/g, " ")}</p>`);
  }
  return out.join("\n");
}

/** Rend le markdown dans un élément et enveloppe chaque mot dans un <span> : ce sont les mots lus. */
export function renderMarkdown(md: string): { el: HTMLDivElement; words: HTMLSpanElement[] } {
  const el = document.createElement("div");
  el.className = "md";
  el.innerHTML = toHtml(md);
  for (const block of el.querySelectorAll("pre.codeblock")) {
    const mark = document.createElement("span");
    mark.className = "w codemark";
    mark.textContent = "[code]";
    block.before(mark);
  }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("pre.codeblock") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (!node.nodeValue?.trim()) continue;
    const frag = document.createDocumentFragment();
    for (const part of node.nodeValue.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) frag.append(part);
      else {
        const s = document.createElement("span");
        s.className = "w";
        s.textContent = part;
        frag.append(s);
      }
    }
    node.replaceWith(frag);
  }
  return { el, words: [...el.querySelectorAll<HTMLSpanElement>("span.w")] };
}
