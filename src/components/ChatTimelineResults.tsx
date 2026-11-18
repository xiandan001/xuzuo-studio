import { lazy, memo, Suspense, useState } from 'react';
import type { PageProps } from '../types';
import type { ChatTimelineOutput } from '../lib/chat-timeline';

const HomeProductionResult = lazy(() => import('./HomeProductionResult').then(module => ({ default: module.HomeProductionResult })));
function Result({ props, output }: { props: PageProps; output: ChatTimelineOutput }) {
  const { link } = output, projectId = output.kind === 'export' ? output.link.projectId : output.link.target.projectId;
  const project = props.projects.find(item => item.id === projectId && item.workspaceId === props.workspaceId && !item.trashedAt && !item.purgedAt);
  const run = project && !link.sourceOnly && props.workflowRunner.runs.find(item => item.id === link.runId && item.projectId === projectId && item.workspaceId === props.workspaceId);
  if (run) return <>{output.kind === 'production' && <p className="chat-turn-production-caption">你的修改要求：{output.link.instruction.slice(0, 140)}{output.link.instruction.length > 140 ? '…' : ''}</p>}<Suspense fallback={<p role="status">正在读取本轮结果…</p>}><HomeProductionResult props={props} run={run} kind={output.kind === 'export' ? output.link.kind : output.link.target.kind} /></Suspense></>;
  return <p className="workspace-chat-production-record">{output.kind === 'export' ? '已保存 ' + output.link.kind.toUpperCase() + ' 文件，原回复保留。' : link.sourceOnly ? '来自备份的历史修订，保留原来源与费用记录。' : '修订记录已保存。'}{project ? <button type="button" className="text-button" onClick={() => props.navigate('project', projectId)}>查看来源项目</button> : <span>来源项目当前不可用。</span>}</p>;
}
export const ChatTimelineResults = memo(function ChatTimelineResults({ props, outputs, legacy = false }: { props: PageProps; outputs: ChatTimelineOutput[]; legacy?: boolean }) {
  const [count, setCount] = useState(1);
  return <section className="chat-turn-results" aria-label={legacy ? '独立制作与保存记录' : '本轮文件与制作结果'}>{legacy && <small>独立制作记录 · 未关联具体沟通轮次</small>}{outputs.slice(-count).map(output => <Result key={output.kind + output.link.runId} props={props} output={output} />)}{outputs.length > count && <button type="button" className="text-button" onClick={() => setCount(value => value + 3)}>查看这轮另外 {outputs.length - count} 个结果</button>}</section>;
}, (previous, next) => previous.props === next.props && previous.legacy === next.legacy && previous.outputs.length === next.outputs.length && previous.outputs.every((item, index) => item.kind === next.outputs[index].kind && item.link === next.outputs[index].link));
