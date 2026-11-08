import { shortcutLabel } from '../lib/platform';
import { Bell, FolderOpen, Plus, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ViewId } from '../types';
import type { NavigationTaskSummary } from '../lib/navigation-catalog';
import { NavigationTaskStatus } from './AppNavigation';
import { AppearanceControl } from './AppearanceControl';
import { Select } from './Select';

interface Props {
  summary: NavigationTaskSummary; onNavigate: (view: ViewId) => void; onSearch: () => void;
  onNotifications: () => void; onHelp: () => void; onOpenFolder?: () => void;
  onCreateProject?: () => void;
  notify: (message: string, type?: 'success' | 'info' | 'error') => void;
  children?: ReactNode;
}
export function AppHeaderActions({ summary, onNavigate, onSearch, onNotifications, onHelp, onOpenFolder, onCreateProject, notify, children }: Props) {
  function action(value: string) {
    if (value === 'notifications') onNotifications();
    else if (value === 'help') onHelp();
    else if (value === 'folder') onOpenFolder?.();
    else if (value === 'models' || value === 'settings') onNavigate(value);
  }
  return <div className="header-actions focused-header-actions">
    {children}
    <NavigationTaskStatus summary={summary} onOpen={() => onNavigate('activity')} />
    <button className="global-search" aria-label="搜索作品与工具" title={`搜索作品与工具 · ${shortcutLabel('K')}`} onClick={onSearch}><Search size={16} /><span>搜索作品与工具</span><kbd>{shortcutLabel('K')}</kbd></button>
    <AppearanceControl notify={notify} />
    <button type="button" className="btn-icon header-notifications" aria-label="通知与最近动态" onClick={onNotifications}><Bell size={18} /></button>
    {onOpenFolder && <button type="button" className="btn-icon header-folder" aria-label="打开当前文件夹" onClick={onOpenFolder}><FolderOpen size={18} /></button>}
    <div className="focused-header-more"><Select aria-label="更多应用操作" value="" placeholder="更多" onValueChange={action} options={[
      { value: 'settings', label: '外观、界面与设置' }, { value: 'models', label: '模型与 API Key' },
      { value: 'folder', label: '打开当前文件夹', disabled: !onOpenFolder },
      { value: 'notifications', label: '通知与最近动态' }, { value: 'help', label: '使用帮助' },
    ]} /></div>
    {onCreateProject && <button type="button" className="btn btn-primary header-new-project" onClick={onCreateProject}><Plus size={17} />新建项目</button>}
  </div>;
}
