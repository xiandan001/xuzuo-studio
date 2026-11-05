import type { StudioConfiguration, WorkflowDraft, WorkflowStep } from '../configuration-types';
import type { ProjectKind } from '../types';
import { studioCredential, studioModel } from './studio-run';
import { CREATION_PROFILES } from './creation-profiles';
import { withCreationFoundation } from './creation-quality';

export interface GoalBrief { objective: string; deliverables: string[]; acceptance: string[]; constraints: string[]; knownInputs: string[]; }
export const AUTOMATION_FOUNDATION_VERSION = '2026-11-03-v1';
export function automationRecipe(kind: ProjectKind, name: string, brief: GoalBrief, configuration: StudioConfiguration, maxRepairs = 1): WorkflowDraft {
  const bind = (step: WorkflowStep) => {
    const model = studioModel(configuration.models.filter(model => !model.demo && model.enabled && model.capabilities.includes(step.kind as 'text') && configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled && !connection.demo)));
    const credentialId = studioCredential(configuration.credentials, model?.connectionId);
    return { ...step, modelConfigId: model?.id, credentialId };
  };
  const planner = bind({ id: crypto.randomUUID(), name: '明确目标、资料和验收要求', role: 'planner', kind: 'text', enabled: true, inputSource: 'project', maxOutputTokens: 2048, prompt: '你是任务规划员。依据用户目标与真实参考资料整理任务书，只返回JSON：{"objective":"目标","deliverables":[],"knownFacts":[],"missingInputs":[],"constraints":[],"acceptance":[]}。缺失事实如实列出，不编造客户、价格、日期或数据。任务书供后续制作使用，不冒充成品。' });
  const producer = bind({ id: crypto.randomUUID(), name: kind === 'image' ? '制作实际图片' : '制作完整文档', role: 'producer', kind: kind === 'image' ? 'image-generation' : 'text', enabled: true, inputSource: 'previous', maxOutputTokens: CREATION_PROFILES[kind].outputTokens, count: 1, imageSize: 'auto', prompt: `根据用户目标和上一阶段任务书制作完整${{ word: 'Word文档', ppt: '演示文稿', excel: '业务工作簿', image: '图像' }[kind]}。\n验收要求：${brief.acceptance.join('；')}\n边界：${brief.constraints.join('；')}\n已提供资料：${brief.knownInputs.join('；')}。缺项按规范保留为待核实信息，不编造事实。` });
  const reviewer = bind({ id: crypto.randomUUID(), name: '独立检查实际结果', role: 'reviewer', kind: kind === 'image' ? 'vision' : 'text', enabled: true, inputSource: 'previous', maxOutputTokens: 2048, qualityGate: { repairStepId: producer.id, maxRepairs: Math.max(0, Math.min(3, maxRepairs)), minScore: 80 }, prompt: `你是独立验收员，不能以作者自评代替检查。依据用户目标及实际提供的内容检查完整性、事实边界、可用性、明显格式/图像问题；无法从当前材料核实的项必须列出。验收标准：${brief.acceptance.join('；')}。仅返回JSON：{"passed":true,"score":0,"issues":["可操作的问题"],"summary":"检查证据与尚未核实项"}；score为0到100。明显占位、关键要求遗漏或虚构事实不能通过。不声称已打开实际未渲染的Office文件，也不声称素材已获授权。` });
  const exporter: WorkflowStep = { id: crypto.randomUUID(), name: '生成实际交付文件', kind: 'export', enabled: true, inputSource: 'previous', prompt: '', ...(kind !== 'image' ? { contentSourceStepId: producer.id } : {}) };
  const check: WorkflowStep = { id: crypto.randomUUID(), name: '检查并确认实际交付', kind: 'manual-review', enabled: true, inputSource: 'previous', prompt: '' };
  const flow = { id: 'recipe-preview', workspaceId: '', updatedAt: '', name: name.trim(), description: `目标：${brief.objective}\n验收：${brief.acceptance.join('；')}\n最多 ${maxRepairs} 轮自动修订，人工确认后交付。`, outputKind: kind, goalBrief: brief, foundationVersion: AUTOMATION_FOUNDATION_VERSION, steps: [planner, producer, reviewer, exporter, check] };
  const normalized = withCreationFoundation(flow);
  return { name: normalized.name, description: normalized.description, outputKind: normalized.outputKind, steps: normalized.steps, goalBrief: brief, foundationVersion: AUTOMATION_FOUNDATION_VERSION };
}
