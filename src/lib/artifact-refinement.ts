import type { ChatTarget, ChatTargetInspection } from '../chat-types';
import type { ModelConfiguration, WorkflowDefinition } from '../configuration-types';
import type { Project } from '../types';
import { creationPrompt } from './creation-quality';
import { normalizeReasoningEffort, type ReasoningEffort } from './reasoning-options';

export function artifactRefinementWorkflow(project: Project, target: ChatTarget, inspected: ChatTargetInspection, model: ModelConfiguration, credentialId: string, instruction: string, options: { referenceId?: string; outputGif?: boolean; reasoningEffort?: ReasoningEffort; connection?: { protocol: string; providerId: string }; animationPrompt?: string } = {}): { workflow: WorkflowDefinition; input: string; attachmentIds: string[] } {
  if (!instruction.trim() || instruction.length > 10000) throw Error('请写下本次修改要求，最多10000字。');
  if (project.id !== target.projectId || inspected.artifact.projectId !== project.id || inspected.artifact.id !== target.artifactId || inspected.sha256 !== target.sha256 || project.kind !== target.kind) throw Error('修改目标或版本已变化，请重新选择成品；尚未调用模型。');
  if (target.editorRevision !== undefined && inspected.sourceRevision !== target.editorRevision) throw Error('选择的文档保存版本已变化，请重新核对。');
  const image = target.kind === 'image', capability = image ? 'image-editing' : 'text';
  if (!model.enabled || model.demo || !model.capabilities.includes(capability) || !credentialId) throw Error('请选择可用于本次修改的模型和账户。');
  const referenceId = options.referenceId || target.artifactId;
  let input = instruction.trim(), original = '';
  const images: string[] = [];
  if (!image) {
    if (!inspected.documentSource?.trim()) throw Error('这份成品缺少绑定的可编辑源，请在文档工作台核对后保存导出，避免拿其他版本精修。');
    original = inspected.documentSource;
    if (original.length > 88000) throw Error('这份文稿较长，请在编辑器选择需要修改的段落或工作表精修。');
    try { const visit = (value: unknown) => { if (!value || typeof value !== 'object') return; if (Array.isArray(value)) { value.forEach(visit); return; } for (const [key, item] of Object.entries(value)) if (key === 'imageId' && typeof item === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(item)) images.push(item); else if (typeof item === 'object') visit(item); }; visit(JSON.parse(original)); } catch { /* The generated source may be plain prose; it is still the selected artifact's bound source. */ }
    input = `【选定成品的已保存编辑源】\n${original}\n\n【本次修改要求】\n${instruction.trim()}`;
  } else if (!options.referenceId && !['image/png','image/jpeg','image/webp'].includes(inspected.artifact.mimeType)) throw Error('此格式需要先准备静态参考，再使用对应编辑功能。');
  if (options.outputGif && model.modelId !== 'gpt-image-2.6') throw Error('继续修改原生GIF需要选择GPT Image 2.6。');
  const producerId = crypto.randomUUID(), refs = image ? [referenceId] : [...new Set([target.artifactId, ...images])];
  const prompt = creationPrompt(target.kind, `${image ? '仅按用户要求精修参考成品，保留未指定修改的主体、文字与细节；原始文件保留。' : '以选定的完整编辑源为唯一底稿，只改用户指定内容；保留稳定编号、未修改文字、数据、公式、版式、图片ID和已有样式。返回完整且可解析的修订JSON，不加解释。原稿和未保存草稿保持独立。'}\n${options.animationPrompt || ''}\n本次要求：${instruction.trim()}`, capability);
  const effort = normalizeReasoningEffort(options.connection, model, options.reasoningEffort);
  return { workflow: { id: crypto.randomUUID(), workspaceId: project.workspaceId, name: `${project.name} · 成品精修`, description: '基于明确选定的保存成品生成独立修订，保留旧文件和费用。', outputKind: target.kind, updatedAt: new Date().toISOString(), sourceArtifactTarget: { id: target.artifactId, sha256: target.sha256 }, steps: [
    { id: producerId, name: '精修选定成品', kind: capability, role: 'producer', prompt, modelConfigId: model.id, credentialId, referenceArtifactIds: refs, inputSource: 'project', maxOutputTokens: image ? 4096 : 12288, enabled: true, ...(image ? { imageOutputFormat: options.outputGif ? 'gif' : 'png', count: 1 } : { reasoningEffort: effort }) },
    { id: crypto.randomUUID(), name: '保存独立修订文件', kind: 'export', prompt: '', inputSource: 'previous', referenceArtifactIds: image ? [referenceId] : [...new Set(images)], enabled: true, ...(image && !options.outputGif ? { engineeringReferenceId: referenceId, contentSourceStepIds: [producerId] } : { contentSourceStepId: producerId }) },
    { id: crypto.randomUUID(), name: '检查本次修订', kind: 'manual-review', prompt: '', inputSource: 'previous', enabled: true },
  ] }, input, attachmentIds: refs };
}
