import type { ModelCapability, WorkflowStep } from '../configuration-types';
import type { LedgerEntry, ProjectKind } from '../types';
import { validImageQuantity } from './image-quantity';
import type { WallpaperTarget } from '../wallpaper-types';
import { readWallpaperTarget, wallpaperTargetIssue } from './wallpaper-target';

function defaultLocalStep(kind: 'manual-review' | 'export'): WorkflowStep {
  return { id: crypto.randomUUID(), name: kind === 'export' ? '生成实际交付文件' : '人工检查实际结果', kind, prompt: '', inputSource: 'previous', budgetCents: undefined, enabled: true };
}

function isUnchangedDefaultStep(step: WorkflowStep, kind: 'manual-review' | 'export'): boolean {
  const allowed = new Set(['id', 'name', 'kind', 'prompt', 'inputSource', 'budgetCents', 'enabled']);
  return step.kind === kind && step.name === (kind === 'export' ? '生成实际交付文件' : '人工检查实际结果') && step.prompt === '' && step.inputSource === 'previous' && step.budgetCents === undefined && step.enabled && Object.keys(step).every(key => allowed.has(key));
}

export function quickWorkflowTail(outputKind: ProjectKind, capability: ModelCapability, action: LedgerEntry['action'], existing?: WorkflowStep[]): WorkflowStep[] {
  const documentDelivery = outputKind !== 'image' && capability === 'text' && action !== 'AI 复核';
  if (existing) {
    if (documentDelivery && existing.length === 2 && isUnchangedDefaultStep(existing[0], 'manual-review') && isUnchangedDefaultStep(existing[1], 'export')) return [existing[1], existing[0]];
    return existing;
  }
  const review = defaultLocalStep('manual-review');
  if (action === 'AI 复核' || outputKind === 'image' && capability === 'text') return [review];
  const delivery = defaultLocalStep('export');
  return documentDelivery ? [delivery, review] : [review, delivery];
}

const imageStep = (step: WorkflowStep) => ['image-generation', 'image-editing'].includes(step.kind);
const variantPrefix = (id: string) => `quick-image-variant-${id}-`;
function ownImageSource(first: WorkflowStep, id: string): boolean { return id === first.id || id.startsWith(variantPrefix(first.id)) && /^[2-9]\d*$|^1\d+$/.test(id.slice(variantPrefix(first.id).length)); }

export function quickImageWorkflowTail(existing?: WorkflowStep[]): WorkflowStep[] | undefined {
  if (!existing) return undefined;
  const [first, ...tail] = existing;
  return first && imageStep(first) ? tail.filter(step => !(step.kind === first.kind && step.id !== first.id && ownImageSource(first, step.id))) : tail;
}

export function quickImageWorkflowBudget(existing?: WorkflowStep[]): number | undefined {
  const first = existing?.[0];
  if (!first || !imageStep(first)) return first?.budgetCents;
  const pictures = existing!.filter(step => step === first || step.kind === first.kind && ownImageSource(first, step.id));
  return pictures.some(step => step.budgetCents == null) ? undefined : pictures.reduce((sum, step) => sum + step.budgetCents!, 0);
}

function managedImageExport(step: WorkflowStep, first: WorkflowStep): boolean {
  if (step.engineeringReferenceId && step.name === '按原图尺寸保存') {
    const { engineeringReferenceId: _reference, ...plain } = step;
    return managedImageExport({ ...plain, name: '生成实际交付文件' }, first);
  }
  if (step.wallpaperTarget && step.name === '适配设备壁纸') {
    const { wallpaperTarget: _target, ...plain } = step;
    return managedImageExport({ ...plain, name: '生成实际交付文件' }, first);
  }
  if (isUnchangedDefaultStep(step, 'export')) return true;
  if (!step.contentSourceStepIds?.length || !step.contentSourceStepIds.every(id => ownImageSource(first, id))) return false;
  const { contentSourceStepIds: _sources, ...plain } = step;
  return isUnchangedDefaultStep(plain, 'export');
}

function imageVariant(first: WorkflowStep, count: number, index: number): WorkflowStep {
  const cap = first.budgetCents;
  const budgetCents = cap == null || !Number.isSafeInteger(cap) || cap < 0 ? cap : Math.floor(cap / count) + Number(index < cap % count);
  return { ...first, id: index ? `${variantPrefix(first.id)}${index + 1}` : first.id, name: `${first.name} ${index + 1}/${count}`, count: 1, inputSource: 'project', budgetCents, prompt: `${first.prompt}\n\n本次共${count}张，当前制作第${index + 1}张。本次只输出一张独立图片，不拼成多宫格。${first.kind === 'image-editing' ? '始终以本次用户提供的原始参考图为基础，不继续修改前面新生成的图片。' : ''}` };
}

export function quickImageWorkflowSteps(first: WorkflowStep, tail: WorkflowStep[], wallpaperTarget?: WallpaperTarget, engineeringReferenceId?: string): WorkflowStep[] {
  if (!imageStep(first)) return [first, ...tail];
  const count = first.count ?? 1;
  if (!validImageQuantity(count)) throw new Error('图片数量请输入1–20之间的整数。');
  const pictures: WorkflowStep[] = count === 1 ? [first] : Array.from({ length: count }, (_, index) => imageVariant(first, count, index));
  const delivery = tail.map(step => managedImageExport(step, first) && (count > 1 || step.contentSourceStepIds) ? { ...step, contentSourceStepIds: pictures.map(picture => picture.id) } : step);
  if (!wallpaperTarget && !engineeringReferenceId) return [...pictures, ...delivery];
  if (wallpaperTarget && engineeringReferenceId) throw Error('壁纸与工程P图需要分别制作，请选择一种用途。');
  const target = wallpaperTarget ? readWallpaperTarget(wallpaperTarget) : undefined;
  if (wallpaperTarget) {
    const issue = wallpaperTargetIssue(wallpaperTarget);
    if (issue || !target) throw Error(issue || '请选择壁纸设备或填写像素尺寸。');
    if (first.imageOutputFormat && first.imageOutputFormat !== 'png' || first.imageBackground === 'transparent') throw Error('壁纸请使用不透明 PNG 制作，原图片模式仍支持其他格式。');
  }
  if (engineeringReferenceId && (!/^[A-Za-z0-9-]{1,100}$/.test(engineeringReferenceId) || first.kind !== 'image-editing' || first.imageOutputFormat && first.imageOutputFormat !== 'png')) throw Error('工程P图需要至少一张静态主原图，并使用PNG图片编辑。');
  const carrier = delivery.find(step => managedImageExport(step, first)) || defaultLocalStep('export');
  const { wallpaperTarget: _oldTarget, engineeringReferenceId: _oldReference, ...plainCarrier } = carrier;
  const fitted: WorkflowStep = { ...plainCarrier, name: engineeringReferenceId ? '按原图尺寸保存' : '适配设备壁纸', ...(engineeringReferenceId ? { engineeringReferenceId } : { wallpaperTarget: target }), contentSourceStepIds: pictures.map(picture => picture.id) };
  const remainder = delivery.filter(step => step !== carrier);
  const simple = remainder.every(step => isUnchangedDefaultStep(step, 'manual-review'));
  return [...pictures, ...(simple ? [fitted, ...remainder] : delivery.includes(carrier) ? delivery.map(step => step === carrier ? fitted : step) : [fitted, ...delivery])];
}
