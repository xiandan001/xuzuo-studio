import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { createIdMap, remap } = require('../../electron/backup-format.cjs');

describe('备份只映射实体编号和明确引用', () => {
  it('检查项常量和变量中的id不会成为新实体编号', () => {
    const ids = createIdMap({ controls: { checks: [{ id: 'title', label: 'title', detail: 'paragraph' }], variables: { id: 'text' }, blocks: [{ id: 'paragraph', type: 'paragraph', text: 'text' }], receipts: [{ id: 'receipt-one' }] } });
    expect(ids.paragraph).toBeTruthy(); expect(ids['receipt-one']).toBeTruthy(); expect(ids.title).toBeUndefined(); expect(ids.text).toBeUndefined();
  });
  it('编号恰好等于类型、字段名或正文时，只改白名单引用而保留内容与结构', () => {
    const ids = { paragraph: 'mapped-paragraph', title: 'mapped-title', text: 'mapped-text', 'workspace-one': 'mapped-workspace', 'sheet-one': 'mapped-sheet', 'artifact-one': 'mapped-artifact' };
    const input = { id: 'paragraph', type: 'paragraph', kind: 'text', title: 'title', name: 'paragraph', text: 'artifact-one', prompt: 'text', input: 'title', summary: 'paragraph', status: 'text', modelId: 'text', workspaceId: 'workspace-one', sourceArtifactIds: ['artifact-one'], variables: { title: 'title', id: 'paragraph', 'workspace-one': 'artifact-one' }, checks: [{ id: 'title', label: 'title', detail: 'paragraph', status: 'manual' }], checkedIds: ['title'], preferencesByWorkspace: { 'workspace-one': { studioName: 'title' } }, calculation: { cells: { 'sheet-one': { A1: { status: 'text', value: 'paragraph' } } } }, directory: 'C:\\old\\project', path: 'C:\\old\\project\\artifact-one-source.txt' };
    const result = remap(input, ids, { 'C:\\old': 'D:\\new' }, { 'artifact-one-source.txt': 'mapped-artifact-source.txt' });
    expect(result.id).toBe('mapped-paragraph'); expect(result.workspaceId).toBe('mapped-workspace'); expect(result.sourceArtifactIds).toEqual(['mapped-artifact']);
    for (const name of ['type', 'kind', 'title', 'name', 'text', 'prompt', 'input', 'summary', 'status', 'modelId']) expect(result[name]).toBe(input[name]);
    expect(result.variables).toEqual(input.variables); expect(result.checks).toEqual(input.checks); expect(result.checkedIds).toEqual(input.checkedIds);
    expect(result.preferencesByWorkspace['mapped-workspace']).toEqual({ studioName: 'title' }); expect(result.calculation.cells['mapped-sheet'].A1).toEqual(input.calculation.cells['sheet-one'].A1);
    expect(result.directory).toBe('D:\\new\\project'); expect(result.path).toBe('D:\\new\\project\\mapped-artifact-source.txt'); expect(result['mapped-title']).toBeUndefined();
  });
});


describe('文档多图工作流来源重绑', () => {
  it('标注PNG在配置、运行快照和批次中的标量引用随真实产物ID重绑，不改提示词、变量或费用快照', () => {
    const value = { artifacts: [{ id: 'markup-image', projectId: 'project-one' }], configuration: { workflows: [{ id: 'workflow-one', steps: [{ id: 'step-one', imageMarkupId: 'markup-image', prompt: 'markup-image', imageSvgModel: 'gpt-6.1-sol' }] }] }, run: { snapshot: { steps: [{ imageMarkupId: 'markup-image' }] } }, batch: { workflow: { steps: [{ imageMarkupId: 'markup-image' }] } }, variables: { imageMarkupId: 'markup-image' }, billingRuleSnapshot: { imageMarkupId: 'markup-image' } };
    const ids = createIdMap(value), restored = remap(value, ids);
    expect(restored.artifacts[0].id).toBe(ids['markup-image']);
    expect(restored.configuration.workflows[0].steps[0]).toMatchObject({ imageMarkupId: ids['markup-image'], prompt: 'markup-image', imageSvgModel: 'gpt-6.1-sol' });
    expect(restored.run.snapshot.steps[0].imageMarkupId).toBe(ids['markup-image']);
    expect(restored.batch.workflow.steps[0].imageMarkupId).toBe(ids['markup-image']);
    expect(restored.variables).toEqual(value.variables); expect(restored.billingRuleSnapshot).toEqual(value.billingRuleSnapshot);
    expect(value.configuration.workflows[0].steps[0].imageMarkupId).toBe('markup-image');
  });
  it('逐张图片交付来源数组随备份编号映射，普通提示词和变量保持原值', () => {
    const ids = { first: 'restored-first', second: 'restored-second' };
    const original = { contentSourceStepIds: ['first', 'second'], prompt: 'first', variables: { contentSourceStepIds: ['first'] } };
    expect(remap(original, ids)).toEqual({ contentSourceStepIds: ['restored-first', 'restored-second'], prompt: 'first', variables: { contentSourceStepIds: ['first'] } });
    expect(original.contentSourceStepIds).toEqual(['first', 'second']);
  });
  it('只重绑显式图片step编号，普通正文和变量同名字符串保持不变', () => {
    const ids = { 'image-step': 'restored-image-step' };
    const source = { documentImageStepIds: ['image-step'], prompt: 'image-step', variables: { documentImageStepIds: ['image-step'] } };
    expect(remap(source, ids)).toEqual({ documentImageStepIds: ['restored-image-step'], prompt: 'image-step', variables: { documentImageStepIds: ['image-step'] } });
  });
});
