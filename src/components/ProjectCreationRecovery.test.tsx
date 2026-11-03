import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectCreationRecovery } from './ProjectCreationRecovery';

const props = { workspaceName: '测试工作区', directory: 'C:/fixture/workspace', message: '工作区连接标记丢失。请点击“检查并恢复工作区”恢复连接后重新读取。', connected: false, busy: false, onReconnect: () => undefined, onNewWorkspace: () => undefined, onClose: () => undefined };
describe('creation connection recovery guidance', () => {
  it('provides the actual recovery action and original path instead of an inaccessible instruction', () => {
    const html = renderToStaticMarkup(<ProjectCreationRecovery {...props} />);
    expect(html).toContain('工作区需要重新连接'); expect(html).toContain('C:/fixture/workspace');
    expect(html).toContain('恢复原工作区'); expect(html).not.toContain('请点击');
    expect(html).toContain('在新位置新建工作区'); expect(html).toContain('旧项目、账本和回收站记录保留在原工作区');
    expect(html).toContain('已删除的旧项目文件夹不会因此重建');
  });
  it('keeps a connected operation resumable after the project picker is canceled', () => {
    const html = renderToStaticMarkup(<ProjectCreationRecovery {...props} connected message="工作区已重新连接。" />);
    expect(html).toContain('工作区已连接，可以继续'); expect(html).toContain('选择项目文件夹并继续');
    expect(html).not.toContain('恢复原工作区'); expect(html).toContain('在新位置新建工作区');
  });
  it('disables close, return and retry while the native operation is pending', () => {
    const html = renderToStaticMarkup(<ProjectCreationRecovery {...props} busy />);
    expect(html.match(/disabled=""/g)).toHaveLength(4); expect(html).toContain('正在处理…');
    expect(html).toContain('aria-modal="true"');
  });
});
