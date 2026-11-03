import type { LedgerEntry, Preferences, Project, ProjectKind } from './types';

export const DEFAULT_WORKSPACE_ID = 'workspace-personal';

export const KIND_LABEL = { ppt: 'PPT 演示', word: 'Word 文档', excel: 'Excel 表格', image: '图像创作' };
export const STATUS_LABEL = { draft: '草稿', processing: '生成中', review: '待检查', complete: '已完成', paused: '已暂停' };
export const INITIAL_PROJECTS: Project[] = [
  { workspaceId: DEFAULT_WORKSPACE_ID, id: 'p1', name: '山野咖啡 · 品牌提案', kind: 'ppt', status: 'review', description: '以自然为灵感，讲好一杯咖啡的故事。', updatedAt: '今天 14:32', costCents: 486, budgetCents: 2000, version: 3, accent: 'orange', favorite: true },
  { workspaceId: DEFAULT_WORKSPACE_ID, id: 'p2', name: '春日新品 · 宣传视觉', kind: 'image', status: 'complete', description: '清新自然的产品视觉，一组风格统一的宣传图。', updatedAt: '今天 13:18', costCents: 328, budgetCents: 1500, version: 2, accent: 'green', favorite: true },
  { workspaceId: DEFAULT_WORKSPACE_ID, id: 'p3', name: '自由职业项目管理表', kind: 'excel', status: 'complete', description: '项目排期、交付进度与回款，一张表有条不紊。', updatedAt: '今天 11:05', costCents: 142, budgetCents: 1000, version: 1, accent: 'green' },
  { workspaceId: DEFAULT_WORKSPACE_ID, id: 'p4', name: '品牌合作 · 项目说明书', kind: 'word', status: 'draft', description: '梳理项目背景、交付范围和协作计划。', updatedAt: '昨天 18:24', costCents: 86, budgetCents: 1000, version: 1, accent: 'blue' },
  { workspaceId: DEFAULT_WORKSPACE_ID, id: 'p5', name: '小橘猫 · 日常表情', kind: 'image', status: 'complete', description: '有一点调皮，也有一点可爱。', updatedAt: '昨天 16:40', costCents: 472, budgetCents: 2000, version: 4, accent: 'orange' },
  { workspaceId: DEFAULT_WORKSPACE_ID, id: 'p6', name: '十月工作复盘', kind: 'ppt', status: 'complete', description: '回顾本月交付，让下一次创作更从容。', updatedAt: '10月27日', costCents: 332, budgetCents: 2000, version: 2, accent: 'purple' },
];
export const INITIAL_LEDGER: LedgerEntry[] = [
  { id: 'l1', projectId: 'p1', projectName: '山野咖啡 · 品牌提案', action: 'AI 精修', model: '文本模型 · 演示', costCents: 86, time: '今天 14:32', status: 'complete' },
  { id: 'l2', projectId: 'p1', projectName: '山野咖啡 · 品牌提案', action: 'AI 复核', model: '视觉模型 · 演示', costCents: 42, time: '今天 14:20', status: 'complete' },
  { id: 'l3', projectId: 'p1', projectName: '山野咖啡 · 品牌提案', action: '初次生成', model: '文本模型 · 演示', costCents: 358, time: '今天 14:08', status: 'complete' },
  { id: 'l4', projectId: 'p2', projectName: '春日新品 · 宣传视觉', action: '初次生成', model: '图片模型 · 演示', costCents: 328, time: '今天 13:18', status: 'complete' },
  { id: 'l5', projectId: 'p3', projectName: '自由职业项目管理表', action: '初次生成', model: '文本模型 · 演示', costCents: 142, time: '今天 11:05', status: 'complete' },
  { id: 'l6', projectId: 'p4', projectName: '品牌合作 · 项目说明书', action: '初次生成', model: '文本模型 · 演示', costCents: 86, time: '昨天 18:24', status: 'complete' },
  { id: 'l7', projectId: 'p5', projectName: '小橘猫 · 日常表情', action: '重新生成', model: '图片模型 · 演示', costCents: 142, time: '昨天 16:40', status: 'complete' },
  { id: 'l8', projectId: 'p5', projectName: '小橘猫 · 日常表情', action: '初次生成', model: '图片模型 · 演示', costCents: 330, time: '昨天 16:22', status: 'complete' },
  { id: 'l9', projectId: 'p6', projectName: '十月工作复盘', action: '初次生成', model: '文本模型 · 演示', costCents: 332, time: '10月27日', status: 'complete' },
];
export const INITIAL_PREFERENCES: Preferences = { studioName: '我的个人工作室', hourlyRate: 60, channelFeePercent: 10, targetProfit: 50, monthlyBudget: undefined, confirmGeneration: false, confirmGenerationVersion: 1, keepVersions: true, reduceMotion: false };
export const money = (cents: number) => (cents / 100).toFixed(2);
export const budgetLabel = (cents?: number | null) => cents == null ? '未设上限' : `¥${money(cents)}`;
export function budgetPercent(costCents: number, budgetCents?: number | null): number | undefined {
  if (budgetCents == null) return undefined;
  if (budgetCents === 0) return costCents > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, costCents / budgetCents * 100));
}
export function parseOptionalBudget(value: string): number | undefined {
  const text = value.trim();
  if (!text) return undefined;
  if (!/^\d+(?:\.\d{0,2})?$/.test(text)) throw new Error('请填写非负金额，最多两位小数；留空不设上限。');
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('金额超出有效范围，请调小后重试。');
  return cents;
}
export function demoCost(kind: ProjectKind, action: LedgerEntry['action'], count = 1) {
  const quantity = Math.min(4, Math.max(1, Math.floor(count)));
  const base = action === 'AI 复核' ? 18 : action === 'AI 精修' ? (kind === 'image' ? 85 : 32) : kind === 'image' ? 150 : 48;
  return base * quantity;
}
