import { describe, expect, it } from 'vitest';
import { initialConfiguration, readConfigurationResult } from './configuration';
import { CONFIGURATION_KEY, loadStoredConfiguration, resetStoredConfiguration, writeStoredConfiguration } from './configuration-storage';

function storage(initial?: string) {
  const entries = new Map<string, string>(initial === undefined ? [] : [[CONFIGURATION_KEY, initial]]);
  const writes: { key: string; value: string }[] = [];
  return { entries, writes, getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { writes.push({ key, value }); entries.set(key, value); } };
}
describe('模型与工作流配置存储恢复保护', () => {
  it('首次空存储可初始化但读取本身不写默认数据', () => {
    const local = storage(), result = loadStoredConfiguration(local);
    expect(result.issue).toBeUndefined(); expect(result.raw).toBeNull(); expect(result.state).toEqual(initialConfiguration()); expect(local.writes).toEqual([]);
  });
  it.each(['BROKEN_LOCAL_FIXTURE', '', 'null', '[]', '{}'])('损坏或错误结构%s保留原字符串且无自动写入', raw => {
    const local = storage(raw), result = loadStoredConfiguration(local);
    expect(result.issue).toMatchObject({ kind: 'read', canExportOriginal: true }); expect(result.raw).toBe(raw); expect(local.getItem(CONFIGURATION_KEY)).toBe(raw); expect(local.writes).toEqual([]);
  });
  it('合法JSON内的坏步骤不进入hook map，也不当合法数据覆盖', () => {
    const state = initialConfiguration(); state.workflows = [{ id: 'flow', workspaceId: 'workspace', name: '坏结构固定测试', steps: null } as never];
    const raw = JSON.stringify(state), local = storage(raw), result = loadStoredConfiguration(local);
    expect(result.issue?.kind).toBe('read'); expect(result.state.workflows).toEqual([]); expect(local.getItem(CONFIGURATION_KEY)).toBe(raw); expect(local.writes).toEqual([]);
  });
  it('列表展示字段被损坏成对象时不让该值进入React渲染', () => {
    const state = initialConfiguration(); state.workflows = [{ id: 'flow', workspaceId: 'workspace', name: '固定工作流', description: { fixture: 'not renderable' }, outputKind: 'word', updatedAt: '', steps: [] } as never];
    expect(readConfigurationResult(JSON.stringify(state)).issue?.code).toBe('schema');
    state.workflows = []; state.categories = [{ id: 'category', workspaceId: 'workspace', name: '固定分类', archived: {} } as never];
    expect(readConfigurationResult(JSON.stringify(state)).issue?.code).toBe('schema');
  });
  it('旧配置可缺少新增可选列表且空金额上限迁移不修改原串', () => {
    const state = initialConfiguration();
    state.workflows = [{ id: 'flow', workspaceId: 'workspace', name: '旧工作流', description: '', outputKind: 'word', updatedAt: '', steps: [{ id: 'step', name: '检查', kind: 'manual-review', prompt: '', inputSource: 'project', enabled: true, budgetCents: null as never }] }];
    const { studioActions: _actions, useTemplates: _templates, ...legacy } = state;
    const raw = JSON.stringify(legacy), local = storage(raw), result = loadStoredConfiguration(local);
    expect(result.issue).toBeUndefined(); expect(result.state.studioActions).toEqual([]); expect(result.state.useTemplates).toEqual([]); expect(result.state.workflows[0].steps[0].budgetCents).toBeUndefined(); expect(local.getItem(CONFIGURATION_KEY)).toBe(raw);
  });
  it('用途模板中存在坏项时保留整份原数据，不静默过滤后持久化', () => {
    const raw = JSON.stringify({ ...initialConfiguration(), useTemplates: [{ id: 'broken-template' }] });
    const result = readConfigurationResult(raw); expect(result.issue?.code).toBe('schema'); expect(result.state.useTemplates).toEqual([]);
  });
  it('存储访问失败不创建空数据，无法声称可导出未读取的原串', () => {
    let writes = 0;
    const local = { getItem: () => { throw new Error('fixture storage denied'); }, setItem: () => { writes++; } };
    expect(loadStoredConfiguration(local).issue).toMatchObject({ kind: 'read', canExportOriginal: false });
    expect(resetStoredConfiguration(local, 'backup').issue?.kind).toBe('read'); expect(writes).toBe(0);
  });
  it('localStorage属性自身不可访问时也提供可见诊断而不抛出', () => {
    const unavailable = () => { throw new Error('fixture storage accessor denied'); };
    expect(loadStoredConfiguration(unavailable).issue).toMatchObject({ kind: 'read', canExportOriginal: false });
    expect(writeStoredConfiguration(unavailable, initialConfiguration()).issue?.kind).toBe('write');
    expect(resetStoredConfiguration(unavailable, 'backup').issue?.kind).toBe('read');
  });
  it('正常写入只在成功后返回可提交的新原串', () => {
    const local = storage(), state = initialConfiguration(); state.categories.push({ id: 'category', workspaceId: 'workspace', name: '本地分类', archived: false });
    const saved = writeStoredConfiguration(local, state);
    expect(saved.issue).toBeUndefined(); expect(saved.raw).toBe(local.getItem(CONFIGURATION_KEY)); expect(JSON.parse(saved.raw!).categories).toHaveLength(1);
  });
  it('配额错误不覆盖旧配置，也不返回成功状态', () => {
    const raw = JSON.stringify(initialConfiguration()), local = storage(raw);
    const saved = writeStoredConfiguration({ ...local, setItem: () => { throw new Error('fixture quota exceeded'); } }, initialConfiguration());
    expect(saved.issue?.kind).toBe('write'); expect(saved.raw).toBeUndefined(); expect(local.getItem(CONFIGURATION_KEY)).toBe(raw); expect(local.writes).toEqual([]);
  });
  it('显式重置必须先完整备份原串，成功后才写默认配置', () => {
    const raw = 'BROKEN_FIXTURE\n保留全部原字符', local = storage(raw), result = resetStoredConfiguration(local, 'fixture-backup');
    expect(result.issue).toBeUndefined(); expect(local.writes.map(item => item.key)).toEqual(['fixture-backup', CONFIGURATION_KEY]); expect(local.getItem('fixture-backup')).toBe(raw); expect(JSON.parse(local.getItem(CONFIGURATION_KEY)!)).toEqual(initialConfiguration());
  });
  it('备份因配额失败时绝不继续执行重置', () => {
    const raw = 'BROKEN_FIXTURE', local = storage(raw);
    const result = resetStoredConfiguration({ ...local, setItem: (key, value) => { if (key === 'fixture-backup') throw new Error('fixture backup quota failure'); local.setItem(key, value); } }, 'fixture-backup');
    expect(result.issue).toMatchObject({ kind: 'read', canExportOriginal: true }); expect(result.raw).toBe(raw); expect(local.getItem(CONFIGURATION_KEY)).toBe(raw); expect(local.writes).toEqual([]);
  });
  it('备份成功但默认配置写入失败时原串和备份都保留', () => {
    const raw = 'BROKEN_FIXTURE', local = storage(raw);
    const result = resetStoredConfiguration({ ...local, setItem: (key, value) => { if (key === CONFIGURATION_KEY) throw new Error('fixture reset failure'); local.setItem(key, value); } }, 'fixture-backup');
    expect(result.issue?.kind).toBe('read'); expect(local.getItem(CONFIGURATION_KEY)).toBe(raw); expect(local.getItem('fixture-backup')).toBe(raw);
  });
  it('原始配置已在其他窗口修复时拒绝陈旧面板重置，不更新其期望原串', () => {
    const expected = 'BROKEN_FIXTURE', repaired = JSON.stringify(initialConfiguration()), local = storage(repaired);
    const result = resetStoredConfiguration(local, 'fixture-backup', expected);
    expect(result.issue?.message).toContain('其他窗口更新'); expect(result.raw).toBe(expected); expect(local.getItem(CONFIGURATION_KEY)).toBe(repaired); expect(local.writes).toEqual([]);
    expect(resetStoredConfiguration(local, 'another-backup', result.raw).issue?.kind).toBe('read'); expect(local.writes).toEqual([]);
  });
  it('备份期间发生外部更新也不覆盖新配置，旧原串副本仍保留', () => {
    const expected = 'BROKEN_FIXTURE', repaired = JSON.stringify(initialConfiguration()), local = storage(expected);
    const result = resetStoredConfiguration({ ...local, setItem: (key, value) => { local.setItem(key, value); if (key === 'fixture-backup') local.entries.set(CONFIGURATION_KEY, repaired); } }, 'fixture-backup', expected);
    expect(result.issue?.message).toContain('备份期间'); expect(result.raw).toBe(expected); expect(local.getItem(CONFIGURATION_KEY)).toBe(repaired); expect(local.getItem('fixture-backup')).toBe(expected); expect(local.writes.map(item => item.key)).toEqual(['fixture-backup']);
  });
  it('期望空值与已新增配置不匹配时也不清空后来新增的数据', () => {
    const repaired = JSON.stringify(initialConfiguration()), local = storage(repaired);
    expect(resetStoredConfiguration(local, 'fixture-backup', null).issue?.kind).toBe('read'); expect(local.getItem(CONFIGURATION_KEY)).toBe(repaired); expect(local.writes).toEqual([]);
  });
  it('修复原始内容后重新读取成功且继续保留同一模型与工作流ID', () => {
    const local = storage('BROKEN_FIXTURE'); expect(loadStoredConfiguration(local).issue?.kind).toBe('read');
    const valid = initialConfiguration(); local.setItem(CONFIGURATION_KEY, JSON.stringify(valid)); const result = loadStoredConfiguration(local);
    expect(result.issue).toBeUndefined(); expect(result.state.models.map(model => model.id)).toEqual(valid.models.map(model => model.id)); expect(local.writes).toHaveLength(1);
  });
});
