import { describe, expect, it } from 'vitest';
import type { WorkflowStep } from '../configuration-types';
import { quickWorkflowTail } from './quick-workflow';

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
