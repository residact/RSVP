import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MARKER, parseOptions, readEnv, run, SKILL } from "../skills/install.ts";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-skill-")); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const args = (...extra: string[]) => [
  "--claude-dir", path.join(tmp, "claude"), "--pi-dir", path.join(tmp, "pi"), "--copilot-dir", path.join(tmp, "copilot"),
  "--env", path.join(tmp, ".env"), "--config-file", path.join(tmp, "cfg", "config.json"), ...extra,
];
const writeEnv = () => fs.writeFileSync(path.join(tmp, ".env"), "# commentaire\nRSVP_TOKEN=abc123\nPORT=9000\nRSVP_PUBLIC_URL=\n");

test("installe le skill dans les trois dossiers et écrit la configuration", () => {
  writeEnv();
  const res = run(parseOptions(args()));
  expect(res.map((r) => r.status)).toEqual(["installed", "installed", "installed"]);
  for (const d of ["claude", "pi", "copilot"]) {
    const skill = path.join(tmp, d, SKILL);
    expect(fs.readFileSync(path.join(skill, "SKILL.md"), "utf8")).toContain("name: rsvp-reader");
    expect(fs.existsSync(path.join(skill, "scripts", "send.ts"))).toBe(true);
    expect(fs.existsSync(path.join(skill, MARKER))).toBe(true);
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(tmp, "cfg", "config.json"), "utf8"));
  expect(cfg).toEqual({ url: "http://localhost:9000", token: "abc123" });
  expect(fs.statSync(path.join(tmp, "cfg", "config.json")).mode & 0o777).toBe(0o600);
});

test("une seconde installation met à jour, un skill étranger est protégé sauf --force", () => {
  writeEnv();
  run(parseOptions(args("--target", "pi")));
  expect(run(parseOptions(args("--target", "pi")))[0]?.status).toBe("updated");

  const foreign = path.join(tmp, "claude", SKILL);
  fs.mkdirSync(foreign, { recursive: true });
  fs.writeFileSync(path.join(foreign, "SKILL.md"), "autre skill");
  expect(run(parseOptions(args("--target", "claude")))[0]?.status).toBe("skipped");
  expect(fs.readFileSync(path.join(foreign, "SKILL.md"), "utf8")).toBe("autre skill");
  expect(run(parseOptions(args("--target", "claude", "--force")))[0]?.status).toBe("updated");
});

test("--dry-run n'écrit rien, --link crée un lien symbolique", () => {
  writeEnv();
  run(parseOptions(args("--dry-run")));
  expect(fs.existsSync(path.join(tmp, "claude"))).toBe(false);
  expect(fs.existsSync(path.join(tmp, "cfg"))).toBe(false);

  run(parseOptions(args("--target", "copilot", "--link")));
  expect(fs.lstatSync(path.join(tmp, "copilot", SKILL)).isSymbolicLink()).toBe(true);
});

test("désinstallation : retire le skill, respecte les dossiers étrangers", () => {
  writeEnv();
  run(parseOptions(args()));
  const res = run(parseOptions(args("--uninstall", "--purge")));
  expect(res.map((r) => r.status)).toEqual(["removed", "removed", "removed"]);
  expect(fs.existsSync(path.join(tmp, "pi", SKILL))).toBe(false);
  expect(fs.existsSync(path.join(tmp, "cfg"))).toBe(false);
  expect(run(parseOptions(args("--uninstall")))[0]?.status).toBe("absent");
});

test("erreurs : cible inconnue, jeton introuvable", () => {
  expect(() => parseOptions(["--target", "emacs"])).toThrow("Cible inconnue");
  expect(() => run(parseOptions(args("--target", "pi")))).toThrow("Jeton introuvable");
});

test("lecture du .env", () => {
  writeEnv();
  expect(readEnv(path.join(tmp, ".env"))).toEqual({ RSVP_TOKEN: "abc123", PORT: "9000", RSVP_PUBLIC_URL: "" });
});
