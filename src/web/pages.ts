// Pages « Coller » et « Configuration ».
import type { Info, Settings, TextMeta } from "../shared/types.ts";
import { ago, api, applyAccent, copy, h, icon, minutes, paintRange, setToken, state, toast, type Cleanup, type Ctx } from "./lib.ts";

export async function pastePage(root: HTMLElement, { go }: Ctx): Promise<Cleanup> {
  const wpm = state.settings.wpm;
  const area = h("textarea", { class: "field", placeholder: "Colle ici le texte à lire (le markdown est accepté)…", "aria-label": "Texte" });
  const title = h("input", { class: "field", placeholder: "Titre (facultatif)", maxLength: 80 });
  const meta = h("span", { class: "muted" });
  const listEl = h("div", { class: "list" });

  const update = (): void => {
    const n = area.value.split(/\s+/).filter(Boolean).length;
    meta.textContent = n ? `${n} mots · ${minutes(n, wpm)} à ${wpm} mots/min` : "";
    readBtn.disabled = saveBtn.disabled = !n;
  };
  async function submit(read: boolean): Promise<void> {
    try {
      const item = await api<{ id: string }>("/texts", { method: "POST", body: { title: title.value, text: area.value, source: "web" } });
      area.value = title.value = "";
      if (read) return go(`/reader/${item.id}`);
      toast("Texte enregistré");
      update();
      await loadList();
    } catch (e) { toast((e as Error).message); }
  }
  const readBtn = h("button", { class: "btn primary", onclick: () => void submit(true) }, icon("play"), "Lire maintenant");
  const saveBtn = h("button", { class: "btn", onclick: () => void submit(false) }, "Enregistrer");
  const pasteBtn = h("button", {
    class: "btn", onclick: async () => {
      try { area.value = await navigator.clipboard.readText(); update(); area.focus(); }
      catch { toast("Autorise l’accès au presse-papiers, ou colle avec Ctrl+V"); }
    },
  }, icon("paste"), "Coller depuis le presse-papiers");
  area.addEventListener("input", update);

  async function loadList(): Promise<void> {
    const texts = await api<TextMeta[]>("/texts");
    listEl.replaceChildren(
      ...(texts.length ? texts.slice(0, 30).map((t) =>
        h("div", { class: "item" },
          h("b", {}, t.title),
          h("p", {}, `${t.words} mots · ${ago(t.createdAt)} · ${t.source}`),
          h("div", { class: "acts" },
            h("a", { class: "btn sm primary", href: `#/reader/${t.id}` }, icon("play"), "Lire"),
            h("button", { class: "btn sm icon danger", "aria-label": "Supprimer", onclick: async () => { await api(`/texts/${t.id}`, { method: "DELETE" }); await loadList(); } }, icon("trash")))))
        : [h("div", { class: "empty" }, "Aucun texte enregistré pour l’instant.")]));
  }

  root.append(h("div", { class: "page" },
    h("h1", {}, "Coller un texte"),
    h("p", { class: "sub" }, "Colle n’importe quel texte, puis lance la lecture. Les textes envoyés par Claude (MCP) arrivent aussi ici."),
    h("div", { class: "card stack" }, title, area,
      h("div", { class: "row between" }, meta, h("div", { class: "row" }, pasteBtn, saveBtn, readBtn))),
    h("div", { class: "card" }, h("h2", {}, "Bibliothèque"), h("p", { class: "hint" }, "Les 30 textes les plus récents."), listEl)));
  update();
  await loadList();
  area.focus();
  return () => {};
}

type BoolKey = "showPivot" | "punctuationPause" | "longWordPause" | "autoOpen" | "keepAwake";

export async function settingsPage(root: HTMLElement, { logout, refresh }: Ctx): Promise<Cleanup> {
  const s = state.settings;
  const info = await api<Info>("/info");
  state.info = info;
  const save = async (patch: Partial<Settings>): Promise<void> => {
    try { state.settings = await api<Settings>("/settings", { method: "PUT", body: patch }); applyAccent(state.settings.accent); toast("Enregistré"); }
    catch (e) { toast((e as Error).message); }
  };
  const sw = (label: string, sub: string, key: BoolKey) => {
    const input = h("input", { type: "checkbox", checked: s[key], onchange: () => void save({ [key]: input.checked }) });
    return h("label", { class: "switch" }, h("span", {}, label, h("small", {}, sub)), input);
  };
  const num = (label: string, key: "minWpm" | "maxWpm", min: number, max: number) => {
    const i = h("input", { class: "field", type: "number", min, max, step: 25, value: s[key], onchange: () => void save({ [key]: Number(i.value) }).then(refresh) });
    return h("div", {}, h("span", { class: "label" }, label), i);
  };
  const copyRow = (value: string, type = "text") => h("div", { class: "copyrow" },
    h("input", { class: "field", readOnly: true, value, type }),
    h("button", { class: "btn icon", "aria-label": "Copier", onclick: () => void copy(value) }, icon("copy")));

  const curl = `curl -X POST ${info.baseUrl}/api/texts \\\n  -H "Authorization: Bearer ${info.token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"Test","text":"Bonjour le monde"}'`;
  const accent = h("input", { type: "color", value: s.accent, style: "width:44px;height:36px;border:0;background:none;padding:0", onchange: () => void save({ accent: accent.value }) });
  const fontRange = h("input", { type: "range", class: "range", min: 0.6, max: 1.6, step: 0.1, value: s.fontScale, onchange: () => void save({ fontScale: Number(fontRange.value) }) });
  paintRange(fontRange);
  fontRange.addEventListener("input", () => paintRange(fontRange));

  root.append(h("div", { class: "page" },
    h("h1", {}, "Configuration"),
    h("p", { class: "sub" }, "Lecture, connexion à Claude et accès à l’API."),

    h("div", { class: "card stack" },
      h("div", {}, h("h2", {}, "Lecture"), h("p", { class: "hint" }, "Ces réglages s’appliquent sur tous tes appareils.")),
      h("div", { class: "row" }, h("div", { style: "flex:1;min-width:140px" }, num("Vitesse minimale (mots/min)", "minWpm", 50, 1000)), h("div", { style: "flex:1;min-width:140px" }, num("Vitesse maximale (mots/min)", "maxWpm", 100, 2000))),
      sw("Lettre pivot en couleur", "Aligne l’œil sur la lettre centrale de chaque mot", "showPivot"),
      sw("Pauses sur la ponctuation", "Ralentit après les virgules et les points", "punctuationPause"),
      sw("Pauses sur les mots longs", "Laisse plus de temps aux mots de plus de 8 lettres", "longWordPause"),
      sw("Ouvrir le lecteur à l’arrivée d’un texte", "Quand Claude envoie un texte, le lecteur s’ouvre tout seul", "autoOpen"),
      sw("Garder l’écran allumé pendant la lecture", "Utile sur téléphone", "keepAwake"),
      h("div", { class: "row" },
        h("div", { style: "flex:1;min-width:180px" }, h("span", { class: "label" }, "Taille du mot"), fontRange),
        h("div", {}, h("span", { class: "label" }, "Couleur d’accent"), accent))),

    h("div", { class: "card stack" },
      h("div", {}, h("h2", {}, "Connecteur Claude (MCP)"), h("p", { class: "hint" }, "Ajoute ce serveur comme connecteur personnalisé dans Claude. Ensuite, dis « lis ça en RSVP » : Claude envoie le texte et le lecteur s’ouvre.")),
      h("div", {}, h("span", { class: "label" }, "URL du serveur MCP"), copyRow(info.mcpUrl)),
      h("div", {}, h("span", { class: "label" }, "Jeton d’accès (en-tête Authorization: Bearer)"), copyRow(info.token, "password")),
      h("p", { class: "hint", style: "margin:0" }, "Les téléphones et claude.ai ont besoin d’une adresse https joignable depuis Internet : expose ce port avec un tunnel (Tailscale Funnel, Cloudflare Tunnel…) puis renseigne RSVP_PUBLIC_URL dans .env. Outils exposés : ",
        h("code", {}, "rsvp_send, rsvp_list, rsvp_get, rsvp_set_speed, rsvp_delete, rsvp_books"), ".")),

    h("div", { class: "card stack" },
      h("div", {}, h("h2", {}, "API REST"), h("p", { class: "hint" }, "Pour tes scripts et automatisations. Authentification : Authorization: Bearer <jeton>.")),
      h("pre", { class: "code" }, `GET    /api/texts            liste\nPOST   /api/texts            {title?, text}\nGET    /api/texts/latest     dernier texte\nGET    /api/texts/:id        un texte\nDELETE /api/texts/:id        supprime\nGET    /api/books            bibliothèque\nPOST   /api/books?name=x.pdf fichier brut\nGET    /api/settings         réglages\nPUT    /api/settings         {wpm, minWpm, …}\nGET    /api/events           flux SSE (nouveaux textes)\nPOST   /mcp                  serveur MCP`),
      h("pre", { class: "code" }, curl),
      h("button", { class: "btn sm", style: "justify-self:start", onclick: () => void copy(curl) }, icon("copy"), "Copier l’exemple")),

    h("div", { class: "card" },
      h("h2", {}, "Sécurité"),
      h("p", { class: "hint" }, "Régénérer le jeton déconnecte tous les appareils et les connecteurs existants. Si RSVP_TOKEN est défini dans .env, il reprend le dessus au prochain démarrage."),
      h("div", { class: "row" },
        h("button", { class: "btn danger", onclick: async () => {
          if (!confirm("Régénérer le jeton ? Les appareils et connecteurs actuels perdront l’accès.")) return;
          const { token } = await api<{ token: string }>("/token/regenerate", { method: "POST" });
          setToken(token); toast("Nouveau jeton actif"); location.reload();
        } }, icon("refresh"), "Régénérer le jeton"),
        h("button", { class: "btn ghost", onclick: logout }, "Se déconnecter de cet appareil")))));
  return () => {};
}

