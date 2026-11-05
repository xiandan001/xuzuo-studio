import { ArrowUpRight } from 'lucide-react';
import { TOOL_GROUPS } from '../lib/navigation-catalog';
import type { NavigationTaskSummary } from '../lib/navigation-catalog';
import type { ViewId } from '../types';
import './tools-hub.css';

export function ToolsHub({ navigate, taskSummary }: { navigate: (view: ViewId) => void; taskSummary?: NavigationTaskSummary }) {
  const taskCount = taskSummary ? taskSummary.running + taskSummary.paused + taskSummary.review : 0;
  const taskDescription = taskSummary && [taskSummary.running ? `${taskSummary.running} 项进行中` : '', taskSummary.paused ? `${taskSummary.paused} 项已暂停` : '', taskSummary.review ? `${taskSummary.review} 项待检查` : ''].filter(Boolean).join(' · ');
  return <div className="tools-hub page-enter">
    <div className="page-heading"><div><h1 className="page-title">工具</h1><p className="page-description">流程、模型和费用，在这里管理。</p></div></div>
    <div className="tools-hub-groups">{TOOL_GROUPS.map(group => <section className="tools-hub-group" key={group.id} aria-labelledby={`tools-group-${group.id}`}>
      <h2 id={`tools-group-${group.id}`}>{group.label}</h2>
      <div className="tools-hub-list">{group.items.map(item => <button type="button" className="tools-hub-link" key={item.id} aria-label={item.label} aria-describedby={`tool-description-${item.id}`} onClick={() => navigate(item.id)}>
        <span className="tools-hub-icon"><item.icon size={20} strokeWidth={1.7} /></span><span className="tools-hub-copy"><strong>{item.label}{item.id === 'activity' && taskCount > 0 && <span className="tools-hub-task-count" aria-label={`${taskCount} 项当前任务`}>{taskCount}</span>}</strong><small id={`tool-description-${item.id}`}>{item.id === 'activity' && taskCount > 0 ? taskDescription : item.description}</small></span><ArrowUpRight size={16} className="tools-hub-arrow" />
      </button>)}</div>
    </section>)}</div>
  </div>;
}
