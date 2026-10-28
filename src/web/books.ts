// Section « Livres » : bibliothèque, fiche d'un livre, lecture avec reprise.
import type { BookDetail, BookSummary, ChapterContent } from "../shared/types.ts";
import { AuthError, ago, api, h, icon, minutes, state, toast, type Cleanup, type Ctx } from "./lib.ts";
import { mountReader } from "./reader.ts";

const coverUrl = (b: BookSummary): string => `/api/books/${b.id}/cover?token=${encodeURIComponent(state.token)}`;
const hue = (s: string): number => [...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 7);

function cover(b: BookSummary, cls = ""): HTMLElement {
  if (b.cover) return h("img", { class: `cover ${cls}`, src: coverUrl(b), alt: `Couverture de ${b.title}`, loading: "lazy" });
  return h("div", { class: `cover fake ${cls}`, style: `--h:${hue(b.title)}`, "aria-hidden": "true" }, h("b", {}, b.title.slice(0, 60)), h("small", {}, b.author));
}

const where = (b: BookSummary): string => (b.progress ? `Chap. ${b.progress.chapter + 1}/${b.chapterCount} · ${b.percent} %` : "Pas commencé");
const target = (b: BookSummary): string => `#/read/${b.id}`;
const SUPPORTED = /\.(epub|pdf|mobi|azw3?|txt|md|markdown)$/i;

function card(b: BookSummary): HTMLElement {
  return h("a", { class: "bookcard", href: `#/book/${b.id}`, title: b.title },
    cover(b),
    h("div", { class: "bookmeta" },
      h("b", {}, b.title),
      h("span", { class: "muted" }, b.author || "Auteur inconnu"),
      h("div", { class: "bar" }, h("i", { style: `width:${b.percent}%` })),
      h("span", { class: "muted small" }, where(b))));
}

export async function libraryPage(root: HTMLElement, { go }: Ctx): Promise<Cleanup> {
  const list = h("div", { class: "books" });
  const resume = h("div");
  const input = h("input", { type: "file", accept: ".epub,.pdf,.mobi,.azw,.azw3,.txt,.md,.markdown", multiple: true, hidden: true });
  const status = h("span", { class: "muted" });
  const pick = (): void => input.click();
  const drop = h("div", { class: "drop", tabIndex: 0, role: "button", onclick: pick, onkeydown: (e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && pick() },
    icon("upload"),
    h("div", {}, h("b", {}, "Ajouter des livres"), h("div", { class: "muted" }, "EPUB, PDF, MOBI, AZW3, TXT ou Markdown : glisse tes fichiers ici ou clique pour les choisir")),
    status);

  async function upload(files: File[]): Promise<void> {
    let last: BookSummary | undefined;
    for (const f of files) {
      if (!SUPPORTED.test(f.name)) { toast(`${f.name} : format non pris en charge (EPUB, PDF, MOBI, AZW3, TXT, MD)`); continue; }
      status.textContent = `Import de ${f.name}…`;
      drop.classList.add("busy");
      try {
        const res = await fetch(`/api/books?name=${encodeURIComponent(f.name)}`, { method: "POST", headers: { authorization: `Bearer ${state.token}` }, body: f });
        const data = (await res.json()) as BookSummary & { error?: string };
        if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
        last = data;
        toast(data.duplicate ? `Déjà dans la bibliothèque : ${data.title}` : `Ajouté : ${data.title}`);
      } catch (e) { toast(`${f.name} : ${(e as Error).message}`); }
    }
    status.textContent = "";
    drop.classList.remove("busy");
    input.value = "";
    await load();
    if (files.length === 1 && last && !last.duplicate) go(`/book/${last.id}`);
  }
  input.addEventListener("change", () => void upload([...(input.files ?? [])]));
  for (const t of ["dragenter", "dragover"]) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); });
  for (const t of ["dragleave", "drop"]) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); });
  drop.addEventListener("drop", (e) => void upload([...(e.dataTransfer?.files ?? [])]));

  async function load(): Promise<void> {
    const books = await api<BookSummary[]>("/books");
    const current = books.find((b) => b.progress && b.percent < 100);
    resume.replaceChildren(...(current?.progress ? [h("div", { class: "card resume" },
      cover(current, "small"),
      h("div", { style: "flex:1;min-width:0" },
        h("span", { class: "label" }, "Reprendre la lecture"),
        h("h2", {}, current.title),
        h("p", { class: "hint", style: "margin:0 0 10px" }, `${where(current)} · lu ${ago(current.progress.updatedAt)}`),
        h("div", { class: "bar" }, h("i", { style: `width:${current.percent}%` })),
        h("a", { class: "btn primary", style: "margin-top:12px", href: target(current) }, icon("play"), "Reprendre")))] : []));
    list.replaceChildren(...(books.length ? books.map(card) : [h("div", { class: "empty", style: "grid-column:1/-1" }, h("h2", {}, "Ta bibliothèque est vide"), h("p", {}, "Ajoute un livre pour commencer."))]));
  }

  root.append(h("div", { class: "page wide" },
    h("h1", {}, "Livres"),
    h("p", { class: "sub" }, "Charge des livres (EPUB, PDF, MOBI…), lis-les en RSVP : la lecture reprend là où tu t’étais arrêté, sur tous tes appareils."),
    resume, drop, input, h("div", { style: "height:18px" }), list));
  await load();
  return () => {};
}

export async function bookPage(root: HTMLElement, id: string, { go }: Ctx): Promise<Cleanup> {
  const b = await api<BookDetail>(`/books/${id}`);
  const rows = b.chapters.map((c, i) => {
    const cur = b.progress?.chapter === i;
    const done = b.progress !== null && i < b.progress.chapter;
    return h("a", { class: "chap" + (cur ? " cur" : ""), href: `#/read/${id}/${i}` },
      h("span", { class: "n" }, done ? "✓" : String(i + 1)),
      h("span", { class: "t" }, c.title),
      h("span", { class: "muted small" }, `${c.words} mots`));
  });
  root.append(h("div", { class: "page" },
    h("a", { href: "#/books", class: "muted", style: "text-decoration:none" }, "← Bibliothèque"),
    h("div", { class: "card bookhead" },
      cover(b, "large"),
      h("div", { style: "flex:1;min-width:0" },
        h("h1", { style: "margin-top:0" }, b.title),
        h("p", { class: "sub", style: "margin-bottom:12px" }, b.author || "Auteur inconnu"),
        h("div", { class: "row", style: "margin-bottom:12px" },
          h("span", { class: "pill" }, `${b.chapterCount} chapitres`), h("span", { class: "pill" }, `${b.totalWords.toLocaleString("fr-FR")} mots`),
          h("span", { class: "pill" }, `≈ ${minutes(b.totalWords, state.settings.wpm)} à ${state.settings.wpm} mots/min`)),
        h("div", { class: "bar" }, h("i", { style: `width:${b.percent}%` })),
        h("p", { class: "muted small" }, where(b)),
        h("div", { class: "row" },
          h("a", { class: "btn primary", href: target(b) }, icon("play"), b.progress ? "Reprendre" : "Commencer"),
          b.progress && h("button", { class: "btn", onclick: async () => { await api(`/books/${id}/progress`, { method: "PUT", body: { chapter: 0, word: 0, total: 0 } }); location.reload(); } }, "Recommencer"),
          h("button", { class: "btn danger", onclick: async () => {
            if (!confirm(`Supprimer « ${b.title} » de la bibliothèque ?`)) return;
            await api(`/books/${id}`, { method: "DELETE" });
            toast("Livre supprimé");
            go("/books");
          } }, icon("trash"), "Supprimer")))),
    h("div", { class: "card" }, h("h2", {}, "Chapitres"), h("div", { class: "chaps" }, rows))));
  return () => {};
}

export async function bookReaderPage(root: HTMLElement, id: string, chapterArg: string | undefined, autoplay: boolean, { go }: Ctx): Promise<Cleanup> {
  let b: BookDetail;
  try { b = await api<BookDetail>(`/books/${id}`); } catch (e) { if (e instanceof AuthError) throw e; throw new Error("Livre introuvable."); }
  const n = chapterArg !== undefined ? Number(chapterArg) : (b.progress?.chapter ?? 0);
  const ch = await api<ChapterContent>(`/books/${id}/chapters/${n}`);
  const start = b.progress?.chapter === n ? b.progress.word : 0;

  const put = (chapter: number, word: number, total: number): Promise<unknown> =>
    api(`/books/${id}/progress`, { method: "PUT", body: { chapter, word, total } }).catch(() => {});
  const select = h("select", { class: "field chapselect", "aria-label": "Chapitre", onchange: () => go(`/read/${id}/${select.value}`) },
    ...b.chapters.map((c, i) => h("option", { value: i, selected: i === n }, `${i + 1}. ${c.title}`.slice(0, 70))));

  return mountReader(root, {
    title: b.title,
    subtitle: `Chapitre ${n + 1}/${ch.count} · ${ch.title}`,
    text: ch.text,
    start,
    autoplay,
    onProgress: (word, total) => void put(n, word, total),
    onEnd: () => {
      if (n + 1 < ch.count) {
        void put(n + 1, 0, 0);
        toast("Chapitre suivant…");
        setTimeout(() => { if (location.hash.startsWith(`#/read/${id}`)) go(`/read/${id}/${n + 1}/play`); }, 1200);
      } else toast("Livre terminé 🎉");
    },
    headExtra: [
      n > 0 && h("a", { class: "btn sm ghost", href: `#/read/${id}/${n - 1}`, title: "Chapitre précédent" }, icon("prev")),
      select,
      n + 1 < ch.count && h("a", { class: "btn sm ghost", href: `#/read/${id}/${n + 1}`, title: "Chapitre suivant" }, icon("next")),
      h("a", { class: "btn sm ghost", href: `#/book/${id}` }, icon("book")),
    ],
  });
}
