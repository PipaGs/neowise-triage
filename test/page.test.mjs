import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import { renderTriage } from "../ui.mjs";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const source = html
  .match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/^\s*import .*$/m, "");

function createPage(fetchImpl) {
  const handlers = {};
  const elements = {
    form: {
      addEventListener(type, handler) {
        handlers[type] = handler;
      },
      querySelector() {
        return elements.button;
      },
    },
    button: { disabled: false },
    "#message": { value: "" },
    "#note": { textContent: "", hidden: true },
    "#topic": { textContent: "", hidden: true },
    "#draft": { textContent: "", hidden: true },
  };
  const document = {
    querySelector(selector) {
      return selector === "form" ? elements.form : elements[selector];
    },
  };
  vm.runInNewContext(source, { document, fetch: fetchImpl, renderTriage });
  return {
    elements,
    submit(event = { preventDefault() {} }) {
      return handlers.submit(event);
    },
  };
}

test("inline submit: показывает ready и шлёт текст заявки", async () => {
  const calls = [];
  const page = createPage(async (url, options) => {
    calls.push({ url, options });
    return { json: async () => ({ status: "ready", topic: "pricing", draft: "Цена — 100 ₽" }) };
  });

  page.elements["#message"].value = "Сколько стоит?";
  let prevented = false;
  const pending = page.submit({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(page.elements.button.disabled, true);
  await pending;

  assert.equal(prevented, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/triage");
  assert.deepEqual(JSON.parse(calls[0].options.body), { text: "Сколько стоит?" });
  assert.equal(page.elements.button.disabled, false);
  assert.equal(page.elements["#topic"].textContent, "Тема: Цены");
  assert.equal(page.elements["#draft"].textContent, "Цена — 100 ₽");
  assert.equal(page.elements["#note"].hidden, true);
});

test("inline submit: manual_review очищает черновик, ошибка сети показывает сообщение", async () => {
  let payload = { status: "ready", topic: "other", draft: "Старый черновик" };
  const page = createPage(async () => ({ json: async () => payload }));

  page.elements["#message"].value = "Заявка";
  await page.submit();
  assert.equal(page.elements["#draft"].textContent, "Старый черновик");

  payload = { status: "manual_review", topic: null, draft: null };
  await page.submit();
  assert.equal(page.elements["#draft"].textContent, "");
  assert.equal(page.elements["#draft"].hidden, true);
  assert.equal(page.elements["#note"].hidden, false);
  assert.match(page.elements["#note"].textContent, /вручную/);
  assert.equal(page.elements.button.disabled, false);

  const offline = createPage(async () => {
    throw new Error("network down");
  });
  offline.elements["#message"].value = "Заявка";
  await offline.submit();
  assert.equal(offline.elements["#draft"].textContent, "");
  assert.equal(offline.elements["#note"].hidden, false);
  assert.match(offline.elements["#note"].textContent, /недоступен/);
  assert.equal(offline.elements.button.disabled, false);
});
