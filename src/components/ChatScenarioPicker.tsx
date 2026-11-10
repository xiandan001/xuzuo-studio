import { useEffect, useId, useMemo, useState } from 'react';
import { Check, FileText, Image, Layers3, MessageCircle, Search, X } from 'lucide-react';
import type { ImageUseTemplate } from '../configuration-types';
import type { ProjectKind } from '../types';
import { HOME_CREATION_KINDS } from '../lib/home-creation';
import { availableImageUseTemplates, imageUseTemplateSnapshot } from '../lib/image-use-templates';
import type { ImageUseTemplateSnapshot } from '../lib/image-use-templates';
import { ModalPortal } from './ModalPortal';
import './chat-scenario-picker.css';

export interface ChatScenarioSelection {
  id: string;
  name: string;
  text: string;
  outputKind: ProjectKind;
  mode?: 'chat' | 'plan';
  imageTemplate?: ImageUseTemplateSnapshot;
}

interface ChatScenarioPickerProps {
  workspaceId: string;
  templates?: ImageUseTemplate[];
  value?: string;
  mode?: 'chat' | 'plan';
  disabled?: boolean;
  onSelect: (scenario: ChatScenarioSelection) => void;
}

type ScenarioGroup = 'chat' | 'images' | 'documents' | 'custom';
const groups: { id: 'all' | ScenarioGroup; label: string }[] = [
  { id: 'all', label: '全部' }, { id: 'chat', label: '聊天' }, { id: 'images', label: '图片' },
  { id: 'documents', label: '文档与表格' }, { id: 'custom', label: '我的场景' },
];
const icons = { chat: MessageCircle, images: Image, documents: FileText, custom: Layers3 };

/** Uses the same image purposes as the image studio and the existing document examples. */
export function chatScenarios(templates: ImageUseTemplate[], workspaceId: string): ChatScenarioSelection[] {
  const images = availableImageUseTemplates(templates, workspaceId).map(template => {
    const requirements = [
      template.size !== 'auto' && template.id !== '壁纸' ? `图片尺寸：${template.size.replace('x', ' × ')}。` : '',
      template.id === '壁纸' ? '壁纸尺寸与方向以本次设备和用户要求为准；未说明设备时先确认。' : '',
      template.background === 'transparent' ? '背景要求：透明 PNG。' : template.background === 'opaque' ? '背景要求：不透明背景。' : '',
      template.minReferences ? `需要至少 ${template.minReferences} 张参考图片；资料不足时先询问补充，不要假设已经提供。` : '',
    ].filter(Boolean);
    return { id: `image:${template.id}`, name: template.name, outputKind: 'image' as const, mode: 'plan' as const, text: [template.id === '拼豆' ? '请制作拼豆图纸。' : '', template.prompt, ...requirements].filter(Boolean).join('\n'), imageTemplate: imageUseTemplateSnapshot(template) };
  });
  return [
    { id: 'chat-default', name: '自由聊天', text: '', outputKind: 'image', mode: 'chat' },
    ...images,
    ...HOME_CREATION_KINDS.filter(item => item.kind !== 'image').map(item => ({ id: `format:${item.kind}`, name: item.title, text: item.example, outputKind: item.kind, mode: 'plan' as const })),
  ];
}

function description(scenario: ChatScenarioSelection) {
  if (scenario.mode === 'chat') return '直接提问、讨论想法或继续上一段对话，不要求先创建项目。';
  const text = scenario.text.replace(/\s+/g, ' ').trim();
  return text.length > 100 ? `${text.slice(0, 100)}…` : text;
}

export function ChatScenarioPicker({ workspaceId, templates = [], value, mode = 'chat', disabled = false, onSelect }: ChatScenarioPickerProps) {
  const [open, setOpen] = useState(false);
  const scenarios = useMemo(() => chatScenarios(templates, workspaceId), [templates, workspaceId]);
  const customIds = useMemo(() => new Set(templates.filter(template => !template.builtin && template.workspaceId === workspaceId && template.enabled).map(template => `image:${template.id}`)), [templates, workspaceId]);
  const groupFor = (scenario: ChatScenarioSelection): ScenarioGroup => scenario.mode === 'chat' ? 'chat' : scenario.outputKind !== 'image' ? 'documents' : customIds.has(scenario.id) ? 'custom' : 'images';
  const current = scenarios.find(scenario => scenario.id === value) || scenarios.find(scenario => scenario.id === (mode === 'plan' ? 'image:宣传图' : 'chat-default')) || scenarios[0];
  const Icon = icons[groupFor(current)];
  useEffect(() => { setOpen(false); }, [workspaceId, disabled]);
  return <>
    <button className="chat-scenario-trigger" type="button" disabled={disabled} aria-label="使用场景" aria-haspopup="dialog" aria-expanded={open && !disabled} title={description(current)} onClick={() => setOpen(true)}><Icon size={15} aria-hidden="true" /><span>场景：{current.name}</span></button>
    {open && !disabled && <ScenarioDialog key={workspaceId} scenarios={scenarios} value={current.id} groupFor={groupFor} onSelect={scenario => { onSelect(scenario); setOpen(false); }} onClose={() => setOpen(false)} />}
  </>;
}

function ScenarioDialog({ scenarios, value, groupFor, onSelect, onClose }: { scenarios: ChatScenarioSelection[]; value: string; groupFor: (scenario: ChatScenarioSelection) => ScenarioGroup; onSelect: (scenario: ChatScenarioSelection) => void; onClose: () => void }) {
  const titleId = useId();
  const [group, setGroup] = useState<'all' | ScenarioGroup>('all'), [query, setQuery] = useState('');
  const term = query.trim().toLocaleLowerCase();
  const shown = scenarios.filter(scenario => (group === 'all' || groupFor(scenario) === group) && (!term || `${scenario.name}\n${scenario.text}\n${groups.find(item => item.id === groupFor(scenario))?.label || ''}`.toLocaleLowerCase().includes(term)));
  return <ModalPortal onClose={onClose}><div className="chat-scenario-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="chat-scenario-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <header><div><h2 id={titleId}>这次想做什么？</h2><p>选一个场景，带入合适的要求；细节还可以继续补充。</p></div><button type="button" className="btn-icon" aria-label="关闭使用场景" onClick={onClose}><X size={20} /></button></header>
    <div className="chat-scenario-search"><Search size={17} aria-hidden="true" /><input autoFocus aria-label="搜索使用场景" placeholder="搜索宣传图、壁纸、合作说明书…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229 && shown.length === 1) { event.preventDefault(); onSelect(shown[0]); } }} />{query && <button type="button" className="btn-icon" aria-label="清空场景搜索" onClick={() => setQuery('')}><X size={15} /></button>}</div>
    <div className="chat-scenario-groups" role="group" aria-label="筛选使用场景">{groups.filter(item => item.id !== 'custom' || scenarios.some(scenario => groupFor(scenario) === 'custom')).map(item => <button type="button" key={item.id} aria-pressed={group === item.id} onClick={() => setGroup(item.id)}>{item.label}</button>)}</div>
    <div className="chat-scenario-list" role="group" aria-label="可用场景">{shown.length ? shown.map(scenario => {
      const Icon = icons[groupFor(scenario)], references = scenario.imageTemplate?.minReferences;
      return <button type="button" key={scenario.id} className={scenario.id === value ? 'is-selected' : ''} aria-pressed={scenario.id === value} aria-label={`使用场景 ${scenario.name}`} onClick={() => onSelect(scenario)}><span className="chat-scenario-icon"><Icon size={20} /></span><span className="chat-scenario-info"><strong>{scenario.name}</strong><span>{description(scenario)}</span><small>{scenario.mode === 'chat' ? '直接沟通' : scenario.imageTemplate?.id === '拼豆' ? '专用工作台' : '先出制作方案'}{references ? ` · 需 ${references} 张参考图` : ''}</small></span>{scenario.id === value && <Check size={17} className="chat-scenario-selected" aria-hidden="true" />}</button>;
    }) : <div className="chat-scenario-empty"><Search size={24} /><strong>没有找到相关场景</strong><span>换个关键词，或回到全部场景。</span><button type="button" className="text-button" onClick={() => { setQuery(''); setGroup('all'); }}>查看全部</button></div>}</div>
    <footer>选择场景不会自动发送或调用模型。</footer>
  </section></div></ModalPortal>;
}
