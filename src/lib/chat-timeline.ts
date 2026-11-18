import type { ChatExportLink, ChatProductionLink, ChatTurn } from '../chat-types';

export type ChatTimelineOutput = { kind: 'export'; link: ChatExportLink } | { kind: 'production'; link: ChatProductionLink };
export type ChatTimelineItem = { kind: 'turn'; key: string; turn: ChatTurn; outputs: ChatTimelineOutput[] } | { kind: 'legacy'; key: string; output: ChatTimelineOutput; createdAt: string };
export function chatTimeline(turns: ChatTurn[], exports: ChatExportLink[] = [], productions: ChatProductionLink[] = []): ChatTimelineItem[] {
  const known = new Map(turns.map(turn => [turn.id, { kind: 'turn' as const, key: 'turn:' + turn.id, turn, outputs: [] as ChatTimelineOutput[] }]));
  const items: ChatTimelineItem[] = [...known.values()];
  for (const output of [...exports.map(link => ({ kind: 'export' as const, link })), ...productions.map(link => ({ kind: 'production' as const, link }))]) {
    const origin = output.kind === 'export' ? output.link.turnId : output.link.sourceTurnId, parent = origin && known.get(origin);
    if (parent) parent.outputs.push(output);
    else items.push({ kind: 'legacy', key: output.kind + ':' + output.link.runId, output, createdAt: output.link.createdAt });
  }
  const time = (item: ChatTimelineItem) => Date.parse(item.kind === 'turn' ? item.turn.createdAt : item.createdAt) || 0;
  items.sort((a, b) => time(a) - time(b));
  for (const item of items) if (item.kind === 'turn') item.outputs.sort((a, b) => Date.parse(a.link.createdAt) - Date.parse(b.link.createdAt));
  return items;
}
