import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../configuration-types';
import { scopedTaskRuns, updateRunVisibility } from './task-visibility';
import { recoverWorkflowRuns } from './workflows';
const run = { id: 'r', status: 'interrupted', attempts: [{ id: 'a', status: 'complete', costCents: 5, artifacts: [{ id: 'image' }] }], snapshot: { steps: [] } } as unknown as WorkflowRun;
describe('任务整理与启动恢复', () => {
  it('只改变显示状态，完整记录仍提供产物和费用', () => {
    const hidden = updateRunVisibility(run, 'hide', 'time');
    expect(scopedTaskRuns([hidden], 'visible')).toEqual([]); expect(scopedTaskRuns([hidden], 'hidden')).toEqual([hidden]);
    expect(hidden.attempts).toBe(run.attempts); expect(run.hiddenAt).toBeUndefined();
    const trash = updateRunVisibility(hidden, 'trash', 'time'); expect(scopedTaskRuns([trash], 'hidden')).toEqual([]); expect(scopedTaskRuns([trash], 'trash')).toEqual([trash]);
    const restored = updateRunVisibility(trash, 'restore', 'time'); expect(scopedTaskRuns([restored], 'visible')).toEqual([restored]); expect(restored.attempts[0].artifacts?.[0].id).toBe('image');
  });
  it('运行、暂停和人工待确认必须先完成或取消', () => {
    for (const status of ['running', 'paused', 'waiting-review'] as const) expect(() => updateRunVisibility({ ...run, status }, 'hide', 'time')).toThrow();
  });
  it('模拟启动也只将真正运行中的任务中断，不自动续跑', () => {
    const states = ['running', 'paused', 'waiting-review'] as const;
    const recovered = recoverWorkflowRuns(states.map(status => ({ ...run, status })));
    expect(recovered.map(item => item.status)).toEqual(['interrupted', 'paused', 'waiting-review']); expect(recovered.every(item => item.attempts[0].costCents === 5)).toBe(true);
  });
});
