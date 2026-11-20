import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createTriageServer } from "../server.mjs";
import { renderTriage } from "../ui.mjs";

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

async function triage(text) {
  const response = await fetch(`${base}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return response.json();
}

function makeView() {
  return {
    note: { textContent: "", hidden: true },
    topic: { textContent: "", hidden: true },
    draft: { textContent: "", hidden: true },
  };
}

function assertManualReview(view) {
  assert.equal(view.topic.textContent, "");
  assert.equal(view.topic.hidden, true);
  assert.equal(view.draft.textContent, "");
  assert.equal(view.draft.hidden, true);
  assert.equal(view.note.hidden, false);
}

test("успех: страница показывает тему и черновик", async () => {
  const view = makeView();
  renderTriage(await triage("Доставка завтра возможна?"), view);
  assert.equal(view.topic.textContent, "Тема: Доставка");
  assert.equal(view.topic.hidden, false);
  assert.equal(view.draft.hidden, false);
  assert.ok(view.draft.textContent.length > 0);
  assert.equal(view.note.hidden, true);
});

test("таймаут имитатора: очищает предыдущий черновик и показывает ручной разбор", async () => {
  const view = makeView();
  renderTriage(await triage("Доставка завтра возможна?"), view);
  assert.ok(view.draft.textContent.length > 0);

  renderTriage(await triage("Доставка [timeout]"), view);

  assertManualReview(view);
  assert.match(view.note.textContent, /вручную/);
});

test("сбой имитатора: предыдущий черновик очищается, показывается ручной разбор", async () => {
  for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    const view = makeView();
    renderTriage({ status: "ready", topic: "other", draft: "Старый черновик" }, view);
    renderTriage(await triage(`Заявка ${marker}`), view);
    assertManualReview(view);
    assert.match(view.note.textContent, /вручную/, marker);
  }
});

test("пустой ввод и недоступный сервер: сообщение и очистка", async () => {
  const empty = makeView();
  renderTriage({ status: "ready", topic: "other", draft: "Старый черновик" }, empty);
  renderTriage(await triage("   "), empty);
  assertManualReview(empty);
  assert.equal(empty.note.textContent, "Введите текст заявки.");

  const offline = makeView();
  renderTriage({ status: "ready", topic: "other", draft: "Старый черновик" }, offline);
  renderTriage({ status: "failed" }, offline);
  assertManualReview(offline);
  assert.match(offline.note.textContent, /недоступен/);
});
