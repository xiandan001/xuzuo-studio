export const CHAT_WINDOW_SIZE = 20;
export function chatWindowRange(total: number, start?: number) {
  const from = start === undefined ? Math.max(0, total - CHAT_WINDOW_SIZE) : Math.max(0, Math.min(start, Math.max(0, total - CHAT_WINDOW_SIZE)));
  return { start: from, end: Math.min(total, from + CHAT_WINDOW_SIZE), before: from, after: Math.max(0, total - from - CHAT_WINDOW_SIZE) };
}
export function chatWindowAround(total: number, index: number) {
  return chatWindowRange(total, Math.max(0, index - Math.floor(CHAT_WINDOW_SIZE / 2))).start;
}
