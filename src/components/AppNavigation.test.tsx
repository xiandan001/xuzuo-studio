import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppNavigation, NavigationTaskStatus } from './AppNavigation';
import { ToolsHub } from '../pages/ToolsHub';

describe('四入口导航和按需工具页', () => {
  it('导航恰好四个按钮，不重复显示模型与任务，工作台高亮我的作品', () => {
    const html = renderToStaticMarkup(<AppNavigation view="documents" onNavigate={() => { throw new Error('渲染不能导航'); }} />);
    expect(html.match(/<button/g)).toHaveLength(4);
    expect(html).toContain('aria-label="项目" aria-current="location"');
    expect(html).not.toContain('模型中心'); expect(html).not.toContain('任务中心');
    const advanced = renderToStaticMarkup(<AppNavigation view="finance" onNavigate={() => {}} />);
    expect(advanced).not.toContain('aria-current=');
    const home = renderToStaticMarkup(<AppNavigation view="overview" onNavigate={() => {}} />);
    expect(home).toContain('aria-label="创作" aria-current="page"');
  });
  it('没有任务不显示提醒，运行/暂停/检查均有清楚可访问名称且不假称制作完成', () => {
    expect(renderToStaticMarkup(<NavigationTaskStatus summary={{ running: 0, paused: 0, review: 0 }} onOpen={() => {}} />)).toBe('');
    const html = renderToStaticMarkup(<NavigationTaskStatus summary={{ running: 1, paused: 2, review: 3 }} onOpen={() => {}} />);
    expect(html).toContain('任务状态：进行中 1，已暂停 2，待检查 3，打开任务中心');
    expect(html).toContain('>6</b>'); expect(html).not.toContain('已完成');
    expect(renderToStaticMarkup(<NavigationTaskStatus summary={{ running: 0, paused: 0, review: 1 }} onOpen={() => {}} />)).not.toContain('class="spin"');
  });
  it('工具页八个入口都有用途说明，空任务时不堆额外状态卡', () => {
    const html = renderToStaticMarkup(<ToolsHub navigate={() => { throw new Error('打开工具页不能自动派发'); }} />);
    expect(html.match(/<button/g)).toHaveLength(8);
    for (const label of ['自动化中心', '我的工作流', '任务中心', '提示词模板', '我的分类', '模型中心', '成本与报价', '偏好设置']) expect(html).toContain(`aria-label="${label}"`);
    expect(html.match(/aria-describedby="tool-description-/g)).toHaveLength(8);
    expect(html.match(/<section/g)).toHaveLength(3);
    expect(html).not.toContain('查看当前任务'); expect(html).not.toContain('<select');
    const active = renderToStaticMarkup(<ToolsHub navigate={() => {}} taskSummary={{ running: 1, paused: 0, review: 2 }} />);
    expect(active).toContain('aria-label="3 项当前任务"'); expect(active).toContain('1 项进行中 · 2 项待检查');
    expect(active.match(/<button/g)).toHaveLength(8); expect(active).not.toContain('查看当前任务'); expect(active).not.toContain('项任务需要留意');
  });
});
