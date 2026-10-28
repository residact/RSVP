import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UNITS, install, render, uninstall } from "../podman/install.ts";

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-podman-")); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("les modèles reçoivent le chemin du dépôt et le port", () => {
  expect(render("File=__REPO__/Dockerfile\nPublishPort=__PORT__:8787", "/srv/rsvp", "9000")).toBe("File=/srv/rsvp/Dockerfile\nPublishPort=9000:8787");
});

test("installation : trois unités écrites, plus de marqueur non remplacé", () => {
  const envFile = path.join(tmp, ".env");
  fs.writeFileSync(envFile, "RSVP_TOKEN=abc\nPORT=9100\n");
  const dir = path.join(tmp, "systemd");
  const files = install({ dir, repo: "/srv/rsvp", dryRun: false, envFile });
  expect(files.map((f) => path.basename(f))).toEqual([...UNITS]);
  const container = fs.readFileSync(path.join(dir, "rsvp.container"), "utf8");
  expect(container).toContain("EnvironmentFile=/srv/rsvp/.env");
  expect(container).toContain("PublishPort=9100:8787");
  for (const u of UNITS) expect(fs.readFileSync(path.join(dir, u), "utf8")).not.toContain("__");
});

test("dry-run n'écrit rien, .env absent est refusé, désinstallation", () => {
  const envFile = path.join(tmp, ".env");
  expect(() => install({ dir: tmp, repo: "/r", dryRun: true, envFile })).toThrow(".env introuvable");
  fs.writeFileSync(envFile, "RSVP_TOKEN=abc\n");
  const dir = path.join(tmp, "systemd");
  install({ dir, repo: "/r", dryRun: true, envFile });
  expect(fs.existsSync(dir)).toBe(false);
  install({ dir, repo: "/r", dryRun: false, envFile });
  expect(uninstall(dir, false)).toHaveLength(3);
  expect(fs.readdirSync(dir)).toHaveLength(0);
});
