import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { LivePreflight, LiveStartRequest } from '../live-types';

const dependencies = () => ({
  credentials: { list: async () => [{ id: 'credential', connectionId: 'connection', name: '本地测试凭证', enabled: true }] },
  modelRuntime: { supports: () => true },
  artifactStore: { read: async () => { throw new Error('本地测试中不存在此附件'); } },
});
const require = createRequire(import.meta.url);
const { preflight } = require('../../electron/live-validation.cjs') as {
  preflight: (request: LiveStartRequest, options: ReturnType<typeof dependencies>) => Promise<LivePreflight>;
};
const request = (): LiveStartRequest => ({
  project: { id: 'project', workspaceId: 'workspace', name: '定位测试', kind: 'word', description: '', status: 'draft', costCents: 0, version: 0, updatedAt: '', accent: 'blue' },
  workflow: { id: 'workflow', workspaceId: 'workspace', name: '定位测试', description: '', outputKind: 'word', updatedAt: '', steps: [1, 2, 3].map(index => ({
    id: `step-${index}`, name: '相同步骤名', kind: 'text', prompt: '整理内容', modelConfigId: 'model', credentialId: 'credential', inputSource: 'project', maxOutputTokens: 2048, enabled: true,
  })) },
  models: [{ id: 'model', name: '本地测试模型', modelId: 'local-test-model', connectionId: 'connection', capabilities: ['text', 'vision'], enabled: true, pricing: { unit: 'million-tokens', currency: 'CNY', input: '2', output: '8' } }],
  connections: [{ id: 'connection', name: '本地测试连接', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:9000/v1', status: 'configured', enabled: true }],
  input: '这是本地预检测试，不发送模型请求。', variables: {}, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true,
});

describe('预检错误定位', () => {
  it('第三步缺Key时按步骤ID定位，同名步骤不影响定位，兼容错误文字及其余预检结果', async () => {
    const input = request();
    const ready = await preflight(input, dependencies());
    input.workflow.steps[2].credentialId = undefined;
    const result = await preflight(input, dependencies());
    const message = '“相同步骤名”需要选择该连接下启用的 API Key。';
    expect(result.errors).toEqual([message]);
    expect(result.issues).toEqual([{ message, stepId: 'step-3', field: 'credentialId' }]);
    expect(result.steps.map(step => step.id)).toEqual(['step-1', 'step-2', 'step-3']);
    expect(result.warnings).toEqual(ready.warnings);
    expect(result.estimatedCents).toBe(ready.estimatedCents);
    expect(result.unknownCost).toBe(ready.unknownCost);
  });

  it.each([[15, false], [16, true], [16384, true], [16385, false], [16.5, false]] as const)('最大输出%s保持16–16384的整数边界', async (tokens, valid) => {
    const input = request(); input.workflow.steps[2].maxOutputTokens = tokens;
    const result = await preflight(input, dependencies());
    const tokenIssues = result.issues?.filter(issue => issue.field === 'maxOutputTokens');
    expect(result.ok).toBe(valid);
    expect(tokenIssues).toEqual(valid ? [] : [{ message: '“相同步骤名”的最大输出需要在 16 到 16384 Token 之间。', stepId: 'step-3', field: 'maxOutputTokens' }]);
    expect(result.issues?.map(issue => issue.message)).toEqual(result.errors);
  });

  it('在检查处标记模型、提示词、数量、变量和依赖字段，错误消息与issues顺序完全一致', async () => {
    const input = request();
    input.workflow.steps[0].prompt = '{{主题}}'; input.workflow.steps[0].modelConfigId = 'missing-model';
    input.workflow.steps[1].prompt = ''; input.workflow.steps[1].count = 0;
    input.workflow.steps[2].kind = 'vision'; input.workflow.steps[2].inputSource = 'previous';
    const result = await preflight(input, dependencies());
    expect(result.issues).toEqual([
      { message: '“相同步骤名”缺少变量：主题。', stepId: 'step-1', field: 'variables' },
      { message: '“相同步骤名”请选择启用的真实模型和连接。', stepId: 'step-1', field: 'modelConfigId' },
      { message: '“相同步骤名”需要提示词，最多 2 万字。', stepId: 'step-2', field: 'prompt' },
      { message: '“相同步骤名”的生成数量应为 1 到 4。', stepId: 'step-2', field: 'count' },
      { message: '“相同步骤名”需要参考图片，或前一步实际生成的图片。', stepId: 'step-3', field: 'inputSource' },
    ]);
    expect(result.issues?.map(issue => issue.message)).toEqual(result.errors);
  });

  it('全局需求和附件错误不伪造步骤ID，连接错误仍绑定实际步骤', async () => {
    const input = request(); input.input = ''; input.attachmentIds = ['unavailable'];
    input.connections[0].baseUrl = 'https://example.test/v1?secret=invalid';
    const result = await preflight(input, dependencies());
    expect(result.issues?.slice(0, 2)).toEqual([
      { message: '请填写本次需求，最多 10 万字。', field: 'input' },
      { message: '有参考文件已不可用，请重新添加。', field: 'attachments' },
    ]);
    expect(result.issues?.slice(2)).toEqual(['step-1', 'step-2', 'step-3'].map(stepId => ({ message: '相同步骤名：连接地址不能含账号密码或查询参数。', stepId, field: 'connection' })));
    expect(result.issues?.map(issue => issue.message)).toEqual(result.errors);
  });

  it('早返回也包含issues并保留warnings、steps及unknownCost契约', async () => {
    const input = request(); input.project.workspaceId = 'different-workspace';
    expect(await preflight(input, dependencies())).toEqual({
      ok: false, errors: ['项目、工作区或作品类型不匹配。'], issues: [{ message: '项目、工作区或作品类型不匹配。', field: 'project' }], warnings: [], steps: [], unknownCost: true,
    });
    const noSteps = request(); noSteps.workflow.steps = [];
    const result = await preflight(noSteps, dependencies());
    expect(result.issues).toEqual([{ message: '工作流需要 1 到 40 个步骤。' }]);
    expect(result.issues?.map(issue => issue.message)).toEqual(result.errors);
  });
});
