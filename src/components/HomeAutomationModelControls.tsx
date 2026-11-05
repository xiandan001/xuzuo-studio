import { Check, ChevronDown, Settings2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PageProps } from '../types';
import type { NaturalAutomationSession } from '../hooks/useNaturalAutomationSession';
import type { NaturalAutomationBindings } from '../lib/natural-automation-plan';
import { useRememberedBoolean } from '../hooks/useRememberedBoolean';
import { useRememberedString } from '../hooks/useRememberedString';
import { NaturalAutomationModels, naturalModelSelection, type NaturalBinding } from './NaturalAutomationModels';
import './home-model-controls.css';
import { ConversationModelPicker } from './ConversationModelPicker';

const roles: { capability: keyof NaturalAutomationBindings; label: string; description: string }[] = [
  { capability: 'text', label: '文字', description: '整理资料、写文案和生成文档正文。' },
  { capability: 'vision', label: '看图检查', description: '查看实际图片，检查文字、画面与制作要求。' },
  { capability: 'image-generation', label: '生成图片', description: '生成宣传图，或为 Word、PPT 制作配图。' },
  { capability: 'image-editing', label: '精修图片', description: '根据修改要求编辑实际原图。' },
];
export function HomeAutomationModelControls({ props, session, blocked, children, productionOpen, onProductionOpen }: { props: PageProps; session: NaturalAutomationSession; blocked: boolean; children?: ReactNode; productionOpen?: boolean; onProductionOpen?: (open: boolean) => void }) {
  const [rememberedExpanded, setRememberedExpanded] = useRememberedBoolean(`workspace:${props.workspaceId}:home-production-models`, false);
  const expanded = productionOpen ?? rememberedExpanded, setExpanded = onProductionOpen || setRememberedExpanded;
  const [tab, setTab] = useRememberedString(`workspace:${props.workspaceId}:home-production-model-tab`, 'text');
  const created = !!session.draft.ruleId;
  const capabilities = created ? session.readiness.capabilities : roles.map(role => role.capability);
  const availableRoles = roles.filter(role => !created || capabilities.includes(role.capability));
  const active = availableRoles.find(role => role.capability === tab) || availableRoles[0];
  const bindings = created ? session.readiness.bindings : session.bindings;
  const configured = availableRoles.filter(role => { const selected = naturalModelSelection(props.configuration, role.capability, bindings[role.capability]); return selected.model && selected.credentialId; }).length;
  const productionLocked = blocked || !!session.targetPurged || !!session.savedRule?.enabled || !created && session.frozen;
  const plannerReady = !!session.selected.model && !!session.selected.credentialId;
  function choosePlanner(value: NaturalBinding) {
    try { session.store.persist({ ...session.store.current.current, planner: value }); session.setError(''); }
    catch (cause) { session.setError(cause instanceof Error ? cause.message : '模型选择尚未保存，请重试。'); }
  }
  return <div className="home-model-controls" role="group" aria-label="发送前模型设置">
    <div className="home-model-toolbar"><ConversationModelPicker configuration={props.configuration} value={session.draft.planner} disabled={blocked} onChange={choosePlanner} /><button className={`home-production-toggle ${expanded ? 'active' : ''}`} type="button" aria-label="提前选择制作模型" aria-expanded={expanded} disabled={blocked} title="制作时使用的模型；选择和保存设置不调用 AI" onClick={() => setExpanded(!expanded)}><Settings2 size={15} /><span>制作设置</span><small className="home-production-count">{configured}/{availableRoles.length}</small><ChevronDown size={14} /></button>{children}</div>
    {(!plannerReady || blocked) && <p className={`home-model-hint ${!plannerReady ? 'needs-model' : ''}`}>{session.targetPurged ? '保存项目已永久删除，历史费用保留。请新建对话制作新作品。' : blocked ? '本轮正在处理，结束后可更换下一轮使用的模型。' : plannerReady ? '对话模型理解和调整方案；制作模型负责后续文字、配图与精修。' : '先选择对话模型和对应 Key，再发送需求。'}{!plannerReady && !session.targetPurged && <button className="text-button" type="button" onClick={() => props.navigate('models')}>录入模型 / Key</button>}</p>}
    {expanded && <div className="home-production-panel" role="group" aria-label="提前选择制作模型设置"><div className="home-production-heading"><strong>{created ? '当前流程的制作模型' : '提前选好制作模型'}</strong><span>选择与保存设置不产生调用费用</span></div>{created && session.readiness.mixed && <p className="home-model-hint">各步骤的独立模型与账户保持原样；只有明确重选这一用途，才会修改对应制作设置。</p>}<div className="home-production-tabs" role="tablist" aria-label="制作模型用途">{availableRoles.map(role => { const selected = naturalModelSelection(props.configuration, role.capability, bindings[role.capability]); return <button key={role.capability} type="button" role="tab" data-capability={role.capability} aria-selected={active?.capability === role.capability} onClick={() => setTab(role.capability)}><span>{role.label}</span>{selected.model && selected.credentialId && <Check size={13} />}<small title={selected.model?.name}>{selected.model?.name || '尚未选择'}</small></button>; })}</div>{active && <div className="home-production-fields" role="tabpanel" aria-label={`${active.label}制作设置`}><p>{active.description}</p><NaturalAutomationModels configuration={props.configuration} capability={active.capability} label={`制作${active.label}`} value={bindings[active.capability] || {}} disabled={productionLocked} onChange={value => session.setProductionBinding(active.capability, value)} /></div>}{created && <div className="home-production-actions">{session.savedRule?.enabled ? <><span>先暂停自动触发，再调整制作模型。</span><button className="btn btn-secondary" type="button" disabled={blocked} onClick={() => { void session.readiness.perform('pause'); }}>暂停自动触发</button></> : <><span>修改后保存到当前流程；下次运行使用新设置。</span><button className="btn btn-secondary" type="button" disabled={blocked || !session.savedRule} onClick={() => { void session.readiness.perform('save'); }}>保存制作模型</button></>}</div>}<button className="text-button" type="button" onClick={() => props.navigate('models')}>录入或管理模型 / Key</button></div>}
  </div>;
}
