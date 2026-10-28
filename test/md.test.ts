import { expect, test } from "bun:test";
import { toHtml } from "../src/web/md.ts";

test("titres, gras, italique collé à une apostrophe, liens", () => {
  const html = toHtml("# Titre\n\nl'*italique* et **gras** et [lien](https://exemple.com)");
  expect(html).toContain("<h1>Titre</h1>");
  expect(html).toContain("l'<em>italique</em>");
  expect(html).toContain("<strong>gras</strong>");
  expect(html).toContain('href="https://exemple.com"');
});

test("le HTML est échappé et les liens dangereux ne deviennent pas cliquables", () => {
  const html = toHtml('<script>alert(1)</script> [x](javascript:alert(1))');
  expect(html).not.toContain("<script>");
  expect(html).not.toContain('href="javascript');
});

test("listes imbriquées, tableaux et blocs de code", () => {
  expect(toHtml("- a\n  - b\n- c")).toContain("<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>");
  expect(toHtml("| A | B |\n|---|---|\n| 1 | 2 |")).toContain("<th>A</th>");
  expect(toHtml("```js\nconst x = 1;\n```")).toContain('<pre class="codeblock">');
});

test("les mots de snake_case et 2*3*4 ne sont pas mis en italique", () => {
  const html = toHtml("snake_case_var et 2*3*4");
  expect(html).not.toContain("<em>");
});
