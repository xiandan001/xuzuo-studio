import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PageProps } from '../types';
import type { WorkflowDefinition, WorkflowStep } from '../configuration-types';
import { blankWorkflow, exampleWorkflow, switchNewWorkflowOutput, WorkflowEditor } from '../pages/Workflows';
import { StudioConnectionFields } from './StudioConnectionFields';
import { workflowImageIssue } from './WorkflowEditor';

const props = {
  workspaceId: 'workspace', workspace: { id: 'workspace', name: '隔离测试工作区' }, prompts: [],
  configuration: { categories: [], models: [{ id: 'text-model', name: '测试文本模型', modelId: 'fake-text', connectionId: 'connection', capabilities: ['text'], enabled: true, pricing: { unit: 'million-tokens', currency: 'CNY', input: '1', output: '1' } }, { id: 'image-model', name: '测试生图模型', modelId: 'fake-image', connectionId: 'connection', capabilities: ['image-generation'], enabled: true, pricing: { unit: 'image', currency: 'CNY', input: '', output: '1' } }], connections: [{ id: 'connection', enabled: true, providerId: 'custom', protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:9999' }], credentials: [{ id: 'key-one', connectionId: 'connection', enabled: true, name: '本机测试凭证', lastFour: 'TEST' }], saveWorkflow: () => true },
} as unknown as PageProps;
const step = (id: string, name: string): WorkflowStep => ({ id, name, kind: 'text', prompt: '只处理已提供内容', inputSource: id === 'first' ? 'project' : 'previous', enabled: true, maxOutputTokens: 2048 });
describe('工作流配置和错误修复视图', () => {
  it('图片步骤复用高级格式控件，SVG多张显示错误但不改原数量', () => {
    const imageProps = { ...props, configuration: { ...props.configuration, models: props.configuration.models.map(model => model.id === 'image-model' ? { ...model, modelId: 'gpt-image-2.6-sunburst' } : model) } };
    const image: WorkflowStep = { ...step('first', 'SVG制作'), kind: 'image-generation', modelConfigId: 'image-model', credentialId: 'key-one', count: 2, imageOutputFormat: 'svg', imageQuality: 'max', imageComplexity: 'high' };
    const html = renderToStaticMarkup(<WorkflowEditor props={imageProps} initial={{ name: 'SVG流程', description: '', outputKind: 'image', steps: [image] }} onClose={() => undefined} />);
    expect(html).toContain('图片输出格式'); expect(html).toContain('SVG 矢量图'); expect(html).toContain('SVG 作者模型'); expect(html).toContain('图片渲染质量'); expect(html).toContain('图片规划复杂度');
    expect(html).toContain('单次SVG步骤仅支持1张'); expect(image.count).toBe(2);
    expect(workflowImageIssue(image, 'gpt-image-2.6-sunburst')).toContain('数量改为1');
    expect(workflowImageIssue({ ...image, count: 1 }, 'gpt-image-2.6-sunburst')).toBeUndefined();
  });
  it('2.5精修说明SVG/GIF不可用，圈画入口禁用并解释须回图片工作台选择原图', () => {
    const imageProps = { ...props, configuration: { ...props.configuration, models: props.configuration.models.map(model => model.id === 'image-model' ? { ...model, modelId: 'gpt-image-2.5-flare', capabilities: ['image-editing' as const] } : model) } };
    const image: WorkflowStep = { ...step('first', '精修'), kind: 'image-editing', modelConfigId: 'image-model', credentialId: 'key-one' };
    const html = renderToStaticMarkup(<WorkflowEditor props={imageProps} initial={{ name: '精修流程', description: '', outputKind: 'image', steps: [image] }} onClose={() => undefined} />);
    expect(html).toContain('SVG、GIF 仅 GPT Image 2.6 可用'); expect(html).toContain('圈画需在图片工作台选择原图后操作'); expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?圈画修改位置/);
  });
  it('GIF显示帧数、时长及自动尺寸约束，保留数量并拒绝其他型号', () => {
    const image: WorkflowStep = { ...step('first', '动图'), kind: 'image-generation', modelConfigId: 'image-model', credentialId: 'key-one', imageOutputFormat: 'gif', imageFrameCount: 9, imageFrameDurationMs: 205, imageSize: 'auto', count: 4 };
    const imageProps = { ...props, configuration: { ...props.configuration, models: props.configuration.models.map(model => model.id === 'image-model' ? { ...model, modelId: 'gpt-image-2.6-flare' } : model) } };
    const html = renderToStaticMarkup(<WorkflowEditor props={imageProps} initial={{ name: 'GIF流程', description: '', outputKind: 'image', steps: [image] }} onClose={() => undefined} />);
    expect(html).toContain('GIF动画帧数'); expect(html).toContain('GIF每帧时长'); expect(html).toContain('数量表示动画份数');
    expect(workflowImageIssue(image, 'gpt-image-2.6-flare')).toBeUndefined(); expect(image.count).toBe(4);
    expect(workflowImageIssue(image, 'gpt-image-2.5-flare')).toContain('仅支持 GPT Image 2.6');
    expect(workflowImageIssue({ ...image, imageSize: '1024x1024' }, 'gpt-image-2.6-flare')).toContain('帧尺寸请选择自动');
  });
  it('2.6静态参考图精修可输出GIF，界面区分本应用动图与外部GIF', () => {
    const image: WorkflowStep = { ...step('first', '参考图动效'), kind: 'image-editing', modelConfigId: 'image-model', credentialId: 'key-one', imageOutputFormat: 'gif', imageFrameCount: 6, imageFrameDurationMs: 200, imageSize: 'auto', count: 1 };
    const imageProps = { ...props, configuration: { ...props.configuration, models: props.configuration.models.map(model => model.id === 'image-model' ? { ...model, modelId: 'gpt-image-2.6-sunburst', capabilities: ['image-editing' as const] } : model) } };
    const html = renderToStaticMarkup(<WorkflowEditor props={imageProps} initial={{ name: 'GIF精修', description: '', outputKind: 'image', steps: [image] }} onClose={() => undefined} />);
    expect(workflowImageIssue(image, 'gpt-image-2.6-sunburst')).toBeUndefined();
    expect(html).toContain('静态参考图制作 GIF'); expect(html).toContain('本应用动图可继续修改'); expect(html).toContain('外部 GIF 暂不支持直接编辑'); expect(html).toContain('SVG 仍仅支持文字生成');
    expect(html).not.toContain('精修及带参考图生成仅支持 PNG');
  });
  it('第三步错误可直接打开第三步，最大输出范围与执行端一致', () => {
    const initial = { name: '三步测试', description: '', outputKind: 'word' as const, steps: [step('first', '第一步'), step('second', '第二步'), step('third', '第三步')] };
    const html = renderToStaticMarkup(<WorkflowEditor props={props} initial={initial} initialStepId="third" initialField="maxOutputTokens" onClose={() => undefined} />);
    expect(html).toContain('第 3 步'); expect(html).toContain('min="16"'); expect(html).toContain('max="16384"'); expect(html).toContain('高级参数'); expect(html).toContain('本机测试凭证'); expect(html).not.toContain('<select');
  });
  it('新建图片工作台功能预设图片类型与唯一可用模型和Key', () => {
    const draft = blankWorkflow(props, 'image');
    expect(draft.outputKind).toBe('image'); expect(draft.steps[0]).toMatchObject({ kind: 'image-generation', modelConfigId: 'image-model', credentialId: 'key-one', inputSource: 'project' });
    expect(draft.steps).toHaveLength(1);
  });
  it.each(['word', 'ppt', 'excel'] as const)('新建%s流程默认先导出真实Office再检查，正文来源绑定首个文字步骤', outputKind => {
    const draft = blankWorkflow(props, outputKind);
    expect(draft.outputKind).toBe(outputKind);
    expect(draft.steps.map(item => item.kind)).toEqual(['text', 'export', 'manual-review']);
    expect(draft.steps[0]).toMatchObject({ modelConfigId: 'text-model', credentialId: 'key-one', inputSource: 'project', prompt: '' });
    expect(draft.steps[1]).toMatchObject({ inputSource: 'previous', contentSourceStepId: draft.steps[0].id, enabled: true });
    expect(draft.steps[2]).toMatchObject({ inputSource: 'previous', enabled: true });
  });
  it('未填写步骤的新建流程可从PPT切图片再切Word，并保留名称、说明与业务分类', () => {
    const draft = { ...blankWorkflow(props, 'ppt'), name: '我的制作流程', description: '重复使用', businessCategoryId: 'category' };
    const image = switchNewWorkflowOutput(props, draft, 'image', true);
    expect(image.steps).toHaveLength(1); expect(image.steps[0]).toMatchObject({ kind: 'image-generation', modelConfigId: 'image-model', credentialId: 'key-one' });
    const word = switchNewWorkflowOutput(props, image, 'word', true);
    expect(word).toMatchObject({ outputKind: 'word', name: draft.name, description: draft.description, businessCategoryId: draft.businessCategoryId });
    expect(word.steps.map(step => step.kind)).toEqual(['text', 'export', 'manual-review']);
    expect(word.steps[1].contentSourceStepId).toBe(word.steps[0].id);
  });
  it('已有编辑或手动修改过的步骤不随类型切换重建；已写提示词和自定义结构也保留', () => {
    const original = blankWorkflow(props, 'ppt');
    expect(switchNewWorkflowOutput(props, original, 'image', false).steps).toBe(original.steps);
    const entered = { ...original, steps: original.steps.map((step, index) => index === 0 ? { ...step, prompt: '已填写的用户要求' } : step) };
    expect(switchNewWorkflowOutput(props, entered, 'image', true).steps).toBe(entered.steps);
    const custom = { ...original, steps: [{ ...original.steps[0], name: '我修改过的步骤' }, ...original.steps.slice(1)] };
    expect(switchNewWorkflowOutput(props, custom, 'word', true).steps).toBe(custom.steps);
  });
  it('图文演示示例先生成图，再写正文并指定图片来源，导出后才人工检查', () => {
    const draft = exampleWorkflow('document', props);
    expect(draft.steps.map(item => item.kind)).toEqual(['image-generation', 'text', 'export', 'manual-review']);
    expect(draft.steps[1]).toMatchObject({ inputSource: 'project', documentImageSource: 'previous' });
    expect(draft.steps[2].contentSourceStepId).toBe(draft.steps[1].id);
    expect(draft.steps[0].prompt).not.toContain('{{'); expect(draft.steps[1].prompt).not.toContain('{{');
    const html = renderToStaticMarkup(<WorkflowEditor props={props} initial={draft} initialStepId={draft.steps[1].id} onClose={() => undefined} />);
    expect(html).toContain('文档插图来源'); expect(html).toContain('本地自动排版并嵌入实际图片');
  });
  it('完整配置折叠为摘要；缺凭证自动展开，仍保留手动调整入口', () => {
    const workflow: WorkflowDefinition = { id: 'flow', workspaceId: 'workspace', name: '已配置流程', description: '', outputKind: 'word', updatedAt: '', steps: [{ ...step('first', '撰写'), modelConfigId: 'text-model', credentialId: 'key-one' }] };
    const html = renderToStaticMarkup(<StudioConnectionFields props={props} workflow={workflow} disabled={false} simulation={false} onChange={() => undefined} />);
    expect(html).toContain('调用设置已就绪'); expect(html).toContain('展开调整'); expect(html).not.toContain('<details class="wf-run-configuration-summary" open');
    const missing = renderToStaticMarkup(<StudioConnectionFields props={props} workflow={{ ...workflow, steps: [{ ...workflow.steps[0], credentialId: undefined }] }} disabled={false} simulation={false} onChange={() => undefined} />);
    expect(missing).toContain('补全本次模型与 Key'); expect(missing).toContain('open=""');
  });
});
