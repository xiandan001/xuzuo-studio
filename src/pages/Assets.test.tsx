import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PageProps, Project } from '../types';
import { Assets } from './Assets';
import { BuiltinAssetDetails } from '../components/BuiltinAssetDetails';
import { BUILTIN_ASSETS } from '../lib/builtin-assets';

const props = { workspaceId: 'w', workspace: { id: 'w', name: '独立工作区' }, projects: [], activeProject: { id: '' }, notify: () => {}, onCreateProject: () => {}, onUpdateProject: () => {}, navigate: () => {} } as unknown as PageProps;
afterEach(() => vi.unstubAllGlobals());
describe('素材库内置内容与旧桌面兼容', () => {
  it('无桌面桥也先显示真实素材，12件分页、缩略图延迟读取且没有原生下拉', () => {
    vi.stubGlobal('window', {});
    const html = renderToStaticMarkup(<Assets {...props} />);
    expect(html).toContain('内置素材'); expect(html).toContain('我的素材'); expect(html.match(/class="panel builtin-asset-card"/g)).toHaveLength(12);
    expect(html.match(/loading="lazy"/g)).toHaveLength(12); expect(html).toContain('再显示 12 件'); expect(html).not.toContain('<select');
    expect(html).not.toContain('请在桌面版使用素材库');
  });
  it('素材卡片只负责浏览，不重复当前项目名称和加入项目按钮', () => {
    const list = vi.fn(); vi.stubGlobal('window', { desktop: { assets: { list, attachBuiltin: vi.fn() } } });
    const project: Project = { id: 'project-one', workspaceId: 'w', name: '不应反复显示的项目名称', kind: 'word', referenceFiles: [], status: 'draft', description: '', updatedAt: '2026-11-02T00:00:00Z', costCents: 0, version: 1, accent: 'purple' };
    const html = renderToStaticMarkup(<Assets {...props} workspace={{ ...props.workspace, directory: 'C:/fixture' }} projects={[project]} activeProject={project} />);
    expect(html.match(/class="panel builtin-asset-card"/g)).toHaveLength(12);
    expect(html).toContain('查看素材'); expect(html).not.toContain(project.name);
    expect(html).not.toContain('builtin-asset-quick'); expect(html).not.toContain('asset-own-quick'); expect(html).not.toContain('用于当前项目');
    expect(list).not.toHaveBeenCalled();
  });
  it('无桌面时预览许可和图片仍可用，复制保存按钮不可伪装成功', () => {
    vi.stubGlobal('window', {});
    const asset = BUILTIN_ASSETS.find(item => item.origin === 'open-source')!;
    const html = renderToStaticMarkup(<BuiltinAssetDetails asset={asset} props={props} targetId="" onTarget={() => {}} busy="" error="" onClose={() => {}} onImport={() => {}} onAttach={() => {}} onSave={() => {}} onLink={() => {}} />);
    expect(html).toContain('来源与使用许可'); expect(html).toContain('Copyright'); expect(html).toContain('当前可浏览和预览'); expect(html).toContain('完整预览');
    expect(html).toMatch(/disabled=""[^>]*>[\s\S]*?另存素材包/); expect(html).toContain('rel="noreferrer"');
  });
  it('旧版有assets桥但无builtin方法时解释升级需要，不加载或写入工作区', () => {
    const list = vi.fn(); vi.stubGlobal('window', { desktop: { assets: { list } } });
    const html = renderToStaticMarkup(<BuiltinAssetDetails asset={BUILTIN_ASSETS[0]} props={props} targetId="" onTarget={() => {}} busy="" error="" onClose={() => {}} onImport={() => {}} onAttach={() => {}} onSave={() => {}} onLink={() => {}} />);
    expect(html).toContain('请安装新版桌面应用'); expect(list).not.toHaveBeenCalled();
  });
});
