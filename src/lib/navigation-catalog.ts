import { BookOpenText, FileText, FolderOpen, GitBranch, Image, KeyRound, Layers3, ListTodo, MessageSquare, Settings, SlidersHorizontal, Sparkles, Wallet, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { WorkflowRun } from '../configuration-types';
import type { Project, ViewId } from '../types';

export interface AppNavigationItem { id: ViewId; label: string; icon: LucideIcon; }
export interface NavigationTaskSummary { running: number; paused: number; review: number; }
export type PrimaryNavigationView = 'overview' | 'projects' | 'assets' | 'automation' | null;

// The full catalog remains available to search and existing deep links.
export const APP_NAVIGATION: AppNavigationItem[] = [
  { id: 'business', label: '业务制作', icon: Layers3 },
  { id: 'overview', label: '创作对话', icon: MessageSquare },
  { id: 'documents', label: '文档工作台', icon: FileText },
  { id: 'images', label: '图片工作台', icon: Image },
  { id: 'projects', label: '我的作品', icon: FolderOpen },
  { id: 'assets', label: '素材库', icon: Sparkles },
  { id: 'prompts', label: '提示词模板', icon: BookOpenText },
  { id: 'categories', label: '我的分类', icon: Layers3 },
  { id: 'workflows', label: '我的工作流', icon: Workflow },
  { id: 'automation', label: '自动化中心', icon: GitBranch },
  { id: 'models', label: '模型中心', icon: KeyRound },
  { id: 'activity', label: '任务中心', icon: ListTodo },
  { id: 'finance', label: '成本与报价', icon: Wallet },
  { id: 'settings', label: '偏好设置', icon: Settings },
  { id: 'tools', label: '工具', icon: SlidersHorizontal },
];

const primaryLabels = { overview: '创作', projects: '项目', assets: '资源库', automation: '自动化' };
export const PRIMARY_NAVIGATION = (['overview', 'projects', 'assets', 'automation'] as const).map(id => ({ ...APP_NAVIGATION.find(item => item.id === id)!, label: primaryLabels[id] }));

export interface ToolNavigationItem extends AppNavigationItem { description: string; }
export interface ToolNavigationGroup { id: string; label: string; items: ToolNavigationItem[]; }
const tool = (id: ViewId, description: string): ToolNavigationItem => ({ ...APP_NAVIGATION.find(item => item.id === id)!, description });
export const TOOL_GROUPS: ToolNavigationGroup[] = [
  { id: 'flows', label: '流程与任务', items: [tool('automation', '管理自动运行规则和待处理事项'), tool('workflows', '编辑制作步骤，复用常用流程'), tool('activity', '查看进度，处理暂停、失败与检查')] },
  { id: 'resources', label: '内容与整理', items: [tool('prompts', '保存创作要求，少打重复的文字'), tool('categories', '整理作品、提示词和工作流')] },
  { id: 'management', label: '设置与经营', items: [tool('business', '商品套餐、数字上架、客户资料与实际收益'), tool('models', '管理模型、API Key 和连接'), tool('finance', '查看真实花费，计算客户报价'), tool('settings', '调整外观、偏好，备份与恢复数据')] },
];

export function primaryNavigationView(view: ViewId): PrimaryNavigationView {
  if (view === 'overview' || view === 'business') return 'overview';
  if (['assets', 'prompts', 'categories'].includes(view)) return 'assets';
  if (view === 'projects' || view === 'documents' || view === 'images') return 'projects';
  if (['automation', 'workflows', 'activity'].includes(view)) return 'automation';
  return null;
}

export const MANAGEMENT_SECTIONS: { id: string; label: string; views: ViewId[]; items: { id: ViewId; label: string }[] }[] = [
  { id: 'resources', label: '资源库', views: ['assets', 'prompts', 'categories'], items: [{ id: 'assets', label: '素材' }, { id: 'prompts', label: '提示词模板' }, { id: 'categories', label: '业务分类' }] },
  { id: 'automation', label: '自动化', views: ['workflows', 'automation', 'activity'], items: [{ id: 'workflows', label: '流程模板' }, { id: 'automation', label: '自动运行' }, { id: 'activity', label: '运行记录' }] },
  { id: 'settings', label: '模型与设置', views: ['models', 'settings'], items: [{ id: 'models', label: '模型与账户' }, { id: 'settings', label: '外观与数据' }] },
];
export function managementSection(view: ViewId) { return MANAGEMENT_SECTIONS.find(section => section.views.includes(view)); }
export function appViewLabel(view: ViewId) { return PRIMARY_NAVIGATION.find(item => item.id === view)?.label || managementSection(view)?.label || APP_NAVIGATION.find(item => item.id === view)?.label || ''; }

export function navigationTaskSummary(runs: WorkflowRun[], workspaceId: string, projects?: Pick<Project, 'id' | 'workspaceId' | 'trashedAt'>[]): NavigationTaskSummary {
  const allowed = projects && new Set(projects.filter(project => project.workspaceId === workspaceId && !project.trashedAt).map(project => project.id));
  const summary: NavigationTaskSummary = { running: 0, paused: 0, review: 0 };
  for (const run of runs) {
    if (run.workspaceId !== workspaceId || run.hiddenAt || run.trashedAt || (allowed && !allowed.has(run.projectId))) continue;
    if (run.status === 'running') summary.running++;
    else if (run.status === 'paused') summary.paused++;
    else if (run.status === 'waiting-review') summary.review++;
  }
  return summary;
}
