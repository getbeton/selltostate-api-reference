import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url);
const allowed = new Set(["openapi.json", "api-guide.md", "llms.txt", "llms-full.txt", "README.md", "LICENSE", "SECURITY.md", "header.png", "test"]);

test("file set is public only", () => {
  for (const name of readdirSync(root)) {
    assert.equal(allowed.has(name), true, name);
  }
});

test("overview is not Singapore-only and does not freeze a count", () => {
  const spec = JSON.parse(readFileSync(new URL("../openapi.json", import.meta.url), "utf8"));
  const guide = readFileSync(new URL("../api-guide.md", import.meta.url), "utf8");
  assert.equal(spec.info.description.includes("17,800"), false);
  assert.equal(spec.info.description.includes("Singapore"), false);
  assert.equal(spec.info.description.includes("1,488,914"), false);
  assert.match(spec.info.description, /selltostate\.com/);
  assert.equal(guide.includes("17,800"), false);
  assert.equal(guide.includes("https://api.selltostate.com"), false);
  assert.equal(/curl[^\n]*api\.selltostate\.com/.test(guide), false);
});

test("readme links are tagged", () => {
  const md = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(md, /utm_source=github/);
  assert.match(md, /utm_content=selltostate-api-reference/);
  assert.equal(md.includes("linkedin.com"), false);
});
