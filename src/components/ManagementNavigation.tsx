import type { ViewId } from '../types';
import { managementSection } from '../lib/navigation-catalog';

export function ManagementNavigation({ view, navigate }: { view: ViewId; navigate: (view: ViewId) => void }) {
  const section = managementSection(view);
  if (!section) return null;
  return <nav className="management-section-navigation" aria-label={`${section.label}分区`}>{section.items.map(item => <button key={item.id} type="button" className={view === item.id ? 'active' : ''} aria-current={view === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>{item.label}</button>)}</nav>;
}
