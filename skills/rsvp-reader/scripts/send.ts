#!/usr/bin/env bun
// Envoie un texte au lecteur RSVP. Texte lu dans --file ou sur l'entrée standard.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

interface Config {
  url: string;
  token: string;
}

export function configPath(): string {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "rsvp-reader", "config.json");
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  let file: Partial<Config> = {};
  try {
    file = JSON.parse(fs.readFileSync(configPath(), "utf8")) as Partial<Config>;
  } catch {
    /* pas de fichier de configuration */
  }
  const url = (env.RSVP_URL || file.url || "").replace(/\/$/, "");
  const token = env.RSVP_TOKEN || file.token || "";
  if (!url || !token) throw new Error(`Configuration introuvable : définis RSVP_URL et RSVP_TOKEN, ou crée ${configPath()} (bun skills/install.ts).`);
  return { url, token };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { title: { type: "string" }, file: { type: "string" }, wpm: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help) {
    console.log("Usage : bun send.ts [--title T] [--file F] [--wpm N] [--json]  (texte sur l'entrée standard sinon)");
    return;
  }
  const text = (values.file ? fs.readFileSync(values.file, "utf8") : await Bun.stdin.text()).trim();
  if (!text) throw new Error("Aucun texte à envoyer (entrée vide).");

  const { url, token } = loadConfig();
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const res = await fetch(`${url}/api/texts`, { method: "POST", headers, body: JSON.stringify({ title: values.title, text, source: "skill" }) });
  const data = (await res.json().catch(() => ({}))) as { error?: string; title?: string; words?: number; url?: string };
  if (!res.ok) throw new Error(res.status === 401 ? "Jeton refusé (401) : il ne correspond plus à RSVP_TOKEN du serveur." : `Erreur ${res.status} : ${data.error ?? "réponse inattendue"}`);

  if (values.wpm) await fetch(`${url}/api/settings`, { method: "PUT", headers, body: JSON.stringify({ wpm: Number(values.wpm) }) });
  console.log(values.json ? JSON.stringify(data) : `Envoyé au lecteur RSVP : « ${data.title} » (${data.words} mots)\n${data.url}`);
}

if (import.meta.main) {
  main().catch((e: Error) => {
    console.error(e.cause ? `${e.message} (${String(e.cause)})` : e.message);
    process.exit(1);
  });
}
