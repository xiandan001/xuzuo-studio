import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('折叠状态只保存明确的界面选择', () => {
  const entries = new Map<string, string>();
  const storage = { getItem: vi.fn((key: string) => entries.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { entries.set(key, value); }) };
  let onStorage: (event: Partial<StorageEvent>) => void;
  beforeEach(() => {
    vi.resetModules(); entries.clear(); storage.getItem.mockClear(); storage.setItem.mockClear();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { addEventListener: vi.fn((_type: string, listener: typeof onStorage) => { onStorage = listener; }), removeEventListener: vi.fn() });
  });
  it('未选择时只读取响应式默认值，不写盘；错误与错类型记录不改变默认', async () => {
    const store = await import('./disclosure-state');
    expect(store.readDisclosure('files', false)).toBe(false); expect(store.readDisclosure('files', true)).toBe(true);
    entries.set('xuzuo-disclosure-v1:files', '{bad'); expect(store.readDisclosure('files', false)).toBe(false);
    entries.set('xuzuo-disclosure-v1:files', JSON.stringify({ version: 1, value: 'true' })); expect(store.readDisclosure('files', false)).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('文档和图片左右各自记忆，模块重载后仍保持且不改费用记录', async () => {
    const store = await import('./disclosure-state'); entries.set('ledger-sentinel', '{"cost":17}');
    store.writeDisclosure('documents:files-visible', false); store.writeDisclosure('images:tools-visible', false);
    expect(store.readDisclosure('documents:tools-visible', true)).toBe(true);
    vi.resetModules(); const reloaded = await import('./disclosure-state');
    expect(reloaded.readDisclosure('documents:files-visible', true)).toBe(false); expect(reloaded.readDisclosure('images:tools-visible', true)).toBe(false);
    expect(entries.get('ledger-sentinel')).toBe('{"cost":17}');
  });
  it('仅通知相同区域并清理订阅；其他窗口更改和清空可刷新', async () => {
    const store = await import('./disclosure-state'), listener = vi.fn(), other = vi.fn();
    const remove = store.subscribeDisclosure('a', listener), removeOther = store.subscribeDisclosure('b', other);
    store.writeDisclosure('a', false); expect(listener).toHaveBeenCalledTimes(1); expect(other).not.toHaveBeenCalled();
    entries.set('xuzuo-disclosure-v1:a', JSON.stringify({ version: 1, value: true })); onStorage({ key: 'xuzuo-disclosure-v1:a' });
    expect(store.readDisclosure('a', false)).toBe(true); expect(listener).toHaveBeenCalledTimes(2);
    entries.clear(); onStorage({ key: null }); expect(store.readDisclosure('a', false)).toBe(false); expect(other).toHaveBeenCalledTimes(1);
    remove(); removeOther(); expect(window.removeEventListener).toHaveBeenCalledTimes(1);
  });
  it('存储失败仍可在本会话收起展开，不阻塞编辑', async () => {
    const store = await import('./disclosure-state'); storage.setItem.mockImplementationOnce(() => { throw Error('storage blocked'); });
    store.writeDisclosure('files', false); expect(store.readDisclosure('files', true)).toBe(false);
    store.writeDisclosure('files', true); expect(store.readDisclosure('files', false)).toBe(true);
  });
  it('展开明细ID可记忆并清除，始终与其他项目分离', async () => {
    const store = await import('./disclosure-state'); store.writeDisclosure('project-a:cost', 'entry-id');
    expect(store.readDisclosure('project-a:cost', '')).toBe('entry-id'); expect(store.readDisclosure('project-b:cost', '')).toBe('');
    store.writeDisclosure('project-a:cost', ''); expect(store.readDisclosure('project-a:cost', '')).toBe('');
  });
});
