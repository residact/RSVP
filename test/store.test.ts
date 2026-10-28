import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HttpError, Store } from "../src/server/store.ts";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "rsvp-store-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test("le jeton fixe est utilisé et comparé en temps constant", () => {
  const s = new Store(dir, "secret");
  expect(s.token).toBe("secret");
  expect(s.checkToken("secret")).toBe(true);
  expect(s.checkToken("secreT")).toBe(false);
  expect(s.checkToken(undefined)).toBe(false);
});

test("sans jeton fixe, un jeton est généré puis conservé", () => {
  const first = new Store(dir).token;
  expect(first.length).toBeGreaterThan(20);
  expect(new Store(dir).token).toBe(first);
});

test("les réglages sont bornés et validés", () => {
  const s = new Store(dir, "t");
  expect(s.updateSettings({ wpm: 9999 }).wpm).toBe(700);
  expect(s.updateSettings({ minWpm: 400, maxWpm: 300 }).maxWpm).toBe(450);
  expect(s.updateSettings({ accent: "pas-une-couleur" }).accent).toBe("#f68330");
  expect(s.updateSettings({ accent: "#112233", showPivot: false }).showPivot).toBe(false);
});

test("ajout, lecture, suppression et texte vide refusé", () => {
  const s = new Store(dir, "t");
  const item = s.add({ text: "  Bonjour le monde  ", source: "test" });
  expect(item.words).toBe(3);
  expect(item.title).toBe("Bonjour le monde");
  expect(s.latest()?.id).toBe(item.id);
  expect(s.list()[0]?.preview).toBe("Bonjour le monde");
  expect(s.remove(item.id)).toBe(true);
  expect(s.remove(item.id)).toBe(false);
  expect(() => s.add({ text: "   " })).toThrow(HttpError);
});

test("les données survivent à un redémarrage", () => {
  new Store(dir, "t").add({ text: "persistant" });
  expect(new Store(dir, "t").list()).toHaveLength(1);
});
