#!/usr/bin/env bun
// Installe le skill rsvp-reader en global pour : Claude Code et Claude dans VS Code (~/.claude/skills),
// pi.dev (~/.pi/agent/skills) et GitHub Copilot dans VS Code (~/.copilot/skills).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

export const SKILL = "rsvp-reader";
export const MARKER = ".installed-by-rsvp-reader";
const SOURCE = path.join(import.meta.dir, SKILL);
const REPO = path.resolve(import.meta.dir, "..");

export const TARGETS = {
  claude: { label: "Claude Code et Claude dans VS Code", dir: () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "skills") },
  pi: { label: "pi.dev", dir: () => path.join(os.homedir(), ".pi", "agent", "skills") },
  copilot: { label: "GitHub Copilot dans VS Code", dir: () => path.join(os.homedir(), ".copilot", "skills") },
} as const;

export type TargetName = keyof typeof TARGETS;

export interface Options {
  targets: TargetName[];
  dirs: Partial<Record<TargetName, string>>;
  link: boolean;
  force: boolean;
  dryRun: boolean;
  uninstall: boolean;
  config: boolean;
  purge: boolean;
  url?: string;
  token?: string;
  envFile: string;
  configFile: string;
}

export interface Result {
  target: TargetName;
  status: "installed" | "updated" | "removed" | "absent" | "skipped" | "error";
  path: string;
  detail?: string;
}

const log = (s: string) => console.log(s);

export function defaultConfigFile(): string {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "rsvp-reader", "config.json");
}

/** Lit un fichier .env simple (CLE=valeur, commentaires # ignorés). */
export function readEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m?.[1]) out[m[1]] = (m[2] ?? "").replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

const exists = (p: string) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

/** Un dossier est à nous s'il porte notre marqueur, ou si c'est un lien vers ce dépôt. */
function isOurs(p: string): boolean {
  try {
    if (fs.lstatSync(p).isSymbolicLink()) return fs.realpathSync(p) === fs.realpathSync(SOURCE);
    return fs.existsSync(path.join(p, MARKER));
  } catch {
    return false;
  }
}

function removePath(p: string): void {
  fs.rmSync(p, { recursive: true, force: true });
}

export function installTarget(name: TargetName, o: Options): Result {
  const root = o.dirs[name] ?? TARGETS[name].dir();
  const dest = path.join(root, SKILL);
  const present = exists(dest);
  try {
    if (o.uninstall) {
      if (!present) return { target: name, status: "absent", path: dest };
      if (!isOurs(dest) && !o.force) return { target: name, status: "skipped", path: dest, detail: "ce dossier n'a pas été installé par ce script (utilise --force)" };
      if (!o.dryRun) removePath(dest);
      return { target: name, status: "removed", path: dest };
    }
    if (present && !isOurs(dest) && !o.force) return { target: name, status: "skipped", path: dest, detail: "un skill du même nom existe déjà (utilise --force pour le remplacer)" };
    if (!o.dryRun) {
      fs.mkdirSync(root, { recursive: true });
      if (present) removePath(dest);
      if (o.link) fs.symlinkSync(SOURCE, dest, "dir");
      else {
        fs.cpSync(SOURCE, dest, { recursive: true });
        fs.writeFileSync(path.join(dest, MARKER), `${new Date().toISOString()}\n`);
      }
    }
    return { target: name, status: present ? "updated" : "installed", path: dest, detail: o.link ? "lien symbolique" : "copie" };
  } catch (e) {
    return { target: name, status: "error", path: dest, detail: (e as Error).message };
  }
}

/** Écrit l'adresse et le jeton que le script d'envoi du skill utilise. */
export function writeConfig(o: Options): string {
  const env = readEnv(o.envFile);
  const url = (o.url ?? (env.RSVP_PUBLIC_URL || `http://localhost:${env.PORT || 8787}`)).replace(/\/$/, "");
  const token = o.token ?? env.RSVP_TOKEN;
  if (!token) throw new Error(`Jeton introuvable : renseigne RSVP_TOKEN dans ${o.envFile} ou passe --token.`);
  if (!o.dryRun) {
    fs.mkdirSync(path.dirname(o.configFile), { recursive: true });
    fs.writeFileSync(o.configFile, `${JSON.stringify({ url, token }, null, 2)}\n`, { mode: 0o600 });
  }
  return url;
}

export function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      target: { type: "string", short: "t", default: "all" },
      link: { type: "boolean" },
      force: { type: "boolean", short: "f" },
      "dry-run": { type: "boolean" },
      uninstall: { type: "boolean" },
      "no-config": { type: "boolean" },
      purge: { type: "boolean" },
      url: { type: "string" },
      token: { type: "string" },
      env: { type: "string", default: path.join(REPO, ".env") },
      "config-file": { type: "string", default: defaultConfigFile() },
      "claude-dir": { type: "string" },
      "pi-dir": { type: "string" },
      "copilot-dir": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });
  if (values.help) {
    log(HELP);
    process.exit(0);
  }
  const wanted = String(values.target).split(",").map((s) => s.trim()).filter(Boolean);
  const targets = wanted.includes("all") ? (Object.keys(TARGETS) as TargetName[]) : (wanted as TargetName[]);
  for (const t of targets) if (!(t in TARGETS)) throw new Error(`Cible inconnue : « ${t} ». Cibles : ${Object.keys(TARGETS).join(", ")}, all.`);
  return {
    targets,
    dirs: { claude: values["claude-dir"], pi: values["pi-dir"], copilot: values["copilot-dir"] },
    link: !!values.link,
    force: !!values.force,
    dryRun: !!values["dry-run"],
    uninstall: !!values.uninstall,
    config: !values["no-config"],
    purge: !!values.purge,
    url: values.url,
    token: values.token,
    envFile: path.resolve(String(values.env)),
    configFile: path.resolve(String(values["config-file"])),
  };
}

const HELP = `Installe le skill ${SKILL} en global.

Usage : bun skills/install.ts [options]

  -t, --target <liste>   claude, pi, copilot (séparés par des virgules) ou all  [défaut : all]
                           claude  → ~/.claude/skills            Claude Code et Claude dans VS Code
                           pi      → ~/.pi/agent/skills          pi.dev
                           copilot → ~/.copilot/skills           GitHub Copilot dans VS Code
      --link             lien symbolique vers ce dépôt (mises à jour automatiques) au lieu d'une copie
  -f, --force            remplace un skill du même nom qui n'a pas été installé par ce script
      --dry-run          affiche ce qui serait fait, sans rien écrire
      --uninstall        supprime le skill installé (--purge supprime aussi la configuration)
      --no-config        n'écrit pas ~/.config/rsvp-reader/config.json
      --url <url>        adresse du serveur (défaut : RSVP_PUBLIC_URL du .env, sinon http://localhost:PORT)
      --token <jeton>    jeton (défaut : RSVP_TOKEN du .env)
      --env <fichier>    fichier .env à lire  [défaut : .env du dépôt]
      --claude-dir / --pi-dir / --copilot-dir <dossier>   dossier skills personnalisé pour une cible
`;

export function run(o: Options): Result[] {
  const results = o.targets.map((t) => installTarget(t, o));
  if (o.uninstall) {
    if (o.purge && !o.dryRun) fs.rmSync(path.dirname(o.configFile), { recursive: true, force: true });
  } else if (o.config && results.some((r) => r.status === "installed" || r.status === "updated")) {
    const url = writeConfig(o);
    log(`${o.dryRun ? "[simulation] " : ""}Configuration : ${o.configFile} (${url})`);
  }
  return results;
}

if (import.meta.main) {
  try {
    const o = parseOptions(process.argv.slice(2));
    const results = run(o);
    const icon = { installed: "✓", updated: "↻", removed: "✗", absent: "·", skipped: "!", error: "✗" } as const;
    for (const r of results) log(`${icon[r.status]} ${TARGETS[r.target].label.padEnd(36)} ${r.status}${r.detail ? ` (${r.detail})` : ""}\n    ${r.path}`);
    if (!o.dryRun && !o.uninstall) log("\nRedémarre ou recharge l'agent pour qu'il découvre le skill (pi : /reload).");
    process.exit(results.some((r) => r.status === "error") ? 1 : 0);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
