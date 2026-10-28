// Serveur MCP (Streamable HTTP, sans session) : Claude envoie un texte, le lecteur l'affiche.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const text = (t) => ({ content: [{ type: "text", text: t }] });

export function buildMcp(store, baseUrl) {
  const server = new McpServer({ name: "rsvp-reader", version: "1.0.0" });
  const link = (id) => `${baseUrl}/#/reader/${id}`;

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
    async ({ text: body, title, wpm }) => {
      const item = store.add({ title, text: body, source: "mcp" });
      if (wpm) store.updateSettings({ wpm });
      return text(`Texte envoyé au lecteur RSVP : « ${item.title} » (${item.words} mots, ~${Math.ceil(item.words / store.settings.wpm)} min). Lien : ${link(item.id)}`);
    },
  );

  server.registerTool(
    "rsvp_list",
    {
      title: "Lister les textes du lecteur",
      description: "Liste les derniers textes enregistrés dans le lecteur RSVP.",
      inputSchema: { limit: z.number().int().min(1).max(50).optional() },
    },
    async ({ limit = 10 }) => {
      const rows = store.list().slice(0, limit);
      if (!rows.length) return text("Aucun texte enregistré.");
      return text(rows.map((r) => `- ${r.id} · ${r.title} · ${r.words} mots · ${r.createdAt}`).join("\n"));
    },
  );

  server.registerTool(
    "rsvp_get",
    {
      title: "Lire un texte enregistré",
      description: "Renvoie le contenu d'un texte (le plus récent si aucun id n'est donné).",
      inputSchema: { id: z.string().optional() },
    },
    async ({ id }) => {
      const item = id ? store.get(id) : store.latest();
      return item ? text(`# ${item.title}\n\n${item.text}`) : text("Texte introuvable.");
    },
  );

  server.registerTool(
    "rsvp_set_speed",
    {
      title: "Régler la vitesse de lecture",
      description: "Change la vitesse par défaut du lecteur, en mots par minute (bornée par la configuration).",
      inputSchema: { wpm: z.number().int().min(50).max(2000) },
    },
    async ({ wpm }) => {
      const s = store.updateSettings({ wpm });
      return text(`Vitesse réglée à ${s.wpm} mots/min (plage ${s.minWpm}–${s.maxWpm}).`);
    },
  );

  server.registerTool(
    "rsvp_delete",
    {
      title: "Supprimer un texte",
      description: "Supprime un texte du lecteur à partir de son id.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => text(store.remove(id) ? "Texte supprimé." : "Texte introuvable."),
  );

  return server;
}

export async function handleMcp(req, res, store, baseUrl, body) {
  const server = buildMcp(store, baseUrl);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
