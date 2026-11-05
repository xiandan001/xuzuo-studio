import { LoaderCircle, Play, X } from 'lucide-react';
import type { AutomationRule } from '../automation-types';
import type { PageProps } from '../types';
import { useAutomationReadiness } from '../hooks/useAutomationReadiness';
import { AutomationReadinessFields } from './AutomationReadinessFields';
import { ModalPortal } from './ModalPortal';

export function AutomationReadinessDialog({ props, rule, onClose, onSaved }: { props: PageProps; rule: AutomationRule; onClose: () => void; onSaved: () => void }) {
  const workflow = props.configuration.workflows.find(item => item.id === rule.workflowId);
  const state = useAutomationReadiness(props, rule, workflow, () => onSaved(), onClose);
  return <ModalPortal onClose={onClose} busy={state.busy}><div className="auto-modal-backdrop"><section className="auto-modal natural-composer" role="dialog" aria-modal="true" aria-labelledby="natural-ready-title"><header><div><h2 id="natural-ready-title">补齐并运行</h2><p>{rule.name} · 填资料、改模型和保存设置都不重新调用规划 AI。</p></div><button className="btn-icon" aria-label="关闭运行设置" disabled={state.busy} onClick={onClose}><X size={20} /></button></header><div className="natural-body"><AutomationReadinessFields props={props} rule={rule} state={state} /></div><footer><button className="btn btn-secondary" disabled={state.busy} onClick={onClose}>完成</button>{rule.trigger !== 'manual' && <button className="btn btn-secondary" disabled={state.busy} onClick={() => { void state.perform('enable'); }}>启用自动触发</button>}<button className="btn btn-primary" disabled={state.busy} onClick={() => { void state.perform('run'); }}>{state.busy ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}{state.remaining ? '补齐后运行' : '运行一次'}</button></footer></section></div></ModalPortal>;
}
