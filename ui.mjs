const TOPICS = { delivery: "Доставка", pricing: "Цены", other: "Другое" };
const NOTES = {
  manual_review: "Автоматический разбор не сработал. Разберите заявку вручную: черновик очищен.",
  invalid_input: "Введите текст заявки.",
  failed: "Сервис разбора недоступен. Попробуйте ещё раз.",
};

export function renderTriage(state, { note, topic, draft }) {
  const ready = state.status === "ready" && typeof state.draft === "string" && state.draft.trim() !== "";
  topic.hidden = !ready;
  draft.hidden = !ready;
  note.hidden = ready;
  if (ready) {
    topic.textContent = `Тема: ${TOPICS[state.topic] ?? state.topic}`;
    draft.textContent = state.draft;
    note.textContent = "";
    return;
  }
  topic.textContent = "";
  draft.textContent = "";
  note.textContent = NOTES[state.status] ?? NOTES.failed;
}
