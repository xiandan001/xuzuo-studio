import { describe, expect, it } from 'vitest';
import { BEAD_WORKSPACE_NOTICE, compileNaturalAutomationPlan, naturalAutomationRequestIssues } from './natural-automation-plan';
import type { NaturalAutomationPlan } from '../natural-automation-types';
import type { StudioConfiguration } from '../configuration-types';
import type { Project } from '../types';

describe('自然语言拼豆任务进入确定性制图入口', () => {
  it('阻止无参考图的旧直接方案在图片模型上绘制假色号', () => {
    const objective = '做64×64拼豆图纸，要色号采购';
    expect(naturalAutomationRequestIssues(objective)).toContain(BEAD_WORKSPACE_NOTICE);
    const plan = { version: 1, name: '拼豆图纸', objective, outputKind: 'image', trigger: { type: 'manual' }, steps: [{ kind: 'image-generation', name: '绘制图纸', instruction: objective }], illustrations: { mode: 'none', count: 0 }, acceptance: ['真实网格'], constraints: [], maxRepairs: 0, questions: [], unsupported: [] } as NaturalAutomationPlan;
    expect(() => compileNaturalAutomationPlan(plan, {} as Project, {} as StudioConfiguration, {})).toThrow(BEAD_WORKSPACE_NOTICE);
  });
  it('拼豆门店宣传海报和非拼豆壁纸仍走既有制作流程', () => {
    expect(naturalAutomationRequestIssues('制作拼豆门店开业宣传海报')).toEqual([]);
    expect(naturalAutomationRequestIssues('制作4K竖屏风景壁纸')).toEqual([]);
  });
});
