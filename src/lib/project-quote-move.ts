import type { ProjectLocation } from '../workspace-types';
import { collectQuoteBackups, quoteRestorationWrites } from './quote-backup';
import { projectQuoteKey } from './project-quotes';
import { quoteWorkingKey } from './quote-working-drafts';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface QuoteValues { saved: string | null; working: string | null; }
interface MoveIdentity { projectId: string; sourceWorkspaceId: string; destinationWorkspaceId: string; name?: string; }
export interface ProjectQuoteMove extends MoveIdentity { id: string; source: QuoteValues; destinationBefore: QuoteValues; target: QuoteValues; }
export interface ProjectQuoteMoveSnapshot { moves: ProjectQuoteMove[]; }
export const PROJECT_QUOTE_MOVE_JOURNAL = 'xuzuo-project-quote-move-v1';
const fields = ['saved', 'working'] as const;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);
const validName = (value: unknown) => value === undefined || typeof value === 'string' && !!value.trim() && value.length <= 100;
const pendingError = () => new Error('报价迁移尚未完成，源内容、目标内容和恢复凭据均已保留；重新读取工作区后可继续恢复。');
const conflictError = () => new Error('报价在另一处发生变化，未覆盖任何新的修改；原内容与迁移恢复凭据已保留。');
const keys = (workspaceId: string, projectId: string) => ({ saved: projectQuoteKey(workspaceId, projectId), working: quoteWorkingKey(workspaceId, projectId) });
const values = (storage: Store, workspaceId: string, projectId: string): QuoteValues => { const key = keys(workspaceId, projectId); return { saved: storage.getItem(key.saved), working: storage.getItem(key.working) }; };
const equal = (first: QuoteValues, second: QuoteValues) => fields.every(field => first[field] === second[field]);
function mappedValues(source: QuoteValues, identity: MoveIdentity): QuoteValues {
  const sourceKeys = keys(identity.sourceWorkspaceId, identity.projectId);
  const records = collectQuoteBackups({ getItem: key => key === sourceKeys.saved ? source.saved : key === sourceKeys.working ? source.working : null }, [{ id: identity.projectId, workspaceId: identity.sourceWorkspaceId }]);
  if (!records.length) return { saved: null, working: null };
  const record = records[0], workspaceId = identity.destinationWorkspaceId;
  const mapped = { ...record, workspaceId, ...(record.saved ? { saved: { ...record.saved, workspaceId } } : {}), ...(record.working ? { working: { ...record.working, workspaceId, baseSaved: record.working.baseSaved ? { ...record.working.baseSaved, workspaceId } : null } } : {}) };
  const writes = quoteRestorationWrites([mapped], [{ id: identity.projectId, workspaceId }]), targetKeys = keys(workspaceId, identity.projectId);
  return { saved: writes.find(write => write.key === targetKeys.saved)?.value ?? null, working: writes.find(write => write.key === targetKeys.working)?.value ?? null };
}
function validValues(value: unknown): value is QuoteValues {
  return !!value && typeof value === 'object' && fields.every(field => { const raw = (value as QuoteValues)[field]; return raw === null || typeof raw === 'string'; });
}
function validMove(value: ProjectQuoteMove) {
  if (!value || !validId(value.id) || !validId(value.projectId) || !validId(value.sourceWorkspaceId) || !validId(value.destinationWorkspaceId) || value.sourceWorkspaceId === value.destinationWorkspaceId || !validName(value.name) || !validValues(value.source) || !validValues(value.destinationBefore) || !validValues(value.target)) return false;
  if (!value.source.saved && !value.source.working || !equal(mappedValues(value.source, value), value.target)) return false;
  return fields.every(field => value.destinationBefore[field] === null || value.destinationBefore[field] === value.target[field]);
}
function journal(storage: Store): { raw: string | null; moves: ProjectQuoteMove[] } {
  const raw = storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL);
  if (raw === null) return { raw, moves: [] };
  try {
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || !Array.isArray(value.moves) || !value.moves.every(validMove) || new Set(value.moves.map((move: ProjectQuoteMove) => move.projectId)).size !== value.moves.length || new Set(value.moves.map((move: ProjectQuoteMove) => move.id)).size !== value.moves.length) throw Error('invalid');
    return { raw, moves: value.moves };
  } catch { throw new Error('报价迁移恢复记录无法核验，原始记录已保留；未移动项目或覆盖报价。'); }
}
function writeJournal(storage: Store, expected: string | null, moves: ProjectQuoteMove[]) {
  if (storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL) !== expected) throw conflictError();
  const raw = moves.length ? JSON.stringify({ version: 1, moves }) : null;
  if (raw === null) storage.removeItem(PROJECT_QUOTE_MOVE_JOURNAL); else storage.setItem(PROJECT_QUOTE_MOVE_JOURNAL, raw);
  if (storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL) !== raw) throw pendingError();
}
function currentMove(storage: Store, move: ProjectQuoteMove) {
  const current = journal(storage), stored = current.moves.find(item => item.id === move.id);
  if (!stored || JSON.stringify(stored) !== JSON.stringify(move)) throw conflictError();
  return current;
}
function writeValue(storage: Store, key: string, expected: string | null, next: string | null) {
  if (storage.getItem(key) !== expected) throw conflictError();
  if (next !== expected) { if (next === null) storage.removeItem(key); else storage.setItem(key, next); }
  if (storage.getItem(key) !== next) throw pendingError();
}
export function captureProjectQuoteMoves(storage: Store): ProjectQuoteMoveSnapshot { return { moves: journal(storage).moves }; }

/** Only authoritative native ownership decides whether staged quotes commit or roll back. */
export function finishProjectQuoteMove(storage: Store, move: ProjectQuoteMove, workspaceId: string) {
  currentMove(storage, move);
  if (workspaceId !== move.sourceWorkspaceId && workspaceId !== move.destinationWorkspaceId) throw pendingError();
  const sourceKeys = keys(move.sourceWorkspaceId, move.projectId), targetKeys = keys(move.destinationWorkspaceId, move.projectId);
  let failed = false;
  if (workspaceId === move.destinationWorkspaceId) {
    if (!equal(values(storage, move.destinationWorkspaceId, move.projectId), move.target)) throw conflictError();
    const currentSource = values(storage, move.sourceWorkspaceId, move.projectId);
    if (fields.some(field => currentSource[field] !== move.source[field] && currentSource[field] !== null)) throw conflictError();
    for (const field of fields) try { if (currentSource[field] !== null) writeValue(storage, sourceKeys[field], move.source[field], null); } catch { failed = true; }
    if (fields.some(field => storage.getItem(sourceKeys[field]) !== null)) failed = true;
  } else {
    // Roll back only exact writes belonging to this receipt. Concurrent changes remain untouched.
    for (const field of fields) {
      try {
        const source = storage.getItem(sourceKeys[field]);
        if (source === null && move.source[field] !== null) writeValue(storage, sourceKeys[field], null, move.source[field]);
        else if (source !== move.source[field]) throw conflictError();
      } catch { failed = true; }
      try {
        const target = storage.getItem(targetKeys[field]);
        if (target === move.target[field]) writeValue(storage, targetKeys[field], target, move.destinationBefore[field]);
        else if (target !== move.destinationBefore[field]) throw conflictError();
      } catch { failed = true; }
    }
  }
  if (failed) throw pendingError();
  const latest = currentMove(storage, move); writeJournal(storage, latest.raw, latest.moves.filter(item => item.id !== move.id));
}
export function prepareProjectQuoteMove(storage: Store, identity: MoveIdentity): ProjectQuoteMove | undefined {
  if (!validId(identity.projectId) || !validId(identity.sourceWorkspaceId) || !validId(identity.destinationWorkspaceId) || identity.sourceWorkspaceId === identity.destinationWorkspaceId || !validName(identity.name)) throw new Error('报价迁移的项目或工作区无效。');
  const current = journal(storage); if (current.moves.some(move => move.projectId === identity.projectId)) throw pendingError();
  const source = values(storage, identity.sourceWorkspaceId, identity.projectId), target = mappedValues(source, identity), destinationBefore = values(storage, identity.destinationWorkspaceId, identity.projectId);
  if (fields.some(field => destinationBefore[field] !== null && destinationBefore[field] !== target[field])) throw new Error('目标工作区已有不同的项目报价，未移动文件或覆盖双方内容；请先导出并核对报价。');
  if (!source.saved && !source.working) return undefined;
  const move: ProjectQuoteMove = { ...identity, id: crypto.randomUUID(), source, destinationBefore, target };
  writeJournal(storage, current.raw, [...current.moves, move]);
  try {
    const targetKeys = keys(identity.destinationWorkspaceId, identity.projectId);
    for (const field of fields) writeValue(storage, targetKeys[field], destinationBefore[field], target[field]);
    if (!equal(values(storage, identity.sourceWorkspaceId, identity.projectId), source)) throw conflictError();
  } catch (error) {
    try { finishProjectQuoteMove(storage, move, identity.sourceWorkspaceId); } catch { throw pendingError(); }
    throw error;
  }
  return move;
}
export function recoverProjectQuoteMoves(storage: Store, snapshot: ProjectQuoteMoveSnapshot, locations: ProjectLocation[]) {
  for (const move of snapshot.moves) {
    const actual = journal(storage).moves.find(item => item.id === move.id);
    if (!actual || JSON.stringify(actual) !== JSON.stringify(move)) continue;
    const location = locations.find(item => item.projectId === move.projectId);
    if (!location) throw pendingError();
    finishProjectQuoteMove(storage, move, location.workspaceId);
  }
}
interface MoveOptions extends MoveIdentity {
  storage: Store;
  move: () => Promise<ProjectLocation | null | undefined>;
  locate: () => Promise<ProjectLocation | undefined>;
}
export async function withProjectQuoteMove({ storage, move: nativeMove, locate, ...identity }: MoveOptions): Promise<ProjectLocation | null | undefined> {
  const pending = journal(storage).moves.find(item => item.projectId === identity.projectId);
  if (pending) {
    let location; try { location = await locate(); } catch { throw pendingError(); }
    if (!location || location.projectId !== identity.projectId) throw pendingError();
    finishProjectQuoteMove(storage, pending, location.workspaceId);
    if (pending.sourceWorkspaceId === identity.sourceWorkspaceId && pending.destinationWorkspaceId === identity.destinationWorkspaceId && location.workspaceId === identity.destinationWorkspaceId && pending.name === identity.name && (identity.name === undefined || location.name === identity.name)) return location;
    if (location.workspaceId !== identity.sourceWorkspaceId) throw new Error('项目的实际工作区已变化，请重新读取当前项目后继续；报价已恢复。');
  }
  const receipt = prepareProjectQuoteMove(storage, identity);
  if (!receipt) return nativeMove();
  let location: ProjectLocation | null | undefined, failure: unknown;
  try { location = await nativeMove(); } catch (error) { failure = error; }
  if (!location || location.projectId !== identity.projectId || location.workspaceId !== identity.destinationWorkspaceId || identity.name !== undefined && location.name !== identity.name) {
    if (location) failure ||= new Error('项目移动回执与当前操作不一致，原报价与当前修改已保留。');
    try { location = await locate(); } catch { throw pendingError(); }
    if (!location || location.projectId !== identity.projectId) throw pendingError();
    if (identity.name !== undefined && location.workspaceId === identity.destinationWorkspaceId && location.name !== identity.name) throw pendingError();
    finishProjectQuoteMove(storage, receipt, location.workspaceId);
    if (location.workspaceId === identity.destinationWorkspaceId) return location;
    if (failure) throw failure;
    return null;
  }
  finishProjectQuoteMove(storage, receipt, location.workspaceId);
  return location;
}
