import type { PageProps, Project, ViewId } from '../types';
import type { ArtifactMetadata } from '../live-types';
import type { StudioAsset } from '../asset-types';
import { BUILTIN_ASSETS } from './builtin-assets';
import { isActiveProject } from './workspace-state';

export interface SearchTarget { token: string; kind: 'asset' | 'prompt' | 'workflow'; id: string; name: string; workspaceId?: string; }
export type SearchGroupKind = 'project' | 'file' | 'asset' | 'prompt' | 'workflow' | 'page';
export interface LocalSearchItem { key: string; id: string; kind: SearchGroupKind; name: string; description: string; text: string; view?: ViewId; projectId?: string; file?: ArtifactMetadata; builtin?: boolean; }
export const SEARCH_GROUPS: { kind: SearchGroupKind; label: string }[] = [{ kind: 'project', label: '项目' }, { kind: 'file', label: '已登记项目文件' }, { kind: 'asset', label: '素材' }, { kind: 'prompt', label: '提示词模板' }, { kind: 'workflow', label: '工作流' }, { kind: 'page', label: '页面与功能' }];
export const normalizeSearch = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const indexed = (item: Omit<LocalSearchItem, 'text'>, description = item.description): LocalSearchItem => ({ ...item, text: normalizeSearch(`${item.name} ${description.slice(0, 2000)}`) });
const formatTerms = { word: 'Word DOCX 文档', ppt: 'PPT PPTX 演示 幻灯片', excel: 'Excel XLSX 表格 工作簿', image: '图片 PNG JPG 图像' };
const pageTerms: Partial<Record<ViewId, string>> = { overview: '创作 对话 首页 工作总览', projects: '项目 我的项目 我的作品', documents: '文档编辑 Word DOCX PPT PPTX Excel XLSX 表格 幻灯片 工作台', images: '图片编辑 PNG JPG 图像 生图 精修 工作台', assets: '资源库 素材 图片 图标', prompts: '提示词 用途 模板', categories: '分类 业务类别', workflows: '流程 自动化模板 工作流', automation: '自动运行 定时 调度 规则', activity: '运行记录 任务 进度', models: '模型 API Key 密钥 账户 连接', finance: '费用 成本 账本 报价 售价', settings: '设置 外观 主题 备份 数据', business: '业务 制作 商家 商品 套餐 上架 数字商品 客户资料 套件 返修 收支'  };
export const projectSearchView = (project: Pick<Project, 'kind'>): ViewId => project.kind === 'image' ? 'images' : 'documents';

export function localSearchIndex(props: Pick<PageProps, 'workspaceId' | 'projects' | 'prompts' | 'configuration' | 'workflowRunner' | 'activeProject'>, navigation: { id: ViewId; label: string }[], inventory: ArtifactMetadata[] = []): LocalSearchItem[] {
  const projects = props.projects.filter(project => project.workspaceId === props.workspaceId && isActiveProject(project)), allowed = new Map(projects.map(project => [project.id, project]));
  const items: LocalSearchItem[] = projects.map(project => indexed({ key: `project:${project.id}`, id: project.id, kind: 'project', name: project.name, description: `${formatTerms[project.kind]} · ${project.description.slice(0, 160)}`, projectId: project.id, view: projectSearchView(project) }, `${formatTerms[project.kind]} ${project.description}`));
  const files = new Map<string, ArtifactMetadata>(), trashed = new Set(props.workflowRunner.trashedArtifacts?.map(file => file.id));
  for (const run of props.workflowRunner.runs) if (run.mode !== 'simulation' && run.workspaceId === props.workspaceId && allowed.has(run.projectId) && !run.trashedAt) for (const attempt of run.attempts) for (const file of attempt.artifacts || []) if (!file.projectId || file.projectId === run.projectId) files.set(file.id, { ...file, projectId: run.projectId });
  for (const project of projects) for (const file of project.referenceFiles || []) if (!files.has(file.id)) files.set(file.id, { ...file, projectId: project.id, path: '', createdAt: '' });
  for (const file of inventory) if (file.projectId && allowed.has(file.projectId)) files.set(file.id, file);
  for (const file of files.values()) {
    const project = allowed.get(file.projectId || ''); if (!project || file.trashedAt || file.unavailable || trashed.has(file.id)) continue;
    items.push(indexed({ key: `file:${file.id}`, id: file.id, kind: 'file', name: file.name, description: `${project.name} · ${file.kind === 'office' ? 'Office 成品' : file.kind === 'image' ? '图片' : '项目文件'}`, projectId: project.id, file, view: projectSearchView(project) }));
  }
  for (const asset of BUILTIN_ASSETS) items.push(indexed({ key: `asset:${asset.id}`, id: asset.id, kind: 'asset', name: asset.name, description: `内置素材 · ${asset.collection}`, builtin: true, view: 'assets' }, `${asset.description} ${asset.tags.join(' ')}`));
  for (const prompt of props.prompts) if ((prompt.builtin || prompt.workspaceId === props.workspaceId) && !prompt.archivedAt && !prompt.trashedAt) items.push(indexed({ key: `prompt:${prompt.id}`, id: prompt.id, kind: 'prompt', name: prompt.name, description: prompt.description.slice(0, 160), builtin: prompt.builtin, view: 'prompts' }, `${prompt.description} ${prompt.content.slice(0, 1200)}`));
  for (const workflow of props.configuration.workflows) if (workflow.workspaceId === props.workspaceId) items.push(indexed({ key: `workflow:${workflow.id}`, id: workflow.id, kind: 'workflow', name: workflow.name, description: `${workflow.steps.length} 个步骤 · ${workflow.description.slice(0, 120)}`, view: 'workflows' }, workflow.description));
  for (const page of navigation) items.push(indexed({ key: `page:${page.id}`, id: page.id, kind: 'page', name: page.label, description: '打开页面', view: page.id }, pageTerms[page.id] || '打开页面'));
  return items;
}

export function searchOwnAssetItems(assets: StudioAsset[], workspaceId: string): LocalSearchItem[] {
  return assets.filter(asset => asset.workspaceId === workspaceId && !asset.archivedAt).map(asset => indexed({ key: `asset:${asset.id}`, id: asset.id, kind: 'asset', name: asset.name, description: `我的素材 · ${asset.kind === 'image' ? '图片' : '参考资料'}`, view: 'assets' }, `${asset.name} ${asset.mimeType} ${asset.kind}`));
}

export function groupedLocalSearch(items: LocalSearchItem[], query: string, limits: Partial<Record<SearchGroupKind, number>> = {}) {
  const normalized = normalizeSearch(query.slice(0, 120)), tokens = normalized.split(' ').filter(Boolean);
  const grouped = new Map<SearchGroupKind, { item: LocalSearchItem; rank: number; index: number }[]>();
  items.forEach((item, index) => { if (tokens.some(token => !item.text.includes(token))) return; const name = normalizeSearch(item.name), rank = !normalized ? 4 : name === normalized ? 0 : name.startsWith(normalized) ? 1 : name.includes(normalized) ? 2 : 3; const group = grouped.get(item.kind) || []; group.push({ item, rank, index }); grouped.set(item.kind, group); });
  return SEARCH_GROUPS.map(group => { const matches = grouped.get(group.kind) || [], limit = Math.max(1, Math.min(50, limits[group.kind] || 6)); matches.sort((left, right) => left.rank - right.rank || left.index - right.index); return { ...group, total: matches.length, items: matches.slice(0, limit).map(match => match.item) }; });
}
