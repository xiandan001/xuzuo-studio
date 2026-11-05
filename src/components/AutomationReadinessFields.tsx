import { CheckCircle2, Paperclip, ChevronDown } from 'lucide-react';
import type { PageProps } from '../types';
import type { AutomationRule } from '../automation-types';
import type { useAutomationReadiness } from '../hooks/useAutomationReadiness';
import { NaturalAutomationModels } from './NaturalAutomationModels';
import { RememberedDetails } from './RememberedDetails';
import { naturalQuestionAnswer } from '../lib/natural-automation-composer-state';

export function AutomationReadinessFields({ props, rule, state }: { props: PageProps; rule: AutomationRule; state: ReturnType<typeof useAutomationReadiness> }) {
  const disabled = state.busy || rule.enabled;
  return <section ref={state.panelRef} className="natural-run-setup" aria-label="运行前补充设置"><button className="natural-setup-toggle" type="button" onClick={() => state.expanded ? state.setExpanded(false) : state.reveal()} aria-expanded={state.expanded}><span><CheckCircle2 size={18} />{state.remaining ? `运行前还需补充 ${state.remaining} 项 · 不影响创建` : '运行设置已就绪'}</span><ChevronDown size={16} /></button>
    {state.expanded && <div className="natural-setup-body">{rule.enabled && <div className="natural-attention">自动触发已启用。调整资料或模型前请先暂停。<button type="button" className="text-button" onClick={() => { void state.perform('pause'); }}>暂停自动触发</button></div>}
      <button className="btn btn-secondary" type="button" disabled={disabled} onClick={() => { void state.addReferences(); }}><Paperclip size={15} />添加参考资料{state.project?.referenceFiles?.length ? ` · 已有 ${state.project.referenceFiles.length} 份` : ''}</button>
      {!!state.questions.length && <fieldset disabled={disabled}><legend>制作资料 · 本地填写，不重新规划</legend>{state.questions.map((question, index) => <label key={question}>{question}<textarea aria-label={`制作资料回答 ${index + 1}`} rows={2} maxLength={10000} value={naturalQuestionAnswer(state.answers, question)} onChange={event => state.setAnswers(values => ({ ...values, [question]: event.target.value }))} /><button className="text-button" type="button" disabled={!state.project?.referenceFiles?.length} onClick={() => state.setAnswers(values => ({ ...values, [question]: '答案在本项目已导入的资料中，请按真实资料制作，缺失内容须列出并人工确认。' }))}>答案在项目资料中</button></label>)}</fieldset>}
      <RememberedDetails rememberKey={`rule:${rule.id}:readiness-models`} defaultOpen={state.missing.length > 0}><summary>{state.missing.length ? `补充 ${state.missing.length} 项模型设置` : '模型设置已带入 · 按需更换'}</summary><fieldset disabled={disabled}><legend>相同兼容模型已自动复用</legend>{state.mixed && <small>各步骤原有的独立模型会保留。只有在这里明确换选，才会统一替换这一类步骤；也可在“我的工作流”逐步调整。</small>}{state.capabilities.map(capability => <NaturalAutomationModels key={capability} configuration={props.configuration} capability={capability} value={state.bindings[capability] || {}} disabled={disabled} onChange={value => state.setCapability(capability, value)} />)}<button type="button" className="text-button" onClick={() => props.navigate('models')}>需要添加新模型？前往模型中心</button></fieldset></RememberedDetails>
      <button className="btn btn-secondary" disabled={state.busy || rule.enabled} onClick={() => { void state.perform('save'); }}>保存运行设置 · 不调用 AI</button>
    </div>}
    {!!state.errors.length && <div className="natural-attention" role="alert"><strong>请先处理下面这些内容</strong><ul>{state.errors.map((error, index) => <li key={index}>{error}</li>)}</ul><button type="button" className="text-button" onClick={state.reveal}>在这里补充</button></div>}
  </section>;
}
