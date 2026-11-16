import { expect, it } from 'vitest';
import type { Project } from '../types';
import type { ChatTargetInspection } from '../chat-types';
import type { ModelConfiguration } from '../configuration-types';
import { artifactRefinementWorkflow } from './artifact-refinement';
import { createRequire } from 'node:module';
const { imageExportSourceError } = createRequire(import.meta.url)('../../electron/image-export-sources.cjs');
const project = { id: 'project', workspaceId: 'workspace', kind: 'word', name: '项目' } as Project;
const target = { projectId: 'project', artifactId: 'saved-docx', sha256: 'a'.repeat(64), kind: 'word' as const, editorRevision: 3 };
const source = JSON.stringify({ kind: 'word', blocks: [{ id: 'stable-block', text: '保留的合同金额 1280 元' }, { id: 'picture', type: 'image', imageId: 'original-picture' }] });
const inspection = { artifact: { id: target.artifactId, projectId: project.id }, sha256: target.sha256, documentSource: source, sourceRevision: 3 } as ChatTargetInspection;
const model = { id: 'model', name: '模型', modelId: 'fixture', enabled: true, capabilities: ['text'] } as ModelConfiguration;
it('refines the exact complete saved source and original illustration IDs, without touching the current draft', () => {
  const request = artifactRefinementWorkflow(project, target, inspection, model, 'key-id', '只把标题改得简洁些');
  expect(request.input).toContain(source); expect(request.attachmentIds).toEqual(['saved-docx', 'original-picture']);
  expect(request.workflow.steps[0].referenceArtifactIds).toEqual(request.attachmentIds);
  expect(request.workflow.steps[1].contentSourceStepId).toBe(request.workflow.steps[0].id);
  expect(request.workflow.sourceArtifactTarget).toEqual({ id: target.artifactId, sha256: target.sha256 });
  expect(inspection.documentSource).toBe(source);
});
it('rejects version drift and source lengths that cannot pass the real admission input limit', () => {
  expect(() => artifactRefinementWorkflow(project, target, { ...inspection, sourceRevision: 4 }, model, 'key', '修改')).toThrow('版本已变化');
  expect(() => artifactRefinementWorkflow(project, target, { ...inspection, documentSource: '字'.repeat(88001) }, model, 'key', '修改')).toThrow('文稿较长');
});
it('passes the actual image delivery source validator without conflicting single and multiple source selectors', () => {
  const imageProject = { ...project, kind: 'image' as const }, imageTarget = { ...target, kind: 'image' as const, editorRevision: undefined };
  const request = artifactRefinementWorkflow(imageProject, imageTarget, { ...inspection, artifact: { ...inspection.artifact, mimeType: 'image/png' } }, { ...model, capabilities: ['image-editing'] }, 'key', '背景改浅灰');
  expect(imageExportSourceError(request.workflow.steps[1], request.workflow, imageProject, new Set())).toBeUndefined();
  expect(request.workflow.steps[1].engineeringReferenceId).toBe(target.artifactId);
});
