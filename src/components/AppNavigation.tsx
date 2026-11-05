import { ClipboardCheck, CirclePause, LoaderCircle } from 'lucide-react';
import { PRIMARY_NAVIGATION, primaryNavigationView } from '../lib/navigation-catalog';
import type { NavigationTaskSummary } from '../lib/navigation-catalog';
import type { ViewId } from '../types';
import './app-navigation.css';

export function AppNavigation({ view, onNavigate }: { view: ViewId; onNavigate: (view: ViewId) => void }) {
  const active = primaryNavigationView(view);
  return <nav className="sidebar-nav focused-navigation" aria-label="主导航">
    {PRIMARY_NAVIGATION.map(item => <button type="button" key={item.id} className={`nav-item ${active === item.id ? 'active' : ''}`} aria-label={item.label} aria-current={view === item.id ? 'page' : active === item.id ? 'location' : undefined} title={item.label} onClick={() => onNavigate(item.id === 'automation' ? 'workflows' : item.id)}>
      <item.icon size={19} strokeWidth={active === item.id ? 2 : 1.8} /><span>{item.label}</span>
    </button>)}
  </nav>;
}

export function NavigationTaskStatus({ summary, onOpen }: { summary?: NavigationTaskSummary; onOpen: () => void }) {
  if (!summary || !summary.running && !summary.paused && !summary.review) return null;
  const labels = [summary.running ? `进行中 ${summary.running}` : '', summary.paused ? `已暂停 ${summary.paused}` : '', summary.review ? `待检查 ${summary.review}` : ''].filter(Boolean);
  const Icon = summary.running ? LoaderCircle : summary.paused ? CirclePause : ClipboardCheck;
  return <button type="button" className="navigation-task-status" aria-label={`任务状态：${labels.join('，')}，打开任务中心`} title={`${labels.join(' · ')}，打开任务中心`} onClick={onOpen}>
    <Icon size={16} className={summary.running ? 'spin' : undefined} /><span>{labels.join(' · ')}</span><b>{summary.running + summary.paused + summary.review}</b>
  </button>;
}
