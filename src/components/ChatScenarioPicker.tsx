import { useId, useMemo, useState } from 'react';
import { Check, FileText, Image, Layers3, MessageCircle, Search, X } from 'lucide-react';
import { ModalPortal } from './ModalPortal';
import { CHAT_SCENARIO_GROUPS, filterChatScenarios, findChatScenario } from '../lib/chat-scenarios';
import type { ChatScenario, ChatScenarioGroup } from '../lib/chat-scenarios';
import './chat-scenario-picker.css';

const icons = { chat: MessageCircle, images: Image, documents: FileText, custom: Layers3 };
export function ChatScenarioPicker({ scenarios, value, disabled = false, onSelect }: { scenarios: ChatScenario[]; value?: string; disabled?: boolean; onSelect: (scenario: ChatScenario) => void }) {
  const [open, setOpen] = useState(false);
  const current = findChatScenario(scenarios, value), Icon = icons[current.group];
  return <>
    <button className="chat-scenario-trigger" type="button" disabled={disabled} aria-label="选择使用场景" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} title={current.description}><Icon size={15} /><span>场景：{current.name}</span></button>
    {open && <ScenarioDialog scenarios={scenarios} value={current.id} onSelect={scenario => { onSelect(scenario); setOpen(false); }} onClose={() => setOpen(false)} />}
  </>;
}
function ScenarioDialog({ scenarios, value, onSelect, onClose }: { scenarios: ChatScenario[]; value: string; onSelect: (scenario: ChatScenario) => void; onClose: () => void }) {
  const titleId = useId();
  const [group, setGroup] = useState<'all' | ChatScenarioGroup>('all'), [query, setQuery] = useState('');
  const shown = useMemo(() => filterChatScenarios(scenarios, group, query), [scenarios, group, query]);
  return <ModalPortal onClose={onClose}><div className="chat-scenario-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="chat-scenario-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <header><div><h2 id={titleId}>这次想做什么？</h2><p>选一个场景，带入合适的要求；细节还可以继续补充。</p></div><button type="button" className="btn-icon" aria-label="关闭使用场景" onClick={onClose}><X size={20} /></button></header>
    <div className="chat-scenario-search"><Search size={17} aria-hidden="true" /><input autoFocus aria-label="搜索使用场景" placeholder="搜索宣传图、资料解读、壁纸…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" className="btn-icon" aria-label="清空场景搜索" onClick={() => setQuery('')}><X size={15} /></button>}</div>
    <div className="chat-scenario-groups" role="group" aria-label="筛选使用场景">{CHAT_SCENARIO_GROUPS.filter(item => item.id !== 'custom' || scenarios.some(scenario => scenario.group === 'custom')).map(item => <button type="button" key={item.id} aria-pressed={group === item.id} onClick={() => setGroup(item.id)}>{item.label}</button>)}</div>
    <div className="chat-scenario-list" role="group" aria-label="可用场景">{shown.length ? shown.map(scenario => { const Icon = icons[scenario.group]; return <button type="button" key={scenario.id} className={scenario.id === value ? 'is-selected' : ''} aria-pressed={scenario.id === value} aria-label={`使用场景 ${scenario.name}`} onClick={() => onSelect(scenario)}><span className="chat-scenario-icon"><Icon size={20} /></span><span className="chat-scenario-info"><strong>{scenario.name}</strong><span>{scenario.description}</span><small>{scenario.entry ? '专用工作台' : scenario.mode === 'chat' ? '直接沟通' : '先出制作方案'}{scenario.minImageReferences ? ` · 需 ${scenario.minImageReferences} 张参考图` : scenario.minAttachments ? ' · 需参考资料' : ''}</small></span>{scenario.id === value && <Check size={17} className="chat-scenario-selected" />}</button>; }) : <div className="chat-scenario-empty"><Search size={24} /><strong>没有找到相关场景</strong><span>换个关键词，或回到全部场景。</span><button type="button" className="text-button" onClick={() => { setQuery(''); setGroup('all'); }}>查看全部</button></div>}</div>
    <footer>选择场景不会自动发送或调用模型。</footer>
  </section></div></ModalPortal>;
}
