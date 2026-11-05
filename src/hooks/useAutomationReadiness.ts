import { useEffect, useMemo, useRef, useState } from 'react';
import type { PageProps } from '../types';
import type { AutomationJob, AutomationRule } from '../automation-types';
import type { WorkflowDefinition } from '../configuration-types';
import type { NaturalAutomationBindings } from '../lib/natural-automation-plan';
import { naturalBoundWorkflow, naturalEffectiveBindings, naturalQuestionAnswer, naturalRuleInput } from '../lib/natural-automation-composer-state';
import { naturalCapabilityLabel, naturalModelSelection } from '../components/NaturalAutomationModels';
import { useRecoveryDraft } from './useRecoveryDraft';
import { registerEditorSession } from '../lib/editor-session-guard';
import { useRememberedBoolean } from './useRememberedBoolean';
import { dispatchAutomationOnce, readAutomationDispatch, readAutomationSnapshot, type AutomationActionResult } from '../lib/automation-dispatch';

export function useAutomationReadiness(props: PageProps, rule: AutomationRule | undefined, workflow: WorkflowDefinition | undefined, onSaved: (rule: AutomationRule) => void, onRun?: (job: AutomationJob) => void) {
  const [answers, setAnswers] = useState<Record<string, string>>({}), [bindings, setBindings] = useState<NaturalAutomationBindings>({}), [busy, setBusy] = useState(false), [errors, setErrors] = useState<string[]>([]);
  const [expanded, setExpanded] = useRememberedBoolean(`workspace:${props.workspaceId}:rule:${rule?.id || 'draft'}:readiness-expanded`, false);
  const owner = useRef(''), mounted = useRef(true), pending = useRef(false), current = useRef({ props, rule, workflow, answers, bindings, onSaved, onRun }); current.current = { props, rule, workflow, answers, bindings, onSaved, onRun };
  const [loadedId, setLoadedId] = useState('');
  const [lastJob, setLastJob] = useState<AutomationJob>(), [dispatchUnknown, setDispatchUnknown] = useState(false), [dispatchLoading, setDispatchLoading] = useState(false);
  const [dispatchError, setDispatchError] = useState('');
  const [dispatchScope, setDispatchScope] = useState(''), [dispatchLoadingScope, setDispatchLoadingScope] = useState('');
  const dispatchGeneration = useRef(0);
  const [changedCapabilities, setChangedCapabilities] = useState<(keyof NaturalAutomationBindings)[]>([]), [originRevision, setOriginRevision] = useState(''), [originFlow, setOriginFlow] = useState('');
  const recoveryKey = `xuzuo-automation-readiness-v1:${props.workspaceId}:${rule?.id || ''}`;
  const panelRef = useRef<HTMLElement>(null);
  const reveal = () => { setExpanded(true); requestAnimationFrame(() => panelRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })); };
  const flowFingerprint = (value: WorkflowDefinition) => JSON.stringify(value.steps.map(step => [step.id, step.modelConfigId, step.credentialId]));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!rule || !workflow || owner.current === rule.id) return;
    owner.current = rule.id;
    const initial: NaturalAutomationBindings = {};
    for (const step of workflow.steps) if (['text', 'vision', 'image-generation', 'image-editing'].includes(step.kind) && !initial[step.kind as keyof NaturalAutomationBindings]) initial[step.kind as keyof NaturalAutomationBindings] = { modelConfigId: step.modelConfigId, credentialId: step.credentialId };
    let restored: { answers?: Record<string, string>; bindings?: NaturalAutomationBindings; changedCapabilities?: (keyof NaturalAutomationBindings)[] } | undefined;
    const fingerprint = flowFingerprint(workflow);
    try { const raw = localStorage.getItem(recoveryKey), value = raw ? JSON.parse(raw) : undefined; if (value?.version === 1 && value.ruleId === rule.id && value.updatedAt === rule.updatedAt && value.workflowFingerprint === fingerprint && value.answers && typeof value.answers === 'object' && !Array.isArray(value.answers) && Object.values(value.answers).every(answer => typeof answer === 'string') && value.bindings && typeof value.bindings === 'object' && !Array.isArray(value.bindings)) restored = value; } catch { /* The authoritative rule still supplies the saved values. */ }
    setAnswers(restored?.answers || rule.preparation?.answers || {}); setBindings(restored?.bindings || initial); setChangedCapabilities(Array.isArray(restored?.changedCapabilities) ? restored.changedCapabilities.filter(capability => ['text', 'vision', 'image-generation', 'image-editing'].includes(capability)) : []); setOriginRevision(rule.updatedAt); setOriginFlow(fingerprint); setLoadedId(rule.id); setErrors([]);
  }, [rule?.id, workflow?.id]);
  const recovery = useRecoveryDraft(recoveryKey, { version: 1, ruleId: rule?.id, updatedAt: originRevision, workflowFingerprint: originFlow, changedCapabilities, answers, bindings }, !!rule && loadedId === rule.id, '序作-运行设置恢复稿.json');
  const recoveryRef = useRef(recovery); recoveryRef.current = recovery;
  useEffect(() => !rule ? undefined : registerEditorSession({ id: `automation-readiness-${rule.id}`, projectId: rule.projectId, label: '自动化运行设置', getState: () => ({ dirty: true, pending: pending.current, persistenceError: recoveryRef.current.error || undefined }), save: async () => recoveryRef.current.retry(), exportRecovery: () => recoveryRef.current.exportDraft(), flushRecovery: () => recoveryRef.current.retry() }), [rule?.id]);
  const effective = useMemo(() => naturalEffectiveBindings(props.configuration, bindings, bindings.text || {}), [bindings, props.configuration.models, props.configuration.connections, props.configuration.credentials]);
  const capabilities = [...new Set((workflow?.steps || []).filter(step => step.enabled && ['text', 'vision', 'image-generation', 'image-editing'].includes(step.kind)).map(step => step.kind as keyof NaturalAutomationBindings))];
  const missing = capabilities.flatMap(capability => {
    const steps = workflow?.steps.filter(step => step.enabled && step.kind === capability) || [];
    const invalid = changedCapabilities.includes(capability) ? [naturalModelSelection(props.configuration, capability, effective[capability])] : steps.map(step => naturalModelSelection(props.configuration, capability, step.modelConfigId || step.credentialId ? { modelConfigId: step.modelConfigId, credentialId: step.credentialId } : effective[capability]));
    const first = invalid.find(selected => !selected.model || !selected.credentialId);
    return first ? [`${naturalCapabilityLabel[capability]}：${!first.model ? '请选择可用模型' : '请选择对应的 Key'}，同类步骤可在这里一次补齐`] : [];
  });
  const questions = rule?.preparation?.questions || [], unanswered = questions.filter(question => !naturalQuestionAnswer(answers, question).trim());
  const project = props.projects.find(project => project.id === rule?.projectId && !project.purgedAt && !project.trashedAt);
  async function readDispatch() {
    const source = current.current, bridge = window.desktop?.automation; if (!source.rule || !bridge) return;
    const generation = ++dispatchGeneration.current;
    setDispatchLoadingScope(`${source.props.workspaceId}/${source.rule.id}`); setDispatchLoading(true);
    try {
      const snapshot = await readAutomationSnapshot(bridge, source.props.workspaceId), state = readAutomationDispatch(localStorage, source.props.workspaceId, source.rule.id, snapshot.jobs);
      if (generation === dispatchGeneration.current && mounted.current && current.current.rule?.id === source.rule.id && current.current.props.workspaceId === source.props.workspaceId) { setDispatchScope(`${source.props.workspaceId}/${source.rule.id}`); setLastJob(state.job); setDispatchUnknown(state.unknown); setDispatchError(state.unknown ? '上次提交是否受理尚未确认，请读取任务状态，不会自动重发。' : ''); }
    } catch (cause) { if (generation === dispatchGeneration.current && mounted.current && current.current.rule?.id === source.rule.id && current.current.props.workspaceId === source.props.workspaceId) { setDispatchScope(`${source.props.workspaceId}/${source.rule.id}`); setDispatchUnknown(true); setDispatchError(cause instanceof Error ? cause.message : '任务状态暂时无法读取，请重试读取，不要重复提交。'); } }
    finally { if (generation === dispatchGeneration.current && mounted.current && current.current.rule?.id === source.rule.id) setDispatchLoading(false); }
  }
  useEffect(() => {
    if (!rule) return;
    void readDispatch();
    const unsubscribe = window.desktop?.automation?.onChanged?.(() => { void readDispatch(); });
    return () => { dispatchGeneration.current++; unsubscribe?.(); };
  }, [rule?.id, props.workspaceId]);
  async function perform(action: 'save' | 'run' | 'enable' | 'pause', options: { reuseCompleted?: boolean } = {}): Promise<AutomationActionResult> {
    if (pending.current) return { status: 'failed' };
    const source = current.current, bridge = window.desktop?.automation;
    if (!source.rule || !source.workflow || !bridge || !project || loadedId !== source.rule.id) { setErrors(['请先创建自动化，并等待当前运行设置读取完成。']); return { status: 'needs-input' }; }
    if (action !== 'save' && action !== 'pause' && (missing.length || unanswered.length)) { setErrors([...missing, ...unanswered.map(question => `请补充：${question}`)]); reveal(); return { status: 'needs-input' }; }
    pending.current = true; setBusy(true); setErrors([]);
    const stillCurrent = () => mounted.current && current.current.props.workspaceId === source.props.workspaceId && current.current.rule?.id === source.rule?.id;
    try {
      if (action === 'pause') { await bridge.setEnabled({ id: source.rule.id, enabled: false }); const snapshot = await bridge.snapshot(source.props.workspaceId), updated = snapshot.rules.find(item => item.id === source.rule!.id); if (stillCurrent() && updated) { setOriginRevision(updated.updatedAt); source.onSaved(updated); } return { status: 'saved' }; }
      const authoritative = (await readAutomationSnapshot(bridge, source.props.workspaceId)).rules.find(rule => rule.id === source.rule!.id);
      if (!stillCurrent()) return { status: 'failed' };
      if (!authoritative) throw Error('当前规则暂时无法读取，请先读取原记录，尚未开始制作。');
      if (authoritative.enabled) throw Error('这条自动化仍在自动运行，请先在自动化设置中暂停，再调整或试运行。');
      if (!recovery.retry()) throw Error('运行设置草稿未能保存，请先重试保存或导出恢复稿。');
      const bound = naturalBoundWorkflow(source.workflow, source.props.configuration, naturalEffectiveBindings(source.props.configuration, source.bindings, source.bindings.text || {}), changedCapabilities);
      const input = naturalRuleInput({ questions } as Parameters<typeof naturalRuleInput>[0], source.rule.input, source.answers);
      const attachments = (project.referenceFiles || []).map(file => file.id);
      if (action === 'run') {
        const check = await source.props.workflowRunner.preflight(bound, project.id, input, source.rule.variables, attachments);
        if (!check.ok) { if (stillCurrent()) { setErrors(check.errors); reveal(); } return { status: 'needs-input' }; }
      }
      const changed = source.workflow.steps.some((step, index) => step.modelConfigId !== bound.steps[index].modelConfigId || step.credentialId !== bound.steps[index].credentialId);
      if (changed && !source.props.configuration.saveWorkflow(bound, bound.id, { silent: true })) throw Error('调用设置未能可靠保存，原流程和费用保留。');
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (!stillCurrent()) return { status: 'failed' };
      const latest = current.current.props;
      await bridge.syncContext({ workspaceId: source.props.workspaceId, workspaces: latest.workspaces, projects: latest.projects, workflows: latest.configuration.workflows.map(item => item.id === bound.id ? bound : item), models: latest.configuration.models, connections: latest.configuration.connections });
      const updated = await bridge.saveRule({ ...source.rule, id: source.rule.id, enabled: false, input, preparation: { questions, answers: Object.fromEntries(questions.map(question => [question, naturalQuestionAnswer(source.answers, question)])) } });
      if (!stillCurrent()) return { status: 'failed' };
      setOriginRevision(updated.updatedAt); setOriginFlow(flowFingerprint(bound)); setChangedCapabilities([]);
      source.onSaved(updated);
      if (action === 'run') {
        const result = await dispatchAutomationOnce(bridge, localStorage, source.props.workspaceId, updated.id, { ...options, isCurrent: stillCurrent });
        if (stillCurrent()) { setDispatchScope(`${source.props.workspaceId}/${source.rule.id}`); setDispatchUnknown(result.status === 'unknown'); setDispatchError(result.error || ''); if (result.job) setLastJob(result.job); if (result.job) { source.props.notify(result.status === 'started' ? '制作任务已启动，实际调用费用会逐次记录。' : '已找到原制作任务，没有重复提交。'); source.onRun?.(result.job); } }
        return result;
      }
      else if (action === 'enable') { await bridge.setEnabled({ id: updated.id, enabled: true }); const snapshot = await bridge.snapshot(source.props.workspaceId), enabled = snapshot.rules.find(item => item.id === updated.id); if (stillCurrent() && enabled) { setOriginRevision(enabled.updatedAt); source.onSaved(enabled); source.props.notify('自动触发已启用。'); } }
      else source.props.notify('运行设置已保存，没有调用 AI。');
      return { status: 'saved' };
    } catch (cause) { const error = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '操作未完成，原流程和费用保留。'; if (stillCurrent()) { setErrors([error]); reveal(); } return { status: 'failed', error }; }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function addReferences() {
    if (!project || pending.current) return;
    if (rule?.enabled) { setErrors(['请先暂停自动触发，再添加新的制作资料。']); return; }
    pending.current = true; setBusy(true);
    try { const files = await props.workflowRunner.importFiles(project.id); if (mounted.current && current.current.rule?.projectId === project.id && files.length) props.onUpdateProject(project.id, { referenceFiles: [...(project.referenceFiles || []), ...files.map(file => ({ id: file.id, name: file.name, mimeType: file.mimeType, bytes: file.bytes, kind: file.kind }))] }); }
    catch (cause) { if (mounted.current) setErrors([cause instanceof Error ? cause.message : '资料未能添加，原文件和费用保留。']); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  const setCapability = (capability: keyof NaturalAutomationBindings, value: NonNullable<NaturalAutomationBindings[keyof NaturalAutomationBindings]>) => { setBindings(previous => ({ ...previous, [capability]: value })); setChangedCapabilities(previous => previous.includes(capability) ? previous : [...previous, capability]); };
  const mixed = capabilities.some(capability => new Set(workflow?.steps.filter(step => step.kind === capability).map(step => `${step.modelConfigId}:${step.credentialId}`)).size > 1);
  const scope = `${props.workspaceId}/${rule?.id || ''}`, ownsDispatch = !!rule && dispatchScope === scope;
  return { answers, setAnswers, bindings: effective, setCapability, mixed, expanded, setExpanded, panelRef, reveal, busy, loadedRuleId: loadedId, lastJob: lastJob && lastJob.ruleId === rule?.id && lastJob.workspaceId === props.workspaceId ? lastJob : undefined, dispatchUnknown: ownsDispatch && dispatchUnknown, dispatchLoading: dispatchLoadingScope === scope && dispatchLoading, readDispatch, errors: [...(owner.current === rule?.id ? errors : []), ...(ownsDispatch && dispatchError ? [dispatchError] : []), ...(recovery.error ? [recovery.error] : [])], missing, unanswered, questions, capabilities, project, perform, addReferences, remaining: missing.length + unanswered.length };
}
