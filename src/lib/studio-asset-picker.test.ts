import { describe, expect, it } from 'vitest';
import type { StudioAsset } from '../asset-types';
import { studioAssetCandidates, studioAssetImageUrl } from './studio-asset-picker';
const item = (id: string, patch: Partial<StudioAsset> = {}): StudioAsset => ({ id, workspaceId: 'one', name: `${id}.png`, kind: 'image', mimeType: 'image/png', bytes: 40, createdAt: '', favorite: false, ...patch });
describe('工作台素材选择范围', () => {
  it('图片模式只列当前工作区未归档支持图片，未丢不可用标记供界面解释', () => {
    const values = [item('good'), item('missing', { unavailable: true }), item('archived', { archivedAt: 'now' }), item('foreign', { workspaceId: 'two' }), item('notes', { kind: 'text', mimeType: 'text/plain' }), item('vector', { mimeType: 'image/svg+xml' })];
    expect(studioAssetCandidates(values, 'one', true, '', 'all', {}).map(asset => asset.id)).toEqual(['good', 'missing']);
    expect(values[2].archivedAt).toBe('now');
  });
  it('参考资料模式保留Office/文字；搜索与自定义分类叠加并允许未分类', () => {
    const values = [item('a', { name: '品牌资料.docx', kind: 'office', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), item('b'), item('c', { categoryId: 'stored-category' })];
    expect(studioAssetCandidates(values, 'one', false, '品牌', 'business', { a: 'business' }).map(asset => asset.id)).toEqual(['a']);
    expect(studioAssetCandidates(values, 'one', false, '', 'none', { a: 'business' }).map(asset => asset.id)).toEqual(['b']);
    expect(studioAssetCandidates(values, 'one', false, '', 'stored-category', {}).map(asset => asset.id)).toEqual(['c']);
  });
  it('预览只接受受支持的图片data URL，不加载任意远端或SVG脚本', () => {
    expect(studioAssetImageUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    for (const value of ['https://example.invalid/pic.png','javascript:alert(1)','data:image/svg+xml;base64,AAAA','data:text/html;base64,AAAA']) expect(studioAssetImageUrl(value)).toBeUndefined();
  });
});
