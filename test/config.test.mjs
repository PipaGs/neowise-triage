import assert from "node:assert/strict";
import { test } from "node:test";
import { createTriageServer } from "../server.mjs";
import { DEFAULT_TIMEOUT_MS, loadConfig } from "../config.mjs";

const silent = { error() {} };
const ready = JSON.stringify({ topic: "other", draft: "Готово" });

async function start(options) {
  const server = createTriageServer({ logger: silent, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function triage(base, text) {
  const started = Date.now();
  const response = await fetch(`${base}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return { json: await response.json(), elapsed: Date.now() - started };
}

async function withTimeoutEnv(value, run) {
  const previous = process.env.AI_TIMEOUT_MS;
  process.env.AI_TIMEOUT_MS = value;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.AI_TIMEOUT_MS;
    else process.env.AI_TIMEOUT_MS = previous;
  }
}

test("конфиг: 300 мс по умолчанию и значение из AI_TIMEOUT_MS", () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 300);
  assert.equal(loadConfig({}).timeoutMs, 300);
  assert.equal(loadConfig({ AI_TIMEOUT_MS: "50" }).timeoutMs, 50);
  assert.equal(loadConfig({ AI_TIMEOUT_MS: "  " }).timeoutMs, 300);
});

test("конфиг: некорректное значение AI_TIMEOUT_MS отклоняется", () => {
  for (const value of ["abc", "0", "-5", "1.5"]) {
    assert.throws(() => loadConfig({ AI_TIMEOUT_MS: value }), /AI_TIMEOUT_MS/, value);
  }
});

test("AI_TIMEOUT_MS превышен: сервер возвращает manual_review, не дожидаясь модели", async () => {
  await withTimeoutEnv("50", async () => {
    // Ответ через 100 мс: при игнорировании AI_TIMEOUT_MS сработает дефолт 300 мс и придёт ready.
    const server = await start({
      model: () => new Promise((resolve) => setTimeout(() => resolve(ready), 100)),
    });
    try {
      const { json, elapsed } = await triage(server.base, "Заявка");
      assert.deepEqual(json, { status: "manual_review", topic: null, draft: null });
      assert.ok(elapsed < 150, `ответ пришёл за ${elapsed} мс`);
    } finally {
      await server.close();
    }
  });
});

test("AI_TIMEOUT_MS не превышен: ответ модели проходит как ready", async () => {
  await withTimeoutEnv("1000", async () => {
    // 350 мс больше дефолтных 300: при игнорировании AI_TIMEOUT_MS придёт manual_review.
    const server = await start({
      model: () => new Promise((resolve) => setTimeout(() => resolve(ready), 350)),
    });
    try {
      const { json } = await triage(server.base, "Заявка");
      assert.deepEqual(json, { status: "ready", topic: "other", draft: "Готово" });
    } finally {
      await server.close();
    }
  });
});
