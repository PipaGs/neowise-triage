import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createTriageServer } from "../server.mjs";

let server;
let base;

before(async () => {
  server = createTriageServer({ timeoutMs: 300, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function triage(body, url = base) {
  const started = Date.now();
  const response = await fetch(`${url}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json(), elapsed: Date.now() - started };
}

test("корректный текст: тема и непустой черновик", async () => {
  const { status, json } = await triage({ text: "Доставка завтра возможна?" });
  assert.equal(status, 200);
  assert.equal(json.status, "ready");
  assert.equal(json.topic, "delivery");
  assert.ok(json.draft.trim().length > 0);
});

test("пустой, нестроковый и битый ввод: 400 invalid_input", async () => {
  for (const body of [{ text: "" }, { text: "   " }, {}, { text: 42 }, "не json", "null", "[]"]) {
    const { status, json } = await triage(body);
    assert.equal(status, 400, `тело: ${JSON.stringify(body)}`);
    assert.deepEqual(json, { status: "invalid_input" });
  }
});

test("таймаут модели: 200 manual_review, ответ не ждёт 1200 мс имитатора", async () => {
  const { status, json, elapsed } = await triage({ text: "Заказ [timeout]" });
  assert.equal(status, 200);
  assert.deepEqual(json, { status: "manual_review", topic: null, draft: null });
  assert.ok(elapsed < 1000, `ответ пришёл за ${elapsed} мс`);
});

test("ошибка и некорректный ответ модели: 200 manual_review", async () => {
  for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    const { status, json } = await triage({ text: `Заявка ${marker}` });
    assert.equal(status, 200, marker);
    assert.deepEqual(json, { status: "manual_review", topic: null, draft: null }, marker);
  }
});

test("провайдер игнорирует отмену: ответ всё равно приходит по таймауту", async () => {
  const hanging = createTriageServer({
    model: () => new Promise(() => {}),
    timeoutMs: 50,
    logger: { error() {} },
  });
  await new Promise((resolve) => hanging.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${hanging.address().port}`;
    const { status, json, elapsed } = await triage({ text: "Заказ" }, url);
    assert.equal(status, 200);
    assert.deepEqual(json, { status: "manual_review", topic: null, draft: null });
    assert.ok(elapsed < 1000, `ответ пришёл за ${elapsed} мс`);
  } finally {
    await new Promise((resolve) => hanging.close(resolve));
  }
});
