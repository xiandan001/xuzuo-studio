import { describe, expect, it } from 'vitest';
import type { ProjectTemplateResult } from '../project-template-types';
import { projectTemplateImageDraft } from './project-template-image';
const result: ProjectTemplateResult = { projectId: 'target', artifacts: [], imageSettings: { width: 1080, height: 1920, mimeType: 'image/png' } };
describe('图片模板直接进入创作', () => {
  it('selects the nearest supported orientation with empty client content and account bindings', () => { const draft = projectTemplateImageDraft(result, false); expect(draft.size).toBe('1024x1536'); expect(draft.prompt).toBe(''); expect(draft.references).toEqual([]); expect(draft.generationModelId).toBe(''); expect(draft.editingModelId).toBe(''); });
  it('only places an explicitly copied local still image into refine mode; GIF is never passed as an editing reference', () => { const image = { id: 'copy', projectId: 'target', name: 'copy.png', kind: 'image', mimeType: 'image/png', bytes: 12, path: 'managed', createdAt: '' } as const; const draft = projectTemplateImageDraft({ ...result, artifacts: [image] }, true); expect(draft.mode).toBe('refine'); expect(draft.references[0].id).toBe('copy'); expect(projectTemplateImageDraft({ ...result, artifacts: [{ ...image, mimeType: 'image/gif' }] }, true).references).toEqual([]); expect(projectTemplateImageDraft({ ...result, artifacts: [{ ...image, projectId: 'foreign' }] }, true).references).toEqual([]); });
});
