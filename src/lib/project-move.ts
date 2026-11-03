import type { Project } from '../types';
import type { ProjectLocation } from '../workspace-types';

export type ProjectMoveChanges = Pick<Project, 'name' | 'budgetCents'>;
interface MoveOptions {
  project: Project;
  destination: string;
  changes?: ProjectMoveChanges;
  move: (project: Project, destination: string) => Promise<ProjectLocation | null | undefined>;
  commit: (location: ProjectLocation, changes: Partial<ProjectMoveChanges>) => void;
}

export async function moveProjectWithDraft({ project, destination, changes, move, commit }: MoveOptions): Promise<boolean> {
  const draft: Partial<ProjectMoveChanges> = {};
  if (changes) {
    const name = changes.name.trim();
    if (!name || name.length > 100) throw new Error('项目名称需为 1–100 个字符。');
    if (changes.budgetCents !== undefined && (!Number.isSafeInteger(changes.budgetCents) || changes.budgetCents < 0)) throw new Error('请填写有效金额上限或留空。');
    draft.name = name; draft.budgetCents = changes.budgetCents;
  }
  const location = await move({ ...project, ...draft }, destination);
  if (location === null) return false;
  if (!location) throw new Error('请在桌面应用中移动项目文件，当前修改尚未提交。');
  commit(location, draft);
  return true;
}
