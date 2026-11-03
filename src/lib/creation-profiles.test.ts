import { describe, expect, it } from 'vitest';
import type { WorkflowDefinition, WorkflowStep } from '../configuration-types';
import { creationPrompt, withCreationFoundation } from './creation-quality';
import { CREATION_PROFILES } from './creation-profiles';
const step = (id: string, kind: WorkflowStep['kind'], prompt: string): WorkflowStep => ({ id, name: id, kind, prompt, enabled: true, inputSource: 'previous' });
const workflow = (steps: WorkflowStep[], outputKind: WorkflowDefinition['outputKind'] = 'word') => ({ id: 'fixture', workspaceId: 'fixture', name: 'fixture', outputKind, steps }) as WorkflowDefinition;

describe('按作品类型分层的内置创作规范', () => {
  it('完整稿基础规范先于独立用户需求，保留用户事实和短篇要求', () => {
    const user = '为清禾写一封100字邮件，预算80元，不增加数字。';
    const prompt = creationPrompt('word', user);
    expect(prompt.indexOf('商业文档主笔')).toBeLessThan(prompt.indexOf('【用户本次要求】'));
    expect(prompt.endsWith(user)).toBe(true);
    expect(prompt).toContain('1800–3000'); expect(prompt).toContain('用户要求短文');
    expect(prompt).toContain('missingInputs'); expect(creationPrompt('word', prompt)).toBe(prompt);
  });
  it('PPT逐页正文与讲解分离，表格明细不抽样且公式有明确协议', () => {
    expect(creationPrompt('ppt', '汇报')).toContain('10–12');
    expect(creationPrompt('ppt', '汇报')).toContain('80–160');
    const excel = creationPrompt('excel', '订单统计');
    expect(excel).toContain('不抽样'); expect(excel).toContain('逐行保留');
    expect(excel).toContain('IF'); expect(excel).toContain('普通文字');
    expect(CREATION_PROFILES.word.outputTokens).toBeGreaterThan(4096);
  });
  it('只给实际成品步骤加基础规范，不重写准备步骤或显式复核报告', () => {
    const draft = workflow([step('资料整理', 'text', '提取事实'), step('成品', 'text', '形成交付说明'), step('交付', 'export', '')]);
    const result = withCreationFoundation(draft);
    expect(result.steps[0].prompt).toBe('提取事实'); expect(result.steps[1].prompt).toContain('商业文档主笔'); expect(draft.steps[1].prompt).toBe('形成交付说明');
    expect(withCreationFoundation(result)).toEqual(result);
    const review = withCreationFoundation(workflow([step('检查报告', 'text', '只列出需核实项')]));
    expect(review.steps[0].prompt).toBe('只列出需核实项');
  });
  it('显式导出来源优先，PPT配图不会收到PPT JSON约束，图像复核不混入生图规范', () => {
    const draft = workflow([step('正文', 'text', '方案'), step('校核', 'text', '核对事实'), { ...step('交付', 'export', ''), contentSourceStepId: '正文' }]);
    expect(withCreationFoundation(draft).steps[0].prompt).toContain('商业文档主笔');
    expect(withCreationFoundation(draft).steps[1].prompt).toBe('核对事实');
    const image = withCreationFoundation(workflow([step('配图', 'image-generation', '茶饮主视觉')], 'ppt')).steps[0].prompt;
    expect(image).toContain('视觉策划'); expect(image).not.toContain('"slides"');
    const review = creationPrompt('image', '检查错字', 'vision'); expect(review).not.toContain('制作可供'); expect(review).toContain('无法核实');
  });
});
