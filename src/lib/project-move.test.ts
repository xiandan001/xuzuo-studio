import { describe, expect, it, vi } from 'vitest';
import type { Project } from '../types';
import { moveProjectWithDraft } from './project-move';
const project: Project = { id: 'project', workspaceId: 'source', name: '原名称', description: '', kind: 'word', status: 'draft', costCents: 17, version: 2, accent: 'purple', updatedAt: '', budgetCents: 500 };
const location = { projectId: project.id, workspaceId: 'target', directory: 'C:/fixture/target', name: '新名称' };
describe('项目移动后才提交编辑草稿', () => {
  it('native操作结束之前不提交，成功一次提交名字/取消预算且保留源对象', async () => {
    let finish!: (value: typeof location) => void;
    const commit = vi.fn(), move = vi.fn((_project: Project, _destination: string) => new Promise<typeof location>(resolve => { finish = resolve; }));
    const pending = moveProjectWithDraft({ project, destination: 'target', changes: { name: ' 新名称 ', budgetCents: undefined }, move, commit });
    expect(commit).not.toHaveBeenCalled(); expect(project.name).toBe('原名称'); expect(project.costCents).toBe(17);
    expect(move.mock.calls[0][0]).toMatchObject({ name: '新名称', costCents: 17, version: 2 });
    finish(location); expect(await pending).toBe(true);
    expect(commit).toHaveBeenCalledExactlyOnceWith(location, { name: '新名称', budgetCents: undefined });
    expect(project.budgetCents).toBe(500);
  });
  it('取消、失败和浏览器无真实目录结果均不部分提交metadata', async () => {
    const commit = vi.fn();
    expect(await moveProjectWithDraft({ project, destination: 'target', changes: { name: '新名称', budgetCents: 0 }, move: async () => null, commit })).toBe(false);
    await expect(moveProjectWithDraft({ project, destination: 'target', changes: { name: '新名称', budgetCents: 0 }, move: async () => { throw Error('目录不可写'); }, commit })).rejects.toThrow('目录不可写');
    await expect(moveProjectWithDraft({ project, destination: 'target', move: async () => undefined, commit })).rejects.toThrow('桌面应用');
    expect(commit).not.toHaveBeenCalled(); expect(project.name).toBe('原名称'); expect(project.budgetCents).toBe(500);
  });
  it('非法草稿在任何文件操作之前拒绝，不隐式改变其他项目字段', async () => {
    const move = vi.fn(), commit = vi.fn();
    for (const changes of [{ name: ' ', budgetCents: 0 }, { name: '名称', budgetCents: -1 }, { name: '名称', budgetCents: 0.5 }]) await expect(moveProjectWithDraft({ project, destination: 'target', changes, move, commit })).rejects.toThrow();
    expect(move).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });
});
