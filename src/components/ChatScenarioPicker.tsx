import { useEffect, useId, useMemo, useState } from 'react';
import { Check, FileText, Image, Layers3, MessageCircle, Search, Star, X } from 'lucide-react';
import { ModalPortal } from './ModalPortal';
import { CHAT_SCENARIO_GROUPS, filterChatScenarios, findChatScenario } from '../lib/chat-scenarios';
import type { ChatScenario, ChatScenarioGroup } from '../lib/chat-scenarios';
import { chatScenePreferenceKey, favoriteChatScene, quickChatScenes, readChatScenePreferences, usedChatScene } from '../lib/chat-scene-preferences';
import type { ChatScenePreferences } from '../lib/chat-scene-preferences';
import './chat-scenario-picker.css';

const icons = { chat: MessageCircle, images: Image, documents: FileText, custom: Layers3 };
export function ChatScenarioPicker({ scenarios, value, disabled = false, onSelect, workspaceId = 'default' }: { scenarios: ChatScenario[]; value?: string; disabled?: boolean; onSelect: (scenario: ChatScenario) => void; workspaceId?: string }) {
  const [open, setOpen] = useState(false);
  const current = findChatScenario(scenarios, value), Icon = icons[current.group];
  const ids = scenarios.map(scene => scene.id).join('|'), key = chatScenePreferenceKey(workspaceId);
  const load = () => { try { return readChatScenePreferences(localStorage.getItem(key), scenarios.map(scene => scene.id)); } catch { return readChatScenePreferences(null, []); } };
  const [preferences, setPreferences] = useState(load), [issue, setIssue] = useState('');
  useEffect(() => { setPreferences(load()); setIssue(''); }, [key, ids]);
  function save(next: ChatScenePreferences) { setPreferences(next); try { localStorage.setItem(key, JSON.stringify(next)); setIssue(''); } catch { setIssue('本次选择可用，常用场景暂未记住。'); } }
  function choose(scene: ChatScenario) { save(usedChatScene(preferences, scene.id)); onSelect(scene); setOpen(false); }
  function favorite(id: string) { try { save(favoriteChatScene(preferences, id)); } catch (cause) { setIssue(cause instanceof Error ? cause.message : '收藏未能保存。'); } }
  const quick = quickChatScenes(preferences, current.id).map(id => scenarios.find(scene => scene.id === id)).filter((scene): scene is ChatScenario => !!scene);
  return <div className="chat-scenario-control">
    <button className="chat-scenario-trigger" type="button" disabled={disabled} aria-label="选择使用场景" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} title={current.description}><Icon size={15} /><span>场景：{current.name}</span></button>
    {!!quick.length && <div className="chat-scene-shortcuts" aria-label="常用场景快捷入口">{quick.map(scene => <button type="button" key={scene.id} disabled={disabled} aria-label={`快速切换${scene.name}`} title={scene.description} onClick={() => choose(scene)}>{preferences.favorites.includes(scene.id) && <Star size={11} fill="currentColor" />}<span>{scene.name}</span></button>)}</div>}
    {open && <ScenarioDialog scenarios={scenarios} value={current.id} preferences={preferences} issue={issue} onFavorite={favorite} onSelect={choose} onClose={() => setOpen(false)} />}
  </div>;
}
function ScenarioDialog({ scenarios, value, preferences, issue, onFavorite, onSelect, onClose }: { scenarios: ChatScenario[]; value: string; preferences: ChatScenePreferences; issue: string; onFavorite: (id: string) => void; onSelect: (scenario: ChatScenario) => void; onClose: () => void }) {
  const titleId = useId();
  const [group, setGroup] = useState<'all' | ChatScenarioGroup | 'favorites' | 'recent'>('all'), [query, setQuery] = useState('');
  const shown = useMemo(() => { const selected = group === 'favorites' ? preferences.favorites : group === 'recent' ? preferences.recent : undefined; const filtered = filterChatScenarios(scenarios, selected ? 'all' : group as 'all' | ChatScenarioGroup, query); return selected ? selected.map(id => filtered.find(scene => scene.id === id)).filter((scene): scene is ChatScenario => !!scene) : filtered; }, [scenarios, group, query, preferences]);
  return <ModalPortal onClose={onClose}><div className="chat-scenario-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="chat-scenario-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <header><div><h2 id={titleId}>这次想做什么？</h2><p>选一个场景，带入合适的要求；细节还可以继续补充。</p></div><button type="button" className="btn-icon" aria-label="关闭使用场景" onClick={onClose}><X size={20} /></button></header>
    <div className="chat-scenario-search"><Search size={17} aria-hidden="true" /><input autoFocus aria-label="搜索使用场景" placeholder="搜索宣传图、资料解读、壁纸…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" className="btn-icon" aria-label="清空场景搜索" onClick={() => setQuery('')}><X size={15} /></button>}</div>
    <div className="chat-scenario-groups" role="group" aria-label="筛选使用场景">{[{ id: 'favorites' as const, label: `收藏 ${preferences.favorites.length}` }, { id: 'recent' as const, label: '最近' }, ...CHAT_SCENARIO_GROUPS.filter(item => item.id !== 'custom' || scenarios.some(scenario => scenario.group === 'custom'))].map(item => <button type="button" key={item.id} aria-pressed={group === item.id} onClick={() => setGroup(item.id)}>{item.label}</button>)}</div>
    <div className="chat-scenario-list" role="group" aria-label="可用场景">{shown.length ? shown.map(scenario => { const Icon = icons[scenario.group], favorite = preferences.favorites.includes(scenario.id); return <div className="chat-scenario-row" key={scenario.id}><button type="button" className={`chat-scenario-choice${scenario.id === value ? ' is-selected' : ''}`} aria-pressed={scenario.id === value} aria-label={`使用场景 ${scenario.name}`} onClick={() => onSelect(scenario)}><span className="chat-scenario-icon"><Icon size={20} /></span><span className="chat-scenario-info"><strong>{scenario.name}</strong><span>{scenario.description}</span><small>{scenario.entry ? '专用工作台' : scenario.mode === 'chat' ? '直接沟通' : '先出制作方案'}{scenario.minImageReferences ? ` · 需 ${scenario.minImageReferences} 张参考图` : scenario.minAttachments ? ' · 需参考资料' : ''}</small></span>{scenario.id === value && <Check size={17} className="chat-scenario-selected" />}</button><button type="button" className="chat-scene-star" aria-label={`${favorite ? '取消收藏' : '收藏'}${scenario.name}`} aria-pressed={favorite} title={favorite ? '取消收藏' : '收藏到输入框快捷入口'} onClick={() => onFavorite(scenario.id)}><Star size={16} fill={favorite ? 'currentColor' : 'none'} /></button></div>; }) : <div className="chat-scenario-empty"><Search size={24} /><strong>{group === 'favorites' && !query ? '还没有收藏场景' : group === 'recent' && !query ? '选择过的场景会记在这里' : '没有找到相关场景'}</strong><span>{group === 'favorites' ? '点击场景右上角星标，即可放到输入框旁。' : '换个关键词，或回到全部场景。'}</span><button type="button" className="text-button" onClick={() => { setQuery(''); setGroup('all'); }}>查看全部</button></div>}</div>
    <footer>{issue ? <span role="status">{issue}</span> : '选择和收藏场景不会自动发送或调用模型。'}</footer>
  </section></div></ModalPortal>;
}
