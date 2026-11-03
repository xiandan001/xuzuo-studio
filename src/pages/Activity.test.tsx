import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PageProps } from '../types';
import { Activity } from './Activity';
import type { WorkflowRun } from '../configuration-types';

function fixture(withProject: boolean): PageProps {
  const project = { id: 'empty-task-project', name: '客户文档', kind: 'word', workspaceId: 'audit', status: 'draft' };
  return { projects: withProject ? [project] : [], activeProject: withProject ? project : { id: '' }, workflowRunner: { runs: [] }, navigate: () => undefined, onCreateProject: () => undefined, onGenerate: () => { throw new Error('An empty task page must not generate anything.'); } } as unknown as PageProps;
}
describe('任务中心无执行记录', () => {
  it('有项目也只显示真实空态和导航，不提供假演示或生成操作', () => {
    const html = renderToStaticMarkup(<Activity {...fixture(true)} />);
    expect(html).toContain('还没有执行记录'); expect(html).toContain('不会开始模型调用'); expect(html).toContain('任务空态关联项目'); expect(html).toContain('打开所选项目'); expect(html).toContain('新建项目'); expect(html).toContain('查看工作流');
    expect(html).not.toContain('开始演示'); expect(html).not.toContain('再次生成'); expect(html).not.toContain('演示日志'); expect(html).not.toContain('32%');
  });
  it('没有项目时仍能查看流程或新建，不读取不存在项目的状态', () => {
    const html = renderToStaticMarkup(<Activity {...fixture(false)} />);
    expect(html).toContain('还没有执行记录'); expect(html).toContain('新建项目'); expect(html).toContain('查看工作流'); expect(html).not.toContain('打开所选项目');
  });
  it('默认展示紧凑任务及明确下一步，完整详情按需展开，不自动加载历史日志', () => {
    const props = fixture(true);
    props.ledger = [];
    props.workflowRunner.runs = [{ id: 'finished', projectId: 'empty-task-project', workflowName: '客户手册', status: 'complete', mode: 'live', snapshot: { steps: [{ id: 'text', enabled: true }] }, attempts: [{ stepId: 'text', status: 'complete' }, { stepId: 'text', status: 'failed' }], updatedAt: '2026-11-02T09:00:00Z' }] as WorkflowRun[];
    const html = renderToStaticMarkup(<Activity {...props} />);
    expect(html).toContain('按任务状态筛选'); expect(html).toContain('筛选任务项目'); expect(html).toContain('搜索任务');
    expect(html).toContain('查看成品'); expect(html).toContain('执行完成'); expect(html).toContain('0 / 1 步已完成');
    expect(html).not.toContain('wf-run-card'); expect(html).not.toContain('重试此步'); expect(html).not.toContain('已确认交付');
  });
});
