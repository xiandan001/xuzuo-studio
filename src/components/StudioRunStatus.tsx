import { useId, useState } from 'react';
import { useRememberedBoolean } from '../hooks/useRememberedBoolean';
import { AlertCircle, Check, ChevronDown, CirclePause, FolderOpen, LoaderCircle, ShieldCheck, Square } from 'lucide-react';
import type { PageProps } from '../types';
import { activeRun } from '../lib/workflows';
import { isProductionRun } from '../lib/workflow-purpose';
import { CostTotal } from './CostAmount';
import { runCostRecords, summarizeCosts } from '../lib/cost-display';
import { WorkflowRunCard } from './WorkflowRunCard';
import { openStudioTool } from '../lib/studio-commands';
import { TaskRunActions } from './TaskRunActions';
import './studio-run.css';

export function StudioRunStatus({ props }: { props: PageProps }) {
  const [expanded, setExpanded] = useRememberedBoolean(`project:${props.activeProject.id}:run-status`, false);
  const [referenceRequest, setReferenceRequest] = useState<{ runId: string; sequence: number }>();
  const detailsId = useId();
  const runs = props.workflowRunner.runs.filter(run => isProductionRun(run) && run.projectId === props.activeProject.id && !run.hiddenAt && !run.trashedAt).sort((a, b) => (Date.parse(b.createdAt) || Date.parse(b.updatedAt) || 0) - (Date.parse(a.createdAt) || Date.parse(a.updatedAt) || 0));
  const run = runs.find(activeRun) || runs.find(item => item.snapshot.steps.some(step => !['manual-review', 'export'].includes(step.kind)));
  if (!run) return null;
  const cost = summarizeCosts(runCostRecords(run, props.ledger));
  const editableReview = run.mode === 'live' && ['word', 'ppt', 'excel'].includes(props.activeProject.kind);
  const labels = { running: '正在制作', paused: '已暂停', 'waiting-review': '请检查生成结果', complete: '制作已完成', cancelled: '已取消', interrupted: '任务已中断', failed: '需要处理' };
  const Icon = run.status === 'running' ? LoaderCircle : run.status === 'waiting-review' ? ShieldCheck : run.status === 'paused' ? CirclePause : ['failed', 'interrupted'].includes(run.status) ? AlertCircle : Check;
  return <section className={`studio-run-status status-${run.status}`} aria-label="当前项目执行状态">
    <div className="studio-run-status-heading">
      <span className="studio-run-status-icon"><Icon size={20} className={run.status === 'running' ? 'spin' : undefined} /></span>
      <div><strong>{run.retryStepOnly && run.status === 'complete' ? '单步重试已完成' : labels[run.status]}</strong><p>{run.mode === 'live' ? '本次调用花费 ' : '本次模拟费用 '}<CostTotal summary={cost} /></p></div>
      <div className="studio-run-status-actions">
        <TaskRunActions run={run} runner={props.workflowRunner} notify={props.notify} />
        {run.referenceIssue && <button type="button" className="btn btn-secondary" title="定位已有来源文件，不调用模型" onClick={() => { setExpanded(true); setReferenceRequest(previous => ({ runId: run.id, sequence: (previous?.sequence || 0) + 1 })); }}><FolderOpen size={16} />查看来源文件</button>}
        {run.status === 'waiting-review' && <button className="btn btn-primary" onClick={() => editableReview ? openStudioTool({ workspaceId: props.workspaceId, projectId: run.projectId, tool: 'delivery' }) : props.workflowRunner.resume(run.id)}><Check size={16} />{editableReview ? '编辑并交付' : '已检查，继续'}</button>}
        {run.status === 'running' && <><button className="btn btn-secondary" disabled={run.pauseRequested} onClick={() => props.workflowRunner.pause(run.id)}><CirclePause size={16} />暂停</button><button className="btn btn-ghost" onClick={() => props.workflowRunner.cancel(run.id)}><Square size={14} />取消</button></>}
        <button className="btn btn-ghost" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(value => !value)}>{expanded ? '收起步骤' : ['failed', 'interrupted', 'paused'].includes(run.status) ? '查看并继续' : '查看步骤'}<ChevronDown size={16} /></button>
      </div>
    </div>
    {run.error && !expanded && <p className="studio-run-error">{run.error}</p>}
    {expanded && <div id={detailsId} className="studio-run-status-details" role="region" aria-label="当前任务步骤与结果" tabIndex={0}><WorkflowRunCard key={run.id} props={props} run={run} referenceFilesRequest={referenceRequest?.runId === run.id ? referenceRequest.sequence : 0} /></div>}
  </section>;
}
