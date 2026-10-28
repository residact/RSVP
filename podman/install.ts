#!/usr/bin/env bun
// Installe les unités Quadlet de RSVP pour systemd (utilisateur) : image, volume et conteneur.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { readEnv } from "../skills/install.ts";

const HERE = import.meta.dir;
export const REPO = path.resolve(HERE, "..");
export const UNITS = ["rsvp.build", "rsvp-data.volume", "rsvp.container"] as const;

export function quadletDir(): string {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "containers", "systemd");
}

/** Remplit les modèles d'unités : chemin du dépôt et port publié (PORT du .env). */
export function render(template: string, repo: string, port: string): string {
  return template.replaceAll("__REPO__", repo).replaceAll("__PORT__", port);
}

export function install(opts: { dir: string; repo: string; dryRun: boolean; envFile: string }): string[] {
  if (!fs.existsSync(opts.envFile)) throw new Error(`Fichier .env introuvable (${opts.envFile}) : copie .env.example en .env et renseigne RSVP_TOKEN.`);
  const env = readEnv(opts.envFile);
  if (!env.RSVP_TOKEN) console.warn("Attention : RSVP_TOKEN est vide dans .env ; un jeton sera généré et affiché dans les logs.");
  const port = env.PORT || "8787";
  const written: string[] = [];
  for (const unit of UNITS) {
    const out = path.join(opts.dir, unit);
    written.push(out);
    if (opts.dryRun) continue;
    fs.mkdirSync(opts.dir, { recursive: true });
    fs.writeFileSync(out, render(fs.readFileSync(path.join(HERE, unit), "utf8"), opts.repo, port));
  }
  return written;
}

export function uninstall(dir: string, dryRun: boolean): string[] {
  const removed = UNITS.map((u) => path.join(dir, u)).filter((f) => fs.existsSync(f));
  if (!dryRun) for (const f of removed) fs.rmSync(f);
  return removed;
}

function systemctl(...args: string[]): void {
  const r = spawnSync("systemctl", ["--user", ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`systemctl --user ${args.join(" ")} a échoué (code ${r.status}).`);
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: {
        dir: { type: "string", default: quadletDir() },
        env: { type: "string", default: path.join(REPO, ".env") },
        "dry-run": { type: "boolean" },
        uninstall: { type: "boolean" },
        "no-start": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      console.log(`Installe RSVP comme service systemd utilisateur via Quadlet (Podman).

Usage : bun podman/install.ts [options]
      --dry-run     affiche les fichiers sans rien écrire
      --no-start    écrit les unités sans démarrer le service
      --uninstall   arrête le service et supprime les unités (le volume rsvp-data est conservé)
      --dir <d>     dossier Quadlet  [défaut : ~/.config/containers/systemd]
      --env <f>     fichier .env  [défaut : .env du dépôt]`);
      process.exit(0);
    }
    const dir = path.resolve(String(values.dir));
    const dryRun = !!values["dry-run"];
    if (values.uninstall) {
      if (!dryRun) spawnSync("systemctl", ["--user", "stop", "rsvp.service"], { stdio: "inherit" });
      const gone = uninstall(dir, dryRun);
      console.log(gone.length ? gone.map((f) => `✗ ${f}`).join("\n") : "Aucune unité installée.");
      if (!dryRun) systemctl("daemon-reload");
    } else {
      const files = install({ dir, repo: REPO, dryRun, envFile: path.resolve(String(values.env)) });
      console.log(`${dryRun ? "[simulation] " : ""}${files.map((f) => `✓ ${f}`).join("\n")}`);
      if (!dryRun && !values["no-start"]) {
        systemctl("daemon-reload");
        systemctl("start", "rsvp.service");
        console.log("\nService démarré : systemctl --user status rsvp · journalctl --user -u rsvp -f");
        console.log("Pour qu'il démarre sans session ouverte : loginctl enable-linger $USER");
      }
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
