import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";
import { classify } from "./mock-ai.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const TOPICS = new Set(["delivery", "pricing", "other"]);
const MANUAL_REVIEW = { status: "manual_review", topic: null, draft: null };
const TIMED_OUT = Symbol("timed out");

const [html, ui] = await Promise.all([
  readFile(new URL("./index.html", import.meta.url)),
  readFile(new URL("./ui.mjs", import.meta.url)),
]);
const assets = new Map([
  ["/", { body: html, type: "text/html; charset=utf-8" }],
  ["/ui.mjs", { body: ui, type: "text/javascript; charset=utf-8" }],
]);

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function readAnswer(raw) {
  if (typeof raw !== "string") return null;
  let answer;
  try {
    answer = JSON.parse(raw);
  } catch {
    return null;
  }
  const { topic, draft } = answer ?? {};
  if (!TOPICS.has(topic) || typeof draft !== "string" || draft.trim() === "") return null;
  return { topic, draft: draft.trim() };
}

async function classifyWithin(text, model, timeoutMs, logger) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      resolve(TIMED_OUT);
      controller.abort();
    }, timeoutMs);
  });

  try {
    const raw = await Promise.race([
      Promise.resolve().then(() => model(text, { signal: controller.signal })),
      timeout,
    ]);
    if (raw === TIMED_OUT) {
      logger.error(`triage: модель не ответила за ${timeoutMs} мс`);
      return null;
    }
    const answer = readAnswer(raw);
    if (answer === null) logger.error("triage: модель вернула неподходящий ответ");
    return answer;
  } catch (error) {
    logger.error("triage: вызов модели завершился ошибкой", error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function createTriageServer({ model = classify, timeoutMs = loadConfig().timeoutMs, logger = console } = {}) {
  return createServer(async (request, response) => {
    try {
      const { pathname } = new URL(request.url, "http://127.0.0.1");

      const asset = request.method === "GET" ? assets.get(pathname) : undefined;
      if (asset) {
        response.writeHead(200, { "Content-Type": asset.type });
        response.end(asset.body);
        return;
      }
      if (request.method !== "POST" || pathname !== "/api/triage") {
        json(response, 404, { status: "not_found" });
        return;
      }

      const chunks = [];
      let size = 0;
      let tooLarge = false;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) tooLarge = true;
        else chunks.push(chunk);
      }

      let text = "";
      if (!tooLarge) {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          text = typeof payload?.text === "string" ? payload.text.trim() : "";
        } catch {
          text = "";
        }
      }
      if (text === "") {
        json(response, 400, { status: "invalid_input" });
        return;
      }

      const answer = await classifyWithin(text, model, timeoutMs, logger);
      json(response, 200, answer === null ? MANUAL_REVIEW : { status: "ready", ...answer });
    } catch (error) {
      logger.error("triage: запрос завершился ошибкой", error);
      if (!response.headersSent) json(response, 500, { status: "server_error" });
      else response.destroy();
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.env.PORT || 3000);
  createTriageServer().listen(port, "127.0.0.1", () => {
    console.log(`Сервер запущен: http://127.0.0.1:${port}`);
  });
}
