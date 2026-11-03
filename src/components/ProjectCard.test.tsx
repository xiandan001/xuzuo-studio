import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectCard, ProjectThumbnail } from './ProjectCard';
import type { Project } from '../types';
import type { WorkflowRunner } from '../configuration-types';
describe('项目封面表达真实项目', () => {
  it('shows real generated images as generated while keeping delivery check semantics explicit', () => {
    const project: Project = { id: 'image', workspaceId: 'w', name: '实际图片', kind: 'image', status: 'review', description: '', updatedAt: '', version: 1, costCents: 0, accent: 'purple' };
    const runner = { runs: [{ id: 'r', projectId: 'image', mode: 'live', status: 'waiting-review', attempts: [{ status: 'complete', artifacts: [{ id: 'file', kind: 'image', mimeType: 'image/png', projectId: 'image', bytes: 100 }] }], snapshot: { steps: [] } }] } as unknown as WorkflowRunner;
    const html = renderToStaticMarkup(<ProjectCard project={project} runner={runner} onOpen={() => undefined} />);
    expect(html).toContain('已生成'); expect(html).toContain('待交付检查'); expect(html).not.toContain('>已完成<');
  });
  it.each(['word', 'ppt', 'excel', 'image'] as const)('%s没有真实缩略图时显示项目名和类型，不虚构业务指标或品牌', kind => {
    const project: Project = { id: `unique-${kind}`, workspaceId: 'w', name: '客户甲的独立创作', kind, status: 'draft', description: '', updatedAt: '', version: 0, costCents: 0, accent: 'purple' };
    const html = renderToStaticMarkup(<ProjectThumbnail project={project} />);
    expect(html).toContain(project.name);
    for (const fake of ['8,640', '86%', 'SHANYE', 'ORANGE', '山野之间', '进行中']) expect(html).not.toContain(fake);
  });
});
