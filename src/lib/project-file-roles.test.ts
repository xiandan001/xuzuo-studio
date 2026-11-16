import { describe, expect, it } from 'vitest';
import type { ArtifactMetadata } from '../live-types';
import { projectCurrentFiles } from './project-file-roles';

const file = (id: string, name: string, createdAt: string, kind = 'office', mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') => ({ id, name, createdAt, kind, mimeType, bytes: 100, projectId: 'p' }) as ArtifactMetadata;
describe('项目概览不混淆原图、导出和采用版本', () => {
  const files = [file('old', '旧版.docx', '2026-11-10'), file('new', '新版.docx', '2026-11-12'), file('source', 'result.txt', '2026-11-13', 'text', 'text/plain')];
  it('制作单采用版本优先，最新编辑/导出不自动改变客户采用', () => expect(projectCurrentFiles(files, 'word', ['old']).map(row => row.id)).toEqual(['old']));
  it('没有制作单时只取真实Office最新导出，不把TXT作为成品', () => expect(projectCurrentFiles(files, 'word', []).map(row => row.id)).toEqual(['new']));
  it('采用文件丢失时不悄悄换成另一版，参考图片不会自动成为采用成品', () => {
    expect(projectCurrentFiles(files.filter(row => row.id !== 'old'), 'word', ['old'])).toEqual([]);
    const picture = file('reference', '参考.png', '2026-11-12', 'image', 'image/png');
    expect(projectCurrentFiles([picture], 'image', [])).toEqual([]);
    expect(projectCurrentFiles([picture], 'image', [], ['reference']).map(row => row.id)).toEqual(['reference']);
  });
});
