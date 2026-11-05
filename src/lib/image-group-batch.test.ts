import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { StudioConfiguration } from '../configuration-types';
import type { Project } from '../types';
import { createImageGroupBatch, imageGroupRowIssue, initialImageGroupDraft, readImageGroupDraft, IMAGE_GROUP_IMAGE_LIMIT, IMAGE_GROUP_LIMIT, IMAGE_GROUP_TOTAL_LIMIT } from './image-group-batch';
const require = createRequire(import.meta.url), backend = require('../../electron/image-group-batch.cjs');
const project = { id: 'project', workspaceId: 'workspace', name: '产品图片', accent: 'blue', kind: 'image', description: 'PRIVATE-PROMPT-MUST-NOT-COPY', budgetCents: 0, referenceFiles: [{ id: 'private-reference' }] } as Project;
const model = { id: 'image', connectionId: 'connection', enabled: true, capabilities: ['image-generation'], name: '生成模型' } as StudioConfiguration['models'][number];
const props = { workspaceId: 'workspace', configuration: { models: [model], credentials: [{ id: 'key', connectionId: 'connection', enabled: true }], connections: [{ id: 'connection', enabled: true }] } as unknown as StudioConfiguration };
describe('图片工作台独立分组配置', () => {
  it('独立描述/2+3数量和生成账号/规格进入真实batch请求，没有参考图或编辑能力', () => {
    const draft = initialImageGroupDraft(project); draft.groups[0].brief = '蓝色产品'; draft.groups[0].count = '2'; draft.groups[1] = { ...draft.groups[1], brief: '红色产品', count: '3' }; const before = structuredClone(draft);
    const request = createImageGroupBatch(draft, { model, credentialId: 'key', size: '1536x1024', background: 'opaque' }, props);
    expect(request.imageGroupCounts).toEqual([2, 3]); expect(request.rows.map(row => row.需求)).toEqual(['蓝色产品', '红色产品']); expect(request.request.attachmentIds).toEqual([]); expect(request.request.project.budgetCents).toBeUndefined(); expect(JSON.stringify(request)).not.toContain('PRIVATE-PROMPT-MUST-NOT-COPY'); expect(request.request.workflow.steps[0]).toMatchObject({ kind: 'image-generation', credentialId: 'key', modelConfigId: 'image', count: 1, imageSize: '1536x1024', imageBackground: 'opaque' }); expect(request.request.workflow.steps).toHaveLength(2); expect(draft).toEqual(before);
  });
  it('前后端数量边界一致，空/分数/过大组在付费之前拒绝', () => {
    expect([IMAGE_GROUP_LIMIT, IMAGE_GROUP_IMAGE_LIMIT, IMAGE_GROUP_TOTAL_LIMIT]).toEqual([backend.MAX_GROUPS, backend.MAX_GROUP_IMAGES, backend.MAX_TOTAL_IMAGES]); const row = { ...initialImageGroupDraft(project).groups[0], brief: '描述' }; for (const count of ['', '0', '1.5', '21']) expect(imageGroupRowIssue({ ...row, count })).toBeTruthy();
    const draft = initialImageGroupDraft(project); draft.groups = Array.from({ length: 26 }, (_, index) => ({ ...row, id: String(index), count: '20' })); expect(() => createImageGroupBatch(draft, { model, credentialId: 'key', size: '1024x1024', background: 'auto' }, props)).toThrow('500张');
  });
  it('已停用或错连接Key不自动换账户，草稿可读恢复且不静默改写坏记录', () => {
    const draft = initialImageGroupDraft(project); draft.groups[0].brief = '描述'; draft.groups.pop(); expect(() => createImageGroupBatch(draft, { model, credentialId: 'wrong', size: '1024x1024', background: 'auto' }, props)).toThrow('Key'); expect(readImageGroupDraft(JSON.stringify(draft), initialImageGroupDraft(project))).toEqual(draft); expect(() => readImageGroupDraft('{broken', draft)).toThrow();
  });
});
