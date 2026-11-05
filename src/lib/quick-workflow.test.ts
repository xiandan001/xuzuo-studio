import { describe, expect, it } from 'vitest';
import type { WorkflowStep } from '../configuration-types';
import { quickImageWorkflowBudget, quickImageWorkflowSteps, quickImageWorkflowTail, quickWorkflowTail } from './quick-workflow';

const original = (): WorkflowStep[] => [
  { id: 'review-original', name: '人工检查实际结果', kind: 'manual-review', prompt: '', inputSource: 'previous', enabled: true },
  { id: 'export-original', name: '生成实际交付文件', kind: 'export', prompt: '', inputSource: 'previous', budgetCents: undefined, enabled: true },
];

describe('快捷文档先生成正式文件再检查', () => {
  it.each(['word', 'ppt', 'excel'] as const)('%s新建与精修均先本地导出，保留人工验收', kind => {
    for (const action of ['初次生成', '重新生成', 'AI 精修'] as const) {
      const tail = quickWorkflowTail(kind, 'text', action);
      expect(tail.map(step => step.kind)).toEqual(['export', 'manual-review']);
      expect(tail.every(step => step.enabled && step.inputSource === 'previous' && step.prompt === '' && step.budgetCents === undefined)).toBe(true);
      expect(tail[0].id).not.toBe(tail[1].id);
    }
  });

  it.each(['word', 'ppt', 'excel'] as const)('%s精确旧默认只换顺序，保留ID及对象，不改变旧定义', kind => {
    const tail = original(), before = structuredClone(tail), reordered = quickWorkflowTail(kind, 'text', '初次生成', tail);
    expect(reordered).toEqual([tail[1], tail[0]]);
    expect(reordered[0]).toBe(tail[1]); expect(reordered[1]).toBe(tail[0]); expect(tail).toEqual(before);
    expect(quickWorkflowTail(kind, 'text', '初次生成', reordered)).toBe(reordered);
  });

  it('停用、修改名称/参数/输入/提示词或增加步骤均保留用户流程', () => {
    const variants: WorkflowStep[][] = [
      original().map((step, index) => index === 0 ? { ...step, enabled: false } : step),
      original().map((step, index) => index === 1 ? { ...step, name: '我的交付步骤' } : step),
      original().map((step, index) => index === 1 ? { ...step, budgetCents: 0 } : step),
      original().map((step, index) => index === 1 ? { ...step, contentSourceStepId: 'other-source' } : step),
      original().map((step, index) => index === 1 ? { ...step, inputSource: 'project' } : step),
      original().map((step, index) => index === 0 ? { ...step, prompt: '我的检查标准' } : step),
      [...original(), { id: 'extra', name: '额外检查', kind: 'manual-review', prompt: '', inputSource: 'previous', enabled: true }],
      [],
    ];
    for (const tail of variants) expect(quickWorkflowTail('word', 'text', '初次生成', tail)).toBe(tail);
  });

  it('图片、文字检查和非文本能力继续原规则，检查不会自行增加Office导出', () => {
    expect(quickWorkflowTail('image', 'image-generation', '初次生成').map(step => step.kind)).toEqual(['manual-review', 'export']);
    expect(quickWorkflowTail('image', 'image-editing', 'AI 精修').map(step => step.kind)).toEqual(['manual-review', 'export']);
    expect(quickWorkflowTail('image', 'text', '初次生成').map(step => step.kind)).toEqual(['manual-review']);
    expect(quickWorkflowTail('word', 'text', 'AI 复核').map(step => step.kind)).toEqual(['manual-review']);
    expect(quickWorkflowTail('word', 'vision', 'AI 复核').map(step => step.kind)).toEqual(['manual-review']);
    for (const [kind, capability, action] of [['image', 'image-generation', '初次生成'], ['word', 'vision', 'AI 复核'], ['word', 'text', 'AI 复核']] as const) {
      const tail = original(); expect(quickWorkflowTail(kind, capability, action, tail)).toBe(tail);
    }
  });
});

describe('图片工作台自定义数量逐张执行', () => {
  const image = (count: number, kind: 'image-generation' | 'image-editing' = 'image-generation'): WorkflowStep => ({ id: 'original-image', name: '初次生成', kind, prompt: '用户完整需求', inputSource: 'project', enabled: true, modelConfigId: 'image-model', credentialId: 'image-key', count, imageSize: '1536x1024', imageBackground: 'transparent', budgetCents: 123 });

  it.each(['image-generation', 'image-editing'] as const)('%s的3/7/20张均拆成同配置、原始项目输入的单张步骤与完整导出来源', kind => {
    for (const count of [3, 7, 20]) {
      const first = image(count, kind), tail = original(), before = structuredClone({ first, tail });
      const steps = quickImageWorkflowSteps(first, tail), pictures = steps.filter(step => step.kind === kind);
      expect(pictures).toHaveLength(count); expect(new Set(steps.map(step => step.id)).size).toBe(steps.length);
      expect(pictures[0].id).toBe(first.id);
      pictures.forEach((step, index) => {
        expect(step).toMatchObject({ kind, count: 1, inputSource: 'project', modelConfigId: 'image-model', credentialId: 'image-key', imageSize: '1536x1024', imageBackground: 'transparent' });
        expect(step.prompt).toContain('用户完整需求'); expect(step.prompt).toContain(`第${index + 1}张`);
      });
      expect(steps.at(-1)?.contentSourceStepIds).toEqual(pictures.map(step => step.id));
      expect(pictures.reduce((sum, step) => sum + step.budgetCents!, 0)).toBe(123);
      expect(Math.max(...pictures.map(step => step.budgetCents!)) - Math.min(...pictures.map(step => step.budgetCents!))).toBeLessThanOrEqual(1);
      expect(steps.at(-2)).toBe(tail[0]); expect({ first, tail }).toEqual(before);
    }
  });

  it('一张及非图片能力完全保留原步骤对象、提示词和尾部', () => {
    const first = image(1), tail = original(), steps = quickImageWorkflowSteps(first, tail);
    expect(steps).toEqual([first, ...tail]); expect(steps[0]).toBe(first); expect(steps[2]).toBe(tail[1]);
    const text = { ...first, kind: 'text' as const, count: 7 };
    expect(quickImageWorkflowSteps(text, tail)).toEqual([text, ...tail]);
  });

  it('数量7改3再改1只替换自身变体，保留用户新增尾部且不重复旧张数', () => {
    const custom = { ...image(1), id: 'my-image', name: '用户自定义后续步骤' }, tail = [...original(), custom];
    const seven = quickImageWorkflowSteps(image(7), tail);
    const three = quickImageWorkflowSteps(image(3), quickImageWorkflowTail(seven)!);
    expect(three.filter(step => step.kind === 'image-generation')).toHaveLength(4);
    expect(three.at(-1)).toBe(custom);
    const one = quickImageWorkflowSteps(image(1), quickImageWorkflowTail(three)!);
    expect(one.filter(step => step.kind === 'image-generation')).toEqual([image(1), custom]);
    expect(one.find(step => step.kind === 'export')?.contentSourceStepIds).toEqual(['original-image']);
    expect(quickImageWorkflowTail(undefined)).toBeUndefined();
    const text = [{ ...image(7), kind: 'text' as const }, ...tail];
    expect(quickImageWorkflowTail(text)).toEqual(tail);
  });

  it('不覆盖用户自定义交付来源或尾部参数', () => {
    const tail = original().map(step => step.kind === 'export' ? { ...step, contentSourceStepId: 'user-source' } : step);
    expect(quickImageWorkflowSteps(image(7), tail).at(-1)).toBe(tail[1]);
  });

  it('按实际App派工7改3改1始终保留原总上限123，仅汇总自身变体而非用户尾部', () => {
    const custom = { ...image(1), id: 'user-extra', budgetCents: 999 };
    let previous = quickImageWorkflowSteps(image(7), [...original(), custom]);
    for (const count of [3, 1, 7]) {
      expect(quickImageWorkflowBudget(previous)).toBe(123);
      previous = quickImageWorkflowSteps({ ...image(count), budgetCents: quickImageWorkflowBudget(previous) }, quickImageWorkflowTail(previous)!);
      expect(quickImageWorkflowBudget(previous)).toBe(123);
      expect(previous.at(-1)).toBe(custom);
    }
    expect(quickImageWorkflowBudget(undefined)).toBeUndefined();
    expect(quickImageWorkflowBudget([image(1)])).toBe(123);
    expect(quickImageWorkflowBudget([{ ...image(1), kind: 'text' }])).toBe(123);
    const noCap = quickImageWorkflowSteps({ ...image(3), budgetCents: undefined }, original()); expect(quickImageWorkflowBudget(noCap)).toBeUndefined();
    noCap[0].budgetCents = 12; expect(quickImageWorkflowBudget(noCap)).toBeUndefined();
    expect(quickImageWorkflowBudget(quickImageWorkflowSteps({ ...image(3), budgetCents: 0 }, original()))).toBe(0);
  });

  it.each([0, 21, 1.5, NaN, Infinity])('非法数量%s在保存或执行前明确拒绝', count => {
    expect(() => quickImageWorkflowSteps(image(count), original())).toThrow('1–20');
  });
});
