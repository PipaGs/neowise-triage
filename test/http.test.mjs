import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { createTriageServer } from "../server.mjs";

const silent = { error() {} };
let server;
let base;

before(async () => {
  server = createTriageServer({ timeoutMs: 300, logger: silent });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function post(text) {
  const response = await fetch(`${base}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return { status: response.status, json: await response.json() };
}

test("GET / отдаёт страницу", async () => {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(await response.text(), /import \{ renderTriage \} from "\/ui\.mjs";/);
});

test("GET /ui.mjs отдаёт модуль страницы", async () => {
  const response = await fetch(`${base}/ui.mjs`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(await response.text(), await readFile(new URL("../ui.mjs", import.meta.url), "utf8"));
});

test("тело больше 64 КБ отклоняется", async () => {
  const { status, json } = await post("a".repeat(70 * 1024));
  assert.equal(status, 400);
  assert.deepEqual(json, { status: "invalid_input" });
});

test("тело меньше 64 КБ обрабатывается", async () => {
  const { status, json } = await post(`Доставка ${"a".repeat(60 * 1024)}`);
  assert.equal(status, 200);
  assert.equal(json.status, "ready");
});
