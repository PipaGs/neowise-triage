// shortcut: 300 мс рассчитаны на имитатор; для реальной модели нужен отдельный бюджет и повторные попытки.
export const DEFAULT_TIMEOUT_MS = 300;

export function loadConfig(env = process.env) {
  const raw = env.AI_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") return { timeoutMs: DEFAULT_TIMEOUT_MS };
  const timeoutMs = Number(raw);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`AI_TIMEOUT_MS должен быть положительным целым числом, получено "${raw}"`);
  }
  return { timeoutMs };
}
