import { describe, expect, it, vi } from 'vitest';
import { projectQuoteKey, readProjectQuote, saveProjectQuote } from './project-quotes';
import { quoteWorkingKey, readQuoteWorkingDraft, saveQuoteWorkingDraft } from './quote-working-drafts';
import { collectQuoteBackups } from './quote-backup';
import { emptyCustomerQuote } from './customer-quote';
import { captureProjectQuoteMoves, finishProjectQuoteMove, prepareProjectQuoteMove, recoverProjectQuoteMoves, withProjectQuoteMove, PROJECT_QUOTE_MOVE_JOURNAL } from './project-quote-move';

const inputs = { minutes: '120', rate: '60', other: '0', reserve: '0', remaining: '0', fee: '10', profit: '50', price: '19.9', variable: '1' };
const identity = { projectId: 'project', sourceWorkspaceId: 'one', destinationWorkspaceId: 'two' };
const location = (workspaceId: string) => ({ projectId: 'project', workspaceId, name: '项目', directory: `C:/owned/${workspaceId}/project` });
function fixture() {
  const values = new Map<string, string>(), writes: string[] = [];
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { writes.push(key); values.set(key, value); }, removeItem: (key: string) => { writes.push(key); values.delete(key); } };
  return { values, writes, storage };
}
function seed(f: ReturnType<typeof fixture>, conflict = false) {
  const saved = saveProjectQuote(f.storage, { type: 'xuzuo-project-quote', version: 1, workspaceId: 'one', projectId: 'project', inputs, mode: 'single', scope: 'live', customer: { ...emptyCustomerQuote(), scope: '六张图片，包含一轮修改' }, savedAt: '2026-11-06', unknownMetadata: { retained: true } }, null);
  const working = saveQuoteWorkingDraft(f.storage, { type: 'xuzuo-quote-working', version: 1, workspaceId: 'one', projectId: 'project', inputs: { ...inputs, minutes: '125' }, mode: 'repeat', scope: 'simulation', customer: { ...emptyCustomerQuote(), client: '工作客户', scope: '真实范围' }, baseSavedRaw: conflict ? `${saved}\n` : saved, updatedAt: '2026-11-06' }, null);
  return { saved, working };
}
describe('项目报价随文件移动的可恢复事务', () => {
  it('先写可恢复日志和目标副本，源原串保持；提交后备份包含正式与不同临时输入、客户及未知字段', () => {
    const f = fixture(), original = seed(f); f.writes.length = 0;
    const tx = prepareProjectQuoteMove(f.storage, identity)!;
    expect(f.writes[0]).toBe(PROJECT_QUOTE_MOVE_JOURNAL);
    expect(f.storage.getItem(projectQuoteKey('one', 'project'))).toBe(original.saved); expect(f.storage.getItem(quoteWorkingKey('one', 'project'))).toBe(original.working);
    const saved = readProjectQuote(f.storage, 'two', 'project'), working = readQuoteWorkingDraft(f.storage, 'two', 'project');
    expect(saved.draft?.inputs.minutes).toBe('120'); expect(saved.draft?.unknownMetadata).toEqual({ retained: true }); expect(working.draft).toMatchObject({ inputs: { minutes: '125' }, mode: 'repeat', scope: 'simulation', customer: { client: '工作客户', scope: '真实范围' } }); expect(working.draft?.baseSavedRaw).toBe(saved.raw);
    finishProjectQuoteMove(f.storage, tx, 'two');
    expect(f.storage.getItem(projectQuoteKey('one', 'project'))).toBeNull(); expect(f.storage.getItem(quoteWorkingKey('one', 'project'))).toBeNull(); expect(f.storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL)).toBeNull();
    const backups = collectQuoteBackups(f.storage, [{ id: 'project', workspaceId: 'two' }]); expect(backups).toHaveLength(1); expect(backups[0].working?.baseSavedMatchesCurrent).toBe(true);
  });
  it.each(['changed', 'format-only'] as const)('保留%s正式基线冲突，不把历史基线悄悄变成当前正式版本', change => {
    const f = fixture(); seed(f, change === 'format-only'); if (change === 'changed') f.storage.setItem(projectQuoteKey('one', 'project'), JSON.stringify({ ...readProjectQuote(f.storage, 'one', 'project').draft, inputs: { ...inputs, rate: '99' } }));
    const tx = prepareProjectQuoteMove(f.storage, identity)!; finishProjectQuoteMove(f.storage, tx, 'two');
    expect(readQuoteWorkingDraft(f.storage, 'two', 'project').draft?.baseSavedRaw).not.toBe(readProjectQuote(f.storage, 'two', 'project').raw); expect(collectQuoteBackups(f.storage, [{ id: 'project', workspaceId: 'two' }])[0].working?.baseSavedMatchesCurrent).toBe(false);
  });
  it('保存正式或仅临时的项目都迁移，没有报价的项目不创建默认值/日志', () => {
    for (const kind of ['saved', 'working', 'none']) {
      const f = fixture(); seed(f); if (kind !== 'saved') f.values.delete(projectQuoteKey('one', 'project')); if (kind !== 'working') f.values.delete(quoteWorkingKey('one', 'project'));
      if (kind === 'working') { const raw = JSON.parse(f.storage.getItem(quoteWorkingKey('one', 'project'))!); raw.baseSavedRaw = null; f.storage.setItem(quoteWorkingKey('one', 'project'), JSON.stringify(raw)); }
      const tx = prepareProjectQuoteMove(f.storage, identity); if (tx) finishProjectQuoteMove(f.storage, tx, 'two');
      expect(!!readProjectQuote(f.storage, 'two', 'project').draft).toBe(kind === 'saved'); expect(!!readQuoteWorkingDraft(f.storage, 'two', 'project').draft).toBe(kind === 'working'); expect(f.storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL)).toBeNull();
    }
  });
  it('成功后编辑目标再移回，不复活旧报价；工作基线和备份仍正确', () => {
    const f = fixture(); seed(f); finishProjectQuoteMove(f.storage, prepareProjectQuoteMove(f.storage, identity)!, 'two');
    const working = readQuoteWorkingDraft(f.storage, 'two', 'project'); saveQuoteWorkingDraft(f.storage, { ...working.draft!, inputs: { ...inputs, minutes: '140' } }, working.raw);
    const tx = prepareProjectQuoteMove(f.storage, { ...identity, sourceWorkspaceId: 'two', destinationWorkspaceId: 'one' })!; finishProjectQuoteMove(f.storage, tx, 'one');
    expect(readQuoteWorkingDraft(f.storage, 'one', 'project').draft?.inputs.minutes).toBe('140'); expect(collectQuoteBackups(f.storage, [{ id: 'project', workspaceId: 'one' }])[0].working?.baseSavedMatchesCurrent).toBe(true);
  });
  it('目标冲突、损坏源/基线在任何目标写入或原生操作前拒绝，保留原始内容', async () => {
    for (const kind of ['target', 'source', 'baseline']) {
      const f = fixture(); seed(f);
      if (kind === 'target') f.values.set(projectQuoteKey('two', 'project'), JSON.stringify({ ...readProjectQuote(f.storage, 'one', 'project').draft, workspaceId: 'two', inputs: { ...inputs, minutes: '1' } }));
      else if (kind === 'source') f.values.set(projectQuoteKey('one', 'project'), '{broken');
      else { const raw = JSON.parse(f.storage.getItem(quoteWorkingKey('one', 'project'))!); raw.baseSavedRaw = '{broken'; f.values.set(quoteWorkingKey('one', 'project'), JSON.stringify(raw)); }
      const before = [...f.values], move = vi.fn(async () => location('two'));
      await expect(withProjectQuoteMove({ storage: f.storage, ...identity, move, locate: async () => location('one') })).rejects.toThrow(); expect(move).not.toHaveBeenCalled(); expect([...f.values]).toEqual(before);
    }
  });
  it.each(['cancel', 'reject'] as const)('原生%s且权威位置仍在源区时回滚自己副本，正式/临时原串不变', async kind => {
    const f = fixture(); seed(f); const before = [...f.values];
    const operation = withProjectQuoteMove({ storage: f.storage, ...identity, move: async () => { if (kind === 'reject') throw Error('目录只读'); return null; }, locate: async () => location('one') });
    if (kind === 'reject') await expect(operation).rejects.toThrow('目录只读'); else expect(await operation).toBeNull(); expect([...f.values]).toEqual(before);
  });
  it('已移动但ACK丢失以权威归属完成一次，不重发文件移动', async () => {
    const f = fixture(); seed(f); const move = vi.fn(async () => { throw Error('ACK lost'); });
    expect(await withProjectQuoteMove({ storage: f.storage, ...identity, move, locate: async () => location('two') })).toEqual(location('two')); expect(move).toHaveBeenCalledTimes(1); expect(readQuoteWorkingDraft(f.storage, 'two', 'project').draft?.inputs.minutes).toBe('125'); expect(f.storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL)).toBeNull();
  });
  it('不能读取权威位置时保留双方与日志；同一事务重试只完成已发生移动', async () => {
    const f = fixture(); seed(f); const move = vi.fn(async () => { throw Error('ACK lost'); });
    await expect(withProjectQuoteMove({ storage: f.storage, ...identity, move, locate: async () => { throw Error('offline'); } })).rejects.toThrow('恢复'); expect(f.storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL)).not.toBeNull();
    const retry = vi.fn(async () => location('two')); expect(await withProjectQuoteMove({ storage: f.storage, ...identity, move: retry, locate: async () => location('two') })).toEqual(location('two')); expect(retry).not.toHaveBeenCalled();
  });
  it.each(['one', 'two'] as const)('启动只根据权威%s区恢复预存在事务，不调用文件移动或模型', owner => {
    const f = fixture(); const original = seed(f); prepareProjectQuoteMove(f.storage, identity); const captured = captureProjectQuoteMoves(f.storage);
    recoverProjectQuoteMoves(f.storage, captured, [location(owner)]); expect(f.storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL)).toBeNull();
    if (owner === 'one') { expect(f.storage.getItem(projectQuoteKey('one', 'project'))).toBe(original.saved); expect(f.storage.getItem(projectQuoteKey('two', 'project'))).toBeNull(); } else expect(readQuoteWorkingDraft(f.storage, 'two', 'project').draft?.inputs.minutes).toBe('125');
  });
  it('启动捕获为空时正常refresh不回滚稍后新建事务；变更事务与未知归属均不得自动处理', () => {
    const f = fixture(); seed(f); const empty = captureProjectQuoteMoves(f.storage); prepareProjectQuoteMove(f.storage, identity); const raw = f.storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL);
    recoverProjectQuoteMoves(f.storage, empty, [location('one')]); expect(f.storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL)).toBe(raw);
    const captured = captureProjectQuoteMoves(f.storage); expect(() => recoverProjectQuoteMoves(f.storage, captured, [location('foreign')])).toThrow(); expect(f.storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL)).toBe(raw);
  });
  it('回滚不覆盖其他窗口的源或目标修改；双方原始凭据保留', () => {
    const f = fixture(); seed(f); const tx = prepareProjectQuoteMove(f.storage, identity)!; const changed = JSON.stringify({ ...readProjectQuote(f.storage, 'two', 'project').draft, inputs: { ...inputs, minutes: '160' } }); f.values.set(projectQuoteKey('two', 'project'), changed);
    expect(() => finishProjectQuoteMove(f.storage, tx, 'one')).toThrow(); expect(f.storage.getItem(projectQuoteKey('two', 'project'))).toBe(changed); expect(f.storage.getItem(projectQuoteKey('one', 'project'))).not.toBeNull(); expect(f.storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL)).not.toBeNull();
  });
  it('每个准备写入点失败均不调用原生移动，保留源并可在重开时回滚', async () => {
    for (let failure = 1; failure <= 3; failure++) {
      const f = fixture(); const original = seed(f); let writes = 0;
      const storage = { ...f.storage, setItem: (key: string, raw: string) => { if (++writes === failure) throw Error('quota'); f.storage.setItem(key, raw); } }, move = vi.fn(async () => location('two'));
      await expect(withProjectQuoteMove({ storage, ...identity, move, locate: async () => location('one') })).rejects.toThrow(); expect(move).not.toHaveBeenCalled();
      recoverProjectQuoteMoves(f.storage, captureProjectQuoteMoves(f.storage), [location('one')]); expect(f.storage.getItem(projectQuoteKey('one', 'project'))).toBe(original.saved); expect(f.storage.getItem(quoteWorkingKey('one', 'project'))).toBe(original.working); expect(f.storage.getItem(projectQuoteKey('two', 'project'))).toBeNull();
    }
  });
  it('提交清理写失败后的重开可完成，源先被部分清理也不丢数据', () => {
    const f = fixture(); seed(f); const tx = prepareProjectQuoteMove(f.storage, identity)!; let removals = 0;
    const storage = { ...f.storage, removeItem: (key: string) => { if (++removals === 2) throw Error('disk full'); f.storage.removeItem(key); } };
    expect(() => finishProjectQuoteMove(storage, tx, 'two')).toThrow(); expect(readQuoteWorkingDraft(f.storage, 'two', 'project').draft?.inputs.minutes).toBe('125'); expect(f.storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL)).not.toBeNull();
    recoverProjectQuoteMoves(f.storage, captureProjectQuoteMoves(f.storage), [location('two')]); expect(f.storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL)).toBeNull(); expect(f.storage.getItem(quoteWorkingKey('one', 'project'))).toBeNull();
  });
  it('原生执行期间源正式报价变化不被提交清理，目标副本与恢复凭据仍保留', async () => {
    const f = fixture(); seed(f); let changed = '';
    await expect(withProjectQuoteMove({ storage: f.storage, ...identity, move: async () => { changed = JSON.stringify({ ...readProjectQuote(f.storage, 'one', 'project').draft, inputs: { ...inputs, minutes: '200' } }); f.values.set(projectQuoteKey('one', 'project'), changed); return location('two'); }, locate: async () => location('two') })).rejects.toThrow('另一处');
    expect(f.storage.getItem(projectQuoteKey('one', 'project'))).toBe(changed); expect(readQuoteWorkingDraft(f.storage, 'two', 'project').draft?.inputs.minutes).toBe('125'); expect(f.storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL)).not.toBeNull();
  });
  it('删除前第二次比较原串，不能把并发新源值当作自己的旧值删除', () => {
    const f = fixture(); seed(f); const tx = prepareProjectQuoteMove(f.storage, identity)!; let reads = 0; const key = projectQuoteKey('one', 'project'); const original = f.storage.getItem(key)!; const changed = `${original}\n`;
    const storage = { ...f.storage, getItem: (name: string) => { if (name === key && ++reads === 2) f.values.set(key, changed); return f.storage.getItem(name); } };
    expect(() => finishProjectQuoteMove(storage, tx, 'two')).toThrow(); expect(f.storage.getItem(key)).toBe(changed); expect(f.storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL)).not.toBeNull();
  });
  it('持久写失败连回滚也失败时仍保留可重放日志，重开后恢复源而不丢数据', async () => {
    const f = fixture(); const original = seed(f); let writes = 0; const move = vi.fn(async () => location('two'));
    const storage = { ...f.storage, setItem: (key: string, raw: string) => { if (++writes >= 3) throw Error('persistent quota'); f.storage.setItem(key, raw); }, removeItem: () => { throw Error('remove denied'); } };
    await expect(withProjectQuoteMove({ storage, ...identity, move, locate: async () => location('one') })).rejects.toThrow('恢复'); expect(move).not.toHaveBeenCalled(); expect(f.storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL)).not.toBeNull();
    recoverProjectQuoteMoves(f.storage, captureProjectQuoteMoves(f.storage), [location('one')]); expect(f.storage.getItem(projectQuoteKey('one', 'project'))).toBe(original.saved); expect(f.storage.getItem(quoteWorkingKey('one', 'project'))).toBe(original.working); expect(f.storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL)).toBeNull();
  });
  it('损坏日志不会读取任意键或覆盖数据，新移动在原生调用前失败', async () => {
    const f = fixture(); seed(f); f.values.set(PROJECT_QUOTE_MOVE_JOURNAL, '{bad'); const before = [...f.values], move = vi.fn(async () => location('two'));
    await expect(withProjectQuoteMove({ storage: f.storage, ...identity, move, locate: async () => location('one') })).rejects.toThrow('恢复记录'); expect(move).not.toHaveBeenCalled(); expect([...f.values]).toEqual(before);
  });
  it('对方工作区或其他项目ACK不能删除源报价；实际位置未知保留恢复凭据', async () => {
    const f = fixture(); seed(f); const original = f.storage.getItem(projectQuoteKey('one', 'project'));
    await expect(withProjectQuoteMove({ storage: f.storage, ...identity, move: async () => ({ ...location('two'), projectId: 'foreign' }), locate: async () => location('foreign') })).rejects.toThrow('恢复'); expect(f.storage.getItem(projectQuoteKey('one', 'project'))).toBe(original); expect(f.storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL)).not.toBeNull();
  });
  it('更改名称的重试不能把旧已完成回执当作新的名称保存，也不重发文件移动', async () => {
    const f = fixture(); seed(f); prepareProjectQuoteMove(f.storage, { ...identity, name: '项目' }); const move = vi.fn(async () => ({ ...location('two'), name: '新名称' }));
    await expect(withProjectQuoteMove({ storage: f.storage, ...identity, name: '新名称', move, locate: async () => location('two') })).rejects.toThrow('实际工作区已变化'); expect(move).not.toHaveBeenCalled(); expect(readProjectQuote(f.storage, 'two', 'project').draft?.inputs.minutes).toBe('120'); expect(f.storage.getItem(PROJECT_QUOTE_MOVE_JOURNAL)).toBeNull();
  });
  it('旧启动快照不会处理同一项目后来重新准备的新事务', () => {
    const f = fixture(); seed(f); const first = prepareProjectQuoteMove(f.storage, identity)!; const captured = captureProjectQuoteMoves(f.storage); finishProjectQuoteMove(f.storage, first, 'one');
    const second = prepareProjectQuoteMove(f.storage, identity)!; recoverProjectQuoteMoves(f.storage, captured, [location('one')]); expect(captureProjectQuoteMoves(f.storage).moves.map(move => move.id)).toEqual([second.id]);
  });
});
