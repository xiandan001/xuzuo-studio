import { hasManagedDialog } from '../lib/dialog-stack';
import { ModalPortal } from './ModalPortal';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { AudioLines, Download, FileText, GitBranch, Image, ShieldCheck, Video, X } from 'lucide-react';
import type { BusinessCategory, ModelCapability, WorkflowRun, WorkflowStep, WorkflowStepKind } from '../configuration-types';
import type { ArtifactMetadata, LivePreflightIssue } from '../live-types';
import { isSelectInteraction } from './Select';
import { CREATION_PROFILES } from '../lib/creation-profiles';
import { defaultAnimationWorkflowSettings } from '../lib/animation-workflow';
import '../pages/workflows.css';

export const STEP_KINDS: { value: WorkflowStepKind; label: string; description: string }[] = [
  { value: 'text', label: '文本创作', description: '整理资料、撰写内容与结构化输出' },
  { value: 'vision', label: '图片理解', description: '检查参考图、内容或画面细节' },
  { value: 'image-generation', label: '图片生成', description: '根据文字需求制作图像' },
  { value: 'image-editing', label: '图片精修', description: '结合参考内容描述图片修改' },
  { value: 'animation-compose', label: '本地动画合成', description: '从实际PNG图集生成角色素材或GIF，不调用模型' },
  { value: 'transcription', label: '语音转文字', description: '设计音频转录步骤' },
  { value: 'speech', label: '语音合成', description: '设计文字转语音步骤' },
  { value: 'video-understanding', label: '视频理解', description: '设计视频内容分析步骤' },
  { value: 'video-generation', label: '视频生成', description: '设计视频制作步骤' },
  { value: 'manual-review', label: '人工检查', description: '暂停流程，由你确认再继续' },
  { value: 'export', label: '整理交付', description: '整理当前结果并生成交付文件' },
];
export const RUN_LABELS: Record<WorkflowRun['status'], string> = { running: '模拟执行中', paused: '已暂停', 'waiting-review': '等待人工检查', complete: '模拟已完成', cancelled: '已取消', interrupted: '已中断', failed: '执行失败' };
export const isModelStep = (kind: WorkflowStepKind): kind is ModelCapability => !['manual-review', 'export', 'animation-compose'].includes(kind);
export const kindLabel = (kind: WorkflowStepKind) => STEP_KINDS.find(item => item.value === kind)?.label || kind;
export type RunContext = { projectId?: string; input?: string; attachmentIds?: string[]; attachments?: InputAttachment[]; variables?: Record<string, string>; mode?: 'live' | 'simulation'; focusStepId?: string; focusField?: LivePreflightIssue['field']; replaceWaitingReviewRunId?: string; };
export type InputAttachment = Pick<ArtifactMetadata, 'id' | 'name'> & Partial<Pick<ArtifactMetadata, 'mimeType' | 'bytes'>>;

export function StepIcon({ kind, size = 17 }: { kind: WorkflowStepKind; size?: number }) {
  const Icon = kind === 'manual-review' ? ShieldCheck : kind === 'export' ? Download : kind === 'animation-compose' || kind.startsWith('image') || kind === 'vision' ? Image : kind.startsWith('video') ? Video : kind === 'speech' || kind === 'transcription' ? AudioLines : FileText;
  return <Icon size={size} />;
}

export function categoryOptions(categories: BusinessCategory[]) {
  const active = categories.filter(category => !category.archived);
  return active.filter(category => !category.parentId).flatMap(parent => [
    { id: parent.id, label: parent.name },
    ...active.filter(category => category.parentId === parent.id).map(child => ({ id: child.id, label: `${parent.name} / ${child.name}` })),
  ]);
}
export function makeStep(kind: WorkflowStepKind = 'text'): WorkflowStep {
  return { id: crypto.randomUUID(), name: kindLabel(kind), kind, prompt: '', modelConfigId: undefined, inputSource: 'previous', budgetCents: undefined, enabled: true, maxOutputTokens: kind === 'text' ? CREATION_PROFILES.word.outputTokens : 2048, imageSize: kind === 'video-generation' ? '1280x720' : '1024x1024', imageBackground: 'auto', voice: 'alloy', count: 1, ...(kind === 'animation-compose' ? { animation: defaultAnimationWorkflowSettings() } : {}) };
}
export function normalizeSteps(steps: WorkflowStep[]) {
  const first = steps.findIndex(step => step.enabled);
  return steps.map((step, index) => index === first ? { ...step, inputSource: 'project' as const } : step);
}

export function WorkflowDialog({ title, subtitle, children, footer, onClose, className = '', busy = false }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode; onClose: () => void; className?: string; busy?: boolean }) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const busyRef = useRef(busy); busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>('input:not(:disabled):not([aria-hidden="true"]), textarea:not(:disabled), [role="combobox"]:not(:disabled)')?.focus());
    const handle = (event: KeyboardEvent) => {
      if (hasManagedDialog()) return;
      if ((event.key === 'Escape' || event.key === 'Tab') && isSelectInteraction(event)) return;
      if (Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).at(-1) !== panelRef.current) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busyRef.current) closeRef.current(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([aria-hidden="true"]), textarea:not(:disabled), [tabindex="0"]') || []).filter(control => control.offsetParent !== null);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', handle, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', handle, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <ModalPortal onClose={onClose} busy={busy}><div className="wf-overlay" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}><section ref={panelRef} className={`wf-dialog ${className}`} role="dialog" aria-modal="true" aria-label={title}><header><span className="wf-dialog-icon"><GitBranch size={22} /></span><div><h2>{title}</h2><p>{subtitle}</p></div><button className="btn-icon" disabled={busy} aria-label={`关闭${title}`} onClick={onClose}><X size={20} /></button></header>{children}{footer && <footer>{footer}</footer>}</section></div></ModalPortal>;
}
