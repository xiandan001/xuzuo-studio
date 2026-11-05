import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PageProps } from '../types';
import type { NaturalAutomationSession } from '../hooks/useNaturalAutomationSession';
import { HomePlanCard } from './HomePlanCard';
const plan = { version: 1, name: '产品宣传图', objective: '制作清晰的商品宣传图', outputKind: 'image', trigger: { type: 'manual' }, steps: [{ name: '生成实际图片', kind: 'image-generation', instruction: '保留商品结构' }], questions: [], constraints: [], acceptance: ['清晰'], unsupported: [], maxRepairs: 0, illustrations: { mode: 'none', count: 0 } };
function html(options: { created?: boolean; job?: boolean; artifact?: boolean; unknown?: boolean; scheduled?: boolean; waiting?: boolean; targetPurged?: boolean; billingOwnerPurged?: boolean; questions?: boolean; failedFollowup?: boolean; sessionError?: string; continuation?: boolean } = {}) {
  const project = { id: 'project', workspaceId: 'workspace', kind: 'image', name: '本地作品' }, job = options.job ? { id: 'job', ruleId: 'rule', runId: 'run', dispatchKey: 'dispatch', status: options.waiting ? 'decision' : 'complete' } : undefined;
  const props = { workspaceId: 'workspace', workspace: { name: '工作区' }, ledger: [], projects: options.targetPurged ? [] : [project], purgedProjects: options.targetPurged ? [{ ...project, purgedAt: '2026-11-04T04:00:00Z' }] : options.billingOwnerPurged ? [{ id: 'owner', workspaceId: 'workspace', name: '原规划项目', purgedAt: '2026-11-04T04:00:00Z' }] : [], configuration: { models: [], connections: [], credentials: [], workflows: [] }, workflowRunner: { runs: options.job ? [{ id: 'run', workspaceId: 'workspace', projectId: 'project', mode: 'live', workflowId: 'flow', snapshot: { outputKind: 'image', steps: [] }, status: options.waiting ? 'waiting-review' : 'complete', attempts: [{ status: 'complete', artifacts: options.artifact ? [{ id: 'image', name: '真实结果.png', kind: 'image', mimeType: 'image/png', bytes: 1024 }] : [] }] }] : [] } } as unknown as PageProps;
  const selectedPlan = { ...plan, ...(options.scheduled ? { trigger: { type: 'schedule', intervalMinutes: 60 } } : {}), ...(options.questions ? { questions: ['产品名称是什么？'] } : {}) };
  const session = { draft: { plan: selectedPlan, projectId: 'project', workflowId: 'flow', bindings: {}, ruleId: options.created ? 'rule' : undefined }, project, bindings: {}, result: {}, planning: { active: false }, readiness: { capabilities: [], answers: {}, bindings: {}, errors: [], lastJob: job, dispatchUnknown: options.unknown }, preparationRequest: 0 } as unknown as NaturalAutomationSession;
  session.draft.acceptedRequestId = 'first-plan'; session.draft.requestId = options.failedFollowup ? 'next-plan' : 'first-plan'; session.error = options.sessionError || '';
  if (options.failedFollowup) session.planning.record = { id: 'next-plan', status: 'failed' } as NonNullable<NaturalAutomationSession['planning']['record']>;
  return renderToStaticMarkup(<HomePlanCard props={props} session={session} continuation={options.continuation ? { previousRuleId: 'previous-rule', previousRunId: 'previous-run' } : undefined} />);
}
describe('首页方案只突出当前用户主动作', () => {
  it('第二轮规划失败不把错误挂到上一轮成功作品，本轮执行错误仍正常显示', () => {
    const error = '第二轮规划暂未完成';
    const view = html({ created: true, job: true, artifact: true, waiting: true, failedFollowup: true, sessionError: error });
    expect(view).toContain('作品已生成'); expect(view).not.toContain(error);
    expect(html({ created: true, sessionError: '本轮制作未能提交' })).toContain('本轮制作未能提交');
  });
  it('衔接新一轮前直接说明上一轮成品和费用保留，不增加确认步骤', () => {
    const view = html({ continuation: true }); expect(view).toContain('这次会接着做新一轮，上一轮作品和费用保留。'); expect(view).toContain('按这个方案制作'); expect(view).not.toContain('role="dialog"');
  });
  it('新方案突出按方案制作，保存流程保持低权重，高级设置不默认展开', () => { const view = html(); expect(view).toContain('按这个方案制作'); expect(view).toContain('仅保存流程'); expect(view).toContain('步骤与高级设置'); expect(view).not.toContain('role="region" aria-label="制作前补充信息"'); });
  it('创建后还未开始，主动作变为继续制作', () => { expect(html({ created: true })).toContain('继续制作'); });
  it('实际有成品的已完成job原位显示真实结果和导出；完成但无成品只看步骤，不伪造成品', () => { const ready = html({ created: true, job: true, artifact: true }); expect(ready).toContain('作品已生成'); expect(ready).toContain('真实结果.png'); expect(ready).toContain('打开编辑器'); expect(ready).toContain('导出图片'); const empty = html({ created: true, job: true }); expect(empty).toContain('查看结果与步骤'); expect(empty).not.toContain('>导出图片<'); });
  it('等待人工检查时保留实际作品和人工验收状态，打开或导出不冒充已交付', () => { const view = html({ created: true, job: true, artifact: true, waiting: true }); expect(view).toContain('作品已生成'); expect(view).toContain('待人工验收'); expect(view).not.toContain('当前版本已交付'); expect(html({ created: true, job: true, waiting: true })).toContain('查看结果与步骤'); });
  it('提交受理未知时只读取任务状态，不用默认主按钮重复运行', () => { expect(html({ created: true, unknown: true })).toContain('读取任务状态'); });
  it('间隔计划明确这次只试一次、自动运行待开启，普通手动方案不增加这一行', () => { const view = html({ created: true, scheduled: true }); expect(view).toContain('每隔 60 分钟'); expect(view).toContain('当前只试运行一次，自动运行待开启'); expect(view).toContain('设置自动运行'); expect(html()).not.toContain('当前只试运行一次'); });
  it('目标项目永久删除时即使旧job、成品与未知回执仍在内存，也只显示不可恢复审计说明', () => { const view = html({ targetPurged: true, created: true, job: true, artifact: true, unknown: true, scheduled: true }); expect(view).toContain('已永久删除'); expect(view).toContain('历史费用保留'); expect(view).not.toContain('<button'); expect(view).not.toContain('步骤与高级设置'); });
  it('仅规划记账项目删除时仍允许有效目标项目继续制作或查看实际作品', () => { expect(html({ billingOwnerPurged: true, created: true })).toContain('继续制作'); expect(html({ billingOwnerPurged: true, created: true, job: true, artifact: true })).toContain('打开编辑器'); expect(html({ billingOwnerPurged: true, created: true })).not.toContain('这份方案和对话仅供查看'); });
  it('免费问题直接留在方案卡，生产设置只提供定位入口，高级方案不复制另一份模型表单', () => { const view = html({ questions: true }); expect(view).toContain('aria-label="制作资料回答 1"'); expect(view).toContain('填写免费'); expect(view).toContain('产品名称是什么？'); expect(view).toContain('补充制作设置'); expect(view).not.toContain('可选：提前设置制作模型'); expect(view).not.toContain('class="natural-model-row"'); });
});
