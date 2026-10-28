// Serveur MCP (Streamable HTTP, sans session) : Claude envoie un texte, le lecteur l'affiche.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Books } from "./books.ts";
import type { Store } from "./store.ts";

const reply = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export function buildMcp(store: Store, books: Books, baseUrl: string): McpServer {
  const server = new McpServer({ name: "rsvp-reader", version: "2.0.0" });
  const link = (id: string) => `${baseUrl}/#/reader/${id}`;

  server.registerTool(
    "rsvp_send",
    {
      title: "Envoyer un texte au lecteur RSVP",
      description:
        "Envoie un texte (par exemple ta dernière réponse) au lecteur RSVP de l'utilisateur. Le lecteur s'ouvre tout seul sur ses appareils. Le markdown est accepté et mis en forme dans le lecteur. Passe le texte complet, sans le résumer.",
      inputSchema: {
        text: z.string().min(1).describe("Le texte à lire, en entier"),
        title: z.string().optional().describe("Titre court (facultatif)"),
        wpm: z.number().int().min(50).max(2000).optional().describe("Vitesse en mots par minute (facultatif)"),
      },
    },
    async ({ text, title, wpm }) => {
      const item = store.add({ title, text, source: "mcp" });
      if (wpm) store.updateSettings({ wpm });
      return reply(`Texte envoyé au lecteur RSVP : « ${item.title} » (${item.words} mots, ~${Math.ceil(item.words / store.settings.wpm)} min). Lien : ${link(item.id)}`);
    },
  );

  server.registerTool(
    "rsvp_list",
    { title: "Lister les textes du lecteur", description: "Liste les derniers textes enregistrés dans le lecteur RSVP.", inputSchema: { limit: z.number().int().min(1).max(50).optional() } },
    async ({ limit = 10 }) => {
      const rows = store.list().slice(0, limit);
      return reply(rows.length ? rows.map((r) => `- ${r.id} · ${r.title} · ${r.words} mots · ${r.createdAt}`).join("\n") : "Aucun texte enregistré.");
    },
  );

  server.registerTool(
    "rsvp_get",
    { title: "Lire un texte enregistré", description: "Renvoie le contenu d'un texte (le plus récent si aucun id n'est donné).", inputSchema: { id: z.string().optional() } },
    async ({ id }) => {
      const item = id ? store.get(id) : store.latest();
      return reply(item ? `# ${item.title}\n\n${item.text}` : "Texte introuvable.");
    },
  );

  server.registerTool(
    "rsvp_set_speed",
    { title: "Régler la vitesse de lecture", description: "Change la vitesse par défaut du lecteur, en mots par minute (bornée par la configuration).", inputSchema: { wpm: z.number().int().min(50).max(2000) } },
    async ({ wpm }) => {
      const s = store.updateSettings({ wpm });
      return reply(`Vitesse réglée à ${s.wpm} mots/min (plage ${s.minWpm}–${s.maxWpm}).`);
    },
  );

  server.registerTool(
    "rsvp_delete",
    { title: "Supprimer un texte", description: "Supprime un texte du lecteur à partir de son id.", inputSchema: { id: z.string() } },
    async ({ id }) => reply(store.remove(id) ? "Texte supprimé." : "Texte introuvable."),
  );

  server.registerTool(
    "rsvp_books",
    { title: "Lister la bibliothèque de livres", description: "Liste les livres de la bibliothèque avec leur progression de lecture.", inputSchema: {} },
    async () => {
      const rows = books.list();
      return reply(
        rows.length
          ? rows.map((b) => `- ${b.title} (${b.author || "auteur inconnu"}) · ${b.percent} % · ${baseUrl}/#/book/${b.id}`).join("\n")
          : "Bibliothèque vide.",
      );
    },
  );

  return server;
}

export async function handleMcp(req: Request, store: Store, books: Books, baseUrl: string): Promise<Response> {
  const server = buildMcp(store, books, baseUrl);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(req);
  queueMicrotask(() => void transport.close().catch(() => {}));
  return res;
}
