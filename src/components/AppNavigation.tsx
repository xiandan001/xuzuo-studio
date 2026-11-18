import { CircleAlert, ClipboardCheck, CirclePause, LoaderCircle } from 'lucide-react';
import { PRIMARY_NAVIGATION, primaryNavigationView } from '../lib/navigation-catalog';
import type { NavigationTaskSummary } from '../lib/navigation-catalog';
import type { ViewId } from '../types';
import './app-navigation.css';

export function AppNavigation({ view, onNavigate }: { view: ViewId; onNavigate: (view: ViewId) => void }) {
  const active = primaryNavigationView(view);
  return <nav className="sidebar-nav focused-navigation" aria-label="主导航">
    {PRIMARY_NAVIGATION.map(item => <button type="button" key={item.id} className={`nav-item ${active === item.id ? 'active' : ''}`} aria-label={item.label} aria-current={view === (item.id === 'automation' ? 'activity' : item.id) ? 'page' : active === item.id ? 'location' : undefined} title={item.label} onClick={() => onNavigate(item.id === 'automation' ? 'activity' : item.id)}>
      <item.icon size={19} strokeWidth={active === item.id ? 2 : 1.8} /><span>{item.label}</span>
    </button>)}
  </nav>;
}

export function NavigationTaskStatus({ summary, onOpen }: { summary?: NavigationTaskSummary; onOpen: () => void }) {
  if (!summary) return null;
  const { running, paused, review, failed = 0, interrupted = 0, queued = 0, dispatchAttention = 0, dispatchIssue } = summary;
  const attention = paused + review + failed + interrupted + dispatchAttention;
  const total = running + queued + attention;
  if (!total && !dispatchIssue) return null;
  const labels = [running ? `进行中 ${running}` : '', paused ? `已暂停 ${paused}` : '', review ? `待检查 ${review}` : '', failed ? `失败待处理 ${failed}` : '', interrupted ? `已中断 ${interrupted}` : '', queued ? `调度中 ${queued}` : '', dispatchAttention ? `调度待处理 ${dispatchAttention}` : '', dispatchIssue ? '调度记录读取异常' : ''].filter(Boolean);
  const headline = [running ? `执行中 ${running}` : '', queued ? `调度 ${queued}` : '', attention ? `待处理 ${attention}` : ''].filter(Boolean).join(' · ');
  const Icon = running ? LoaderCircle : failed || interrupted || dispatchAttention || dispatchIssue ? CircleAlert : paused ? CirclePause : ClipboardCheck;
  return <button type="button" className="navigation-task-status" aria-label={`任务状态：${labels.join('，')}，打开任务中心`} title={`${labels.join(' · ')}，打开任务中心`} onClick={onOpen}>
    <Icon size={16} className={Icon === LoaderCircle ? 'spin' : undefined} /><span>{headline || '任务需检查'}</span>{total > 0 && <b>{total}</b>}
  </button>;
}
