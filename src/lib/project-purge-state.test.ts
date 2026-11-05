import { describe, expect, it } from 'vitest';
import { INITIAL_PREFERENCES, INITIAL_PROJECTS } from '../data';
import { isActiveProject, isRecoverableProject, mergePurgedProjectAudits, moveProjectWorkspace, projectPurgeError, projectTrashError, purgeProjectState, purgedProjectAudit, restoreProjectState, scopeWorkspace, trashProjectState } from './workspace-state';
import { readWorkspaceState, WORKSPACE_STORAGE_KEY } from './workspace-persistence';
import { mergeBackupImport, relocatedWorkspaceState } from './data-management';
import { initialConfiguration } from './configuration';
import { applyLiveProjectState } from '../hooks/useLiveWorkflowRunner';
import { collectQuoteBackups, quoteRestorationWrites } from './quote-backup';
import type { Project } from '../types';
import type { WorkspaceState } from './workspace-state';
import type { BackupImportResult } from '../data-management-types';

const time = '2026-11-04T04:00:00.000Z';
function fixture() {
  const project: Project = { ...INITIAL_PROJECTS[0], id: 'purged-project', workspaceId: 'workspace-one', trashedAt: '2026-11-04T03:00:00Z', directory: 'D:/owned/project', description: 'PRIVATE-BODY', referenceFiles: [{ id: 'source', name: 'private.png', bytes: 5, kind: 'image', mimeType: 'image/png' }], favorite: true, confirmedDelivery: { id: 'receipt', fingerprint: 'x', runStateSignature: 'x' } };
  const ledger = [{ id: 'fee', projectId: project.id, projectName: project.name, action: '初次生成' as const, model: 'owned', costCents: 137, status: 'complete' as const, time, billingMode: 'live' as const }];
  const state: WorkspaceState = { workspaces: [{ id: project.workspaceId, name: 'Owned', description: '', createdAt: time }], activeWorkspaceId: project.workspaceId, projects: [project], ledger, customPrompts: [], preferencesByWorkspace: { [project.workspaceId]: INITIAL_PREFERENCES } };
  return { project, ledger, state };
}

describe('项目永久移除审计', () => {
  it('保留不可恢复归属而清正文目录引用，最后一个项目移除后本区费用不减少', () => {
    const f = fixture(), before = JSON.stringify(f.state), projects = purgeProjectState(f.state.projects, f.project.id, f.project.workspaceId, new Set(), time);
    const scope = scopeWorkspace(projects, f.ledger, f.project.workspaceId);
    expect(scope.projects).toEqual([]); expect(scope.trashedProjects).toEqual([]); expect(scope.ledger).toEqual(f.ledger); expect(scope.ledger[0]).toBe(f.ledger[0]);
    expect(projects[0]).toMatchObject({ id: f.project.id, workspaceId: f.project.workspaceId, name: f.project.name, costCents: f.project.costCents, purgedAt: time, trashedAt: f.project.trashedAt, description: '' });
    for (const field of ['directory', 'referenceFiles', 'confirmedDelivery', 'favorite']) expect(projects[0]).not.toHaveProperty(field);
    expect(JSON.stringify(f.state)).toBe(before); expect(scopeWorkspace(projects, f.ledger, 'other').ledger).toEqual([]);
  });
  it('仅允许本区已回收且无活动写入的项目；重复永久移除不改时间或对象', () => {
    const f = fixture();
    expect(purgeProjectState(f.state.projects, f.project.id, 'other', new Set(), time)).toBe(f.state.projects);
    expect(projectPurgeError({ ...f.project, trashedAt: undefined }, f.project.workspaceId, new Set())).toContain('回收站');
    for (const status of ['paused', 'processing'] as const) expect(projectPurgeError({ ...f.project, status }, f.project.workspaceId, new Set())).toContain('任务');
    expect(purgeProjectState(f.state.projects, f.project.id, f.project.workspaceId, new Set([f.project.id]), time)).toBe(f.state.projects);
    const removed = purgeProjectState(f.state.projects, f.project.id, f.project.workspaceId, new Set(), time);
    expect(purgeProjectState(removed, f.project.id, f.project.workspaceId, new Set(), '2026-11-05')).toBe(removed);
    expect(() => purgedProjectAudit(f.project, 'invalid')).toThrow('时间');
  });
  it('恢复、移动、再次回收、晚到运行结果均不能复活或改写审计项目', () => {
    const f = fixture(), audit = purgedProjectAudit(f.project, time), list = [audit];
    expect(isActiveProject(audit)).toBe(false); expect(isRecoverableProject(audit)).toBe(false);
    expect(restoreProjectState(list, audit.id, audit.workspaceId)[0]).toBe(audit); expect(moveProjectWorkspace(list, audit.id, 'other')[0]).toBe(audit);
    expect(projectTrashError(audit, audit.workspaceId, new Set())).toContain('永久'); expect(trashProjectState(list, audit.id, audit.workspaceId, new Set(), time)).toBe(list);
    expect(applyLiveProjectState(audit, undefined, 999, 999)).toBe(audit);
    const state = { ...f.state, projects: list }; expect(relocatedWorkspaceState(state, { workspaces: [], projects: [{ projectId: audit.id, workspaceId: 'other', name: audit.name, directory: 'D:/stale' }] }).projects[0]).toBe(audit);
  });
  it('原生审计可覆盖旧活跃快照，重复/旧导入不能把同ID恢复；冲突归属拒绝', () => {
    const f = fixture(), audit = purgedProjectAudit(f.project, time);
    const merged = mergePurgedProjectAudits([f.project], [audit]); expect(merged[0]).toEqual(audit);
    expect(mergePurgedProjectAudits(merged, [{ ...f.project, trashedAt: undefined }])).toBe(merged);
    expect(mergePurgedProjectAudits(merged, [audit])).toBe(merged);
    expect(mergePurgedProjectAudits([], [audit])[0]).toEqual(audit);
    expect(() => mergePurgedProjectAudits([f.project], [{ ...audit, workspaceId: 'foreign' }])).toThrow('归属');
  });
  it('重开合法审计清理残留正文但保持费用，非法时间触发读保护而非覆盖', () => {
    const f = fixture(), stale = { ...f.project, purgedAt: time }, raw = JSON.stringify({ ...f.state, projects: [stale] });
    const source = { getItem: (key: string) => key === WORKSPACE_STORAGE_KEY ? raw : null, setItem: () => { throw Error('No writes during read'); } };
    const loaded = readWorkspaceState(source); expect(loaded.issue).toBeUndefined(); expect(loaded.state.projects[0].description).toBe(''); expect(loaded.state.projects[0].directory).toBeUndefined(); expect(loaded.state.ledger).toEqual(f.ledger);
    const malformed = JSON.parse(raw); malformed.projects[0].purgedAt = 'invalid';
    expect(readWorkspaceState({ ...source, getItem: () => JSON.stringify(malformed) }).issue?.kind).toBe('read');
  });
  it('备份审计合并保留同ID永久状态和费用，且不读取或恢复该项目报价', () => {
    const f = fixture(), audit = purgedProjectAudit(f.project, time), current = { ...f.state, projects: [audit] };
    const imported: BackupImportResult = { backupId: 'backup', receiptPath: 'D:/owned/receipt', idMap: {}, locations: { workspaces: [], projects: [] }, meta: { ...f.state, configuration: initialConfiguration() } };
    const merged = mergeBackupImport(current, initialConfiguration(), imported); expect(merged.state.projects[0]).toBe(audit); expect(merged.state.ledger).toEqual(f.ledger);
    expect(collectQuoteBackups({ getItem: () => { throw Error('Must not read removed project drafts'); } }, [audit])).toEqual([]);
    expect(quoteRestorationWrites(undefined, [audit])).toEqual([]);
    expect(() => quoteRestorationWrites([{ projectId: audit.id, workspaceId: audit.workspaceId, saved: {} as never }], [audit])).toThrow('归属');
  });
});
