import type { AnimationDocument, AnimationEntry, AnimationFrame, AnimationMotion } from '../../animation-types';
import type { StudioConfiguration } from '../../configuration-types';
import { studioCredential, studioModel } from '../../lib/studio-run';
import { ANIMATION_STYLES as styles, animationArtHash, animationStyle, checkedAnimationDocument } from '../../lib/animation-document';

export const ANIMATION_STYLES = styles.map(style => ({ value: style.id, label: style.name, description: style.description }));
export const ANIMATION_MOTIONS: { value: AnimationMotion; label: string }[] = [
  ['nod', '点头'], ['jump', '跳跃'], ['sway', '摇摆'], ['startle', '惊讶'], ['tremble', '发抖'], ['ponder', '思考'], ['breathe', '呼吸'], ['stomp', '跺脚'], ['rush', '冲刺'], ['peek', '探头'], ['pulse', '心动'], ['pop', '弹出'], ['offer', '递出'], ['lean', '探身'], ['droop', '沮丧'], ['dance', '舞蹈'],
].map(([value, label]) => ({ value: value as AnimationMotion, label }));
export const animationError = (cause: unknown) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '操作未完成，原稿和已发生的费用保留。';
export const animationDraftKey = (projectId: string) => `xuzuo-animation-draft-v1-${projectId}`;
export function animationModels(configuration: StudioConfiguration) {
  return configuration.models.filter(model => model.enabled && !model.demo && model.capabilities.some(capability => ['image-generation', 'image-editing'].includes(capability)) && configuration.connections.some(connection => connection.id === model.connectionId && connection.enabled && !connection.demo));
}
export function selectedAnimationModel(document: AnimationDocument, configuration: StudioConfiguration): AnimationDocument {
  const models = animationModels(configuration), eligible = models.filter(model => model.capabilities.includes(document.referenceArtifactIds.length || document.acceptedSampleId ? 'image-editing' : 'image-generation')), model = models.find(item => item.id === document.modelConfigId) || studioModel(eligible, document.modelConfigId);
  return { ...document, modelConfigId: model?.id || document.modelConfigId, credentialId: model ? studioCredential(configuration.credentials, model.connectionId, document.credentialId) || '' : document.credentialId };
}
export function animationIssue(document: AnimationDocument): string {
  try { checkedAnimationDocument(document, document.projectId); return ''; } catch (cause) { return animationError(cause); }
}
export function retimeAnimation(document: AnimationDocument, fps: number, loopMs = Math.max(100, Math.min(6000, Math.round(document.loopMs * document.fps / fps / 10) * 10))): AnimationDocument {
  if (!Number.isFinite(fps) || fps < 1 || fps > 50) throw Error('播放帧率需为 1–50。');
  return { ...document, fps, loopMs, entries: document.entries.map(entry => { const durations = animationFrameDurations(entry.frames.map(frame => frame.durationMs), loopMs); return { ...entry, status: entry.frames.length ? 'stale' : 'draft', frames: entry.frames.map((frame, index) => ({ ...frame, durationMs: durations[index] })) }; }) };
}
export function animationFrameDurations(weights: number[], loopMs: number): number[] {
  if (!Number.isInteger(loopMs) || loopMs < 100 || loopMs > 6000 || loopMs % 10) throw Error('循环时长需为 100–6000 毫秒、10 毫秒的倍数。');
  if (!weights.length) return [];
  const ticks = loopMs / 10; if (ticks < weights.length) throw Error(`当前 ${weights.length} 个关键帧至少需要 ${weights.length * 10} 毫秒，请增加时长或减少帧。`);
  const total = weights.reduce((sum, weight) => sum + weight, 0); if (!Number.isFinite(total) || total <= 0 || weights.some(weight => !Number.isFinite(weight) || weight <= 0)) throw Error('关键帧时长无效，请先检查当前帧。');
  const remaining = ticks - weights.length, shares = weights.map((weight, index) => ({ index, whole: Math.floor(weight * remaining / total), remainder: weight * remaining % total }));
  const values = shares.map(share => share.whole + 1), extra = ticks - values.reduce((sum, value) => sum + value, 0);
  shares.sort((a, b) => b.remainder - a.remainder || a.index - b.index); for (let index = 0; index < extra; index++) values[shares[index].index]++;
  return values.map(value => value * 10);
}
export function adoptExistingAnimationSources(input: AnimationDocument, kind: 'atlas' | 'sequence', selectedId: string): { document: AnimationDocument; entryIds: string[] } {
  const document = checkedAnimationDocument(input), style = animationStyle(document.style), target = document.entries.find(entry => entry.id === selectedId);
  if (!target) throw Error('请先选择要合成的角色条目。');
  let entries = document.entries, entryIds: string[];
  if (kind === 'atlas') {
    if (document.mode !== 'atlas' && style.route !== 'light') throw Error('完整动作或双状态风格请采用按顺序准备好的独立画面。');
    if (!document.referenceArtifactIds.length) throw Error('请先上传一张已经排好网格的静态图集。');
    if (entries.length > document.columns * document.rows) throw Error(`当前 ${document.columns} × ${document.rows} 图集容纳不了 ${entries.length} 个条目，请先调整网格或减少份数。`);
    entries = entries.map((entry, index): AnimationEntry => ({ ...entry, status: 'stale', error: undefined, frames: [{ id: `local-${entry.id.slice(0, 110)}-1`, atlasArtifactId: document.referenceArtifactIds[0], cell: [index % document.columns, Math.floor(index / document.columns)], grid: [document.columns, document.rows], durationMs: document.loopMs }] }));
    entryIds = entries.map(entry => entry.id);
  } else {
    if (document.mode === 'atlas' || style.route === 'light') throw Error('当前用途请显式采用已有图集，并确认网格。');
    const count = style.route === 'keyframes' ? style.framesPerEntry : 2;
    if (document.referenceArtifactIds.length < count) throw Error(`此风格需要至少 ${count} 张按顺序准备好的独立画面，当前有 ${document.referenceArtifactIds.length} 张。`);
    const durations = animationFrameDurations(Array(count).fill(1) as number[], document.loopMs);
    entries = entries.map((entry): AnimationEntry => entry.id !== selectedId ? entry : { ...entry, status: 'stale', error: undefined, frames: document.referenceArtifactIds.slice(0, count).map((atlasArtifactId, index): AnimationFrame => ({ id: `local-${entry.id.slice(0, 110)}-${index + 1}`, atlasArtifactId, cell: [0, 0], grid: [1, 1], durationMs: durations[index] })) });
    entryIds = [selectedId];
  }
  const next = checkedAnimationDocument({ ...document, acceptedSampleId: undefined, entries });
  next.entries = next.entries.map(entry => entryIds.includes(entry.id) ? { ...entry, sourceHash: animationArtHash(next, [entry.id]) } : entry);
  return { document: next, entryIds };
}
