import type { AnimationDocument, AnimationEntry, AnimationFrame, AnimationMotion, AnimationStyle } from '../animation-types';
import { ANIMATION_STYLES } from './animation-styles';

export const ANIMATION_MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const ANIMATION_MAX_ENTRIES = 100;
export const ANIMATION_MAX_FRAMES = 120;
export const ANIMATION_MAX_PIXELS = 48000000;
export const animationId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit: number, empty = true): value is string => typeof value === 'string' && value.length <= limit && (empty || !!value.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const integer = (value: unknown, low: number, high: number): value is number => Number.isSafeInteger(value) && Number(value) >= low && Number(value) <= high;
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const ANIMATION_MOTIONS: readonly AnimationMotion[] = ['nod','jump','sway','startle','tremble','ponder','breathe','stomp','rush','peek','pulse','pop','offer','lean','droop','dance'];

function checkedFrame(input: unknown): AnimationFrame {
  if (!object(input) || !animationId(input.id) || !animationId(input.atlasArtifactId) || !Array.isArray(input.cell) || input.cell.length !== 2 || !Array.isArray(input.grid) || input.grid.length !== 2 || input.grid.some(value => !integer(value, 1, 16)) || input.grid[0] * input.grid[1] > 120 || input.cell.some((value, index) => !integer(value, 0, Number((input.grid as unknown[])[index]) - 1)) || !integer(input.durationMs, 10, 6000) || input.durationMs % 10 !== 0) throw Error('动画关键帧的来源、格数或时长无效。');
  let crop: [number, number, number, number] | undefined;
  if (input.crop !== undefined) { if (!Array.isArray(input.crop) || input.crop.length !== 4 || input.crop.some(value => !integer(value, 0, 16384)) || input.crop[2] <= input.crop[0] || input.crop[3] <= input.crop[1] || (input.crop[2] - input.crop[0]) * (input.crop[3] - input.crop[1]) > 16777216) throw Error('关键帧裁切框无效。'); crop = [...input.crop] as [number, number, number, number]; }
  return { id: input.id, atlasArtifactId: input.atlasArtifactId, cell: [...input.cell] as [number, number], grid: [...input.grid] as [number, number], ...(crop ? { crop } : {}), durationMs: input.durationMs };
}

function checkedEntry(input: unknown): AnimationEntry {
  if (!object(input) || !animationId(input.id) || !text(input.caption, 120) || !text(input.description, 4000) || !ANIMATION_MOTIONS.includes(input.motion as AnimationMotion) || !Array.isArray(input.frames) || input.frames.length > ANIMATION_MAX_FRAMES || !['draft','ready','stale','failed'].includes(String(input.status))) throw Error('角色条目内容、动作或状态无效。');
  for (const key of ['outputArtifactId', 'coverArtifactId']) if (input[key] !== undefined && !animationId(input[key])) throw Error('角色条目关联了无效产物。');
  for (const key of ['sourceHash', 'renderedHash']) if (input[key] !== undefined && !hash(input[key])) throw Error('角色条目版本指纹无效。');
  if (input.error !== undefined && !text(input.error, 2000)) throw Error('角色条目的错误记录无效。');
  let inspection: AnimationEntry['inspection'];
  if (input.inspection !== undefined) { const value = input.inspection; if (!object(value) || !integer(value.width, 1, 4096) || !integer(value.height, 1, 4096) || !integer(value.frames, 1, ANIMATION_MAX_FRAMES) || value.width * value.height * value.frames > ANIMATION_MAX_PIXELS || !integer(value.loopMs, 0, 6000) || typeof value.transparent !== 'boolean' || !Array.isArray(value.warnings) || value.warnings.length > 20 || value.warnings.some(warning => !text(warning, 500))) throw Error('动画实际检查报告无效。'); inspection = { width: value.width, height: value.height, frames: value.frames, loopMs: value.loopMs, transparent: value.transparent, warnings: [...value.warnings] as string[] }; }
  const frames = input.frames.map(checkedFrame); if (new Set(frames.map(frame => frame.id)).size !== frames.length) throw Error('动画关键帧编号重复。');
  return { id: input.id, caption: input.caption, description: input.description, motion: input.motion as AnimationMotion, frames, status: input.status as AnimationEntry['status'], ...(input.outputArtifactId ? { outputArtifactId: input.outputArtifactId as string } : {}), ...(input.coverArtifactId ? { coverArtifactId: input.coverArtifactId as string } : {}), ...(input.sourceHash ? { sourceHash: input.sourceHash as string } : {}), ...(input.renderedHash ? { renderedHash: input.renderedHash as string } : {}), ...(input.error ? { error: input.error } : {}), ...(inspection ? { inspection } : {}) };
}

export function checkedAnimationDocument(input: unknown, projectId?: string): AnimationDocument {
  if (!object(input) || input.version !== 1 || !animationId(input.projectId) || projectId && input.projectId !== projectId || !integer(input.revision, 0, Number.MAX_SAFE_INTEGER - 1) || !text(input.title, 160, false) || !['atlas','gif'].includes(String(input.mode)) || !ANIMATION_STYLES.some(style => style.id === input.style) || !text(input.prompt, 20000)) throw Error('角色动画工程无效或不属于当前项目，原稿仍保留。');
  if (!Array.isArray(input.referenceArtifactIds) || input.referenceArtifactIds.length > 12 || input.referenceArtifactIds.some(id => !animationId(id)) || new Set(input.referenceArtifactIds).size !== input.referenceArtifactIds.length || !(input.modelConfigId === '' || animationId(input.modelConfigId)) || !(input.credentialId === '' || animationId(input.credentialId))) throw Error('角色参考图或模型配置无效。');
  const gif = input.mode === 'gif', maximumSide = gif ? 3840 : 4096, maximumPixels = gif ? 8294400 : 16777216;
  const style = ANIMATION_STYLES.find(style => style.id === input.style)!, sampled = style.route !== 'keyframes';
  const plannedFrames = gif ? sampled ? Math.ceil(Number(input.loopMs) * Number(input.fps) / 1000) : style.framesPerEntry : 1;
  if (!integer(input.width, 16, maximumSide) || !integer(input.height, 16, maximumSide) || input.width * input.height > maximumPixels || typeof input.fps !== 'number' || !Number.isFinite(input.fps) || input.fps < 1 || input.fps > 50 || !integer(input.loopMs, 100, 6000) || input.loopMs % 10 !== 0 || gif && (sampled && Math.round(input.loopMs * input.fps / 1000) < 2 || plannedFrames > ANIMATION_MAX_FRAMES) || input.width * input.height * plannedFrames > ANIMATION_MAX_PIXELS || !['transparent','opaque'].includes(String(input.background)) || !integer(input.columns, 1, 16) || !integer(input.rows, 1, 16) || input.columns * input.rows > 120) throw Error('动画尺寸、时长、帧数或累计像素超出支持范围，请降低规格。');
  if (!Array.isArray(input.entries) || !input.entries.length || input.entries.length > ANIMATION_MAX_ENTRIES || typeof input.updatedAt !== 'string' || input.updatedAt.length > 40 || !/T/.test(input.updatedAt) || !Number.isFinite(Date.parse(input.updatedAt))) throw Error('角色动画条目或保存时间无效。');
  const entries = input.entries.map(checkedEntry); if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw Error('角色条目编号重复。');
  for (const entry of entries) if (entry.frames.length && (input.width * input.height * entry.frames.length > ANIMATION_MAX_PIXELS || entry.frames.reduce((total, frame) => total + frame.durationMs, 0) > 6000)) throw Error('角色关键帧的累计时长或像素超出支持范围。');
  if (input.acceptedSampleId !== undefined && (!animationId(input.acceptedSampleId) || !entries.some(entry => entry.id === input.acceptedSampleId))) throw Error('认可样片不属于当前角色列表。');
  const document: AnimationDocument = { version: 1, projectId: input.projectId, revision: input.revision, title: input.title.trim(), mode: input.mode as AnimationDocument['mode'], style: input.style as AnimationStyle, prompt: input.prompt, referenceArtifactIds: [...input.referenceArtifactIds] as string[], modelConfigId: input.modelConfigId as string, credentialId: input.credentialId as string, width: input.width, height: input.height, fps: input.fps, loopMs: input.loopMs, background: input.background as AnimationDocument['background'], columns: input.columns, rows: input.rows, entries, ...(input.acceptedSampleId ? { acceptedSampleId: input.acceptedSampleId } : {}), updatedAt: input.updatedAt };
  if (new TextEncoder().encode(JSON.stringify(document)).length > ANIMATION_MAX_DOCUMENT_BYTES) throw Error('角色动画工程超过4MB，请分成不同项目保存。');
  return document;
}
