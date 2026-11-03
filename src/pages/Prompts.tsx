import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Braces, Copy, Eye, FileSpreadsheet, FileText, Image, LayoutTemplate, LockKeyhole, Pencil, Plus, Presentation, Search, ShieldCheck, Sparkles, WandSparkles, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PageProps, PromptCategory, PromptDraft, PromptTemplate } from '../types';
import { PROMPT_CATEGORY_LABELS } from '../prompt-data';
import { extractVariables } from '../lib/prompt-variables';
import { PromptEditor, PromptPicker } from '../components/PromptDialogs';
import { BusinessCategorySelect } from '../components/BusinessCategorySelect';
import { categoryMatches } from '../lib/configuration';
import './prompts.css';

const CATEGORIES: { id: PromptCategory | 'all'; label: string; icon: LucideIcon }[] = [
  { id: 'all', label: '全部分类', icon: LayoutTemplate },
  { id: 'ppt', label: 'PPT 演示', icon: Presentation },
  { id: 'word', label: 'Word 文档', icon: FileText },
  { id: 'excel', label: 'Excel 表格', icon: FileSpreadsheet },
  { id: 'image', label: '图像创作', icon: Image },
  { id: 'general', label: '通用精修', icon: WandSparkles },
];

function draftFrom(template: PromptTemplate, copy: boolean): PromptDraft {
  return { name: copy ? `${template.name}（副本）` : template.name, description: template.description, category: template.category, content: template.content, mode: template.mode, imagePreset: template.imagePreset, businessCategoryId: template.businessCategoryId };
}

export function Prompts(props: PageProps) {
  const { workspaceId, workspace, prompts, configuration, onSavePrompt, onUsePrompt } = props;
  const [tab, setTab] = useState<'builtin' | 'mine'>('builtin');
  const [category, setCategory] = useState<PromptCategory | 'all'>('all');
  const [businessCategory, setBusinessCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [picker, setPicker] = useState<PromptTemplate | null>(null);
  const [editor, setEditor] = useState<{ draft: PromptDraft; id?: string } | null>(null);
  const scoped = useMemo(() => prompts.filter(prompt => prompt.builtin || prompt.workspaceId === workspaceId), [prompts, workspaceId]);
  const builtins = scoped.filter(prompt => prompt.builtin);
  const mine = scoped.filter(prompt => !prompt.builtin);
  const tabPrompts = tab === 'builtin' ? builtins : mine;
  const filtered = tabPrompts.filter(prompt => (category === 'all' || prompt.category === category) && categoryMatches(configuration.categories, businessCategory, prompt.businessCategoryId) && `${prompt.name} ${prompt.description} ${prompt.content}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => { setTab('builtin'); setCategory('all'); setBusinessCategory('all'); setQuery(''); setPicker(null); setEditor(null); }, [workspaceId]);

  function create() { setEditor({ draft: { name: '', description: '', category: category === 'all' ? 'general' : category, mode: 'create', content: '', businessCategoryId: businessCategory === 'all' ? undefined : businessCategory || undefined } }); }
  function edit(prompt: PromptTemplate) { setEditor({ draft: draftFrom(prompt, prompt.builtin), id: prompt.builtin ? undefined : prompt.id }); }
  function save(draft: PromptDraft, id?: string) { onSavePrompt(draft, id); setEditor(null); setTab('mine'); setCategory('all'); setBusinessCategory('all'); setQuery(''); }

  return <div className="pr-page">
    <div className="page-heading"><div><p className="pr-eyebrow">YOUR PROMPT LIBRARY</p><h1 className="page-title">提示词模板</h1><p className="page-description">把常用要求保存下来，下次创作时直接填写变量。</p></div><button className="btn btn-primary" onClick={create}><Plus size={16} />新建提示词</button></div>
    <section className="pr-intro-banner"><span className="pr-intro-icon"><Braces size={30} /></span><div><h2>常用方法，成为你的创作起点</h2><p>选择模板 → 填写变量 → 应用到工作台。创作与精修，都能少一步重复输入。</p><div className="pr-intro-tags"><span><CheckIcon />保存和应用不调用 API</span><span><LockKeyhole size={12} />自定义模板隔离保存</span></div></div><div className="pr-workspace-card"><span>当前工作区</span><strong title={workspace.name}>{workspace.name}</strong><small>{mine.length} 条自定义提示词</small></div></section>
    <div className="pr-library-toolbar"><div className="tabs pr-source-tabs"><button className={tab === 'builtin' ? 'active' : ''} onClick={() => setTab('builtin')}><Sparkles size={15} />内置模板 <span>{builtins.length}</span></button><button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}><Pencil size={15} />我的模板 <span>{mine.length}</span></button></div><label className="pr-search"><Search size={16} /><input aria-label="搜索提示词模板" placeholder="搜索模板名称、场景或内容…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button onClick={() => setQuery('')} aria-label="清空提示词搜索"><X size={13} /></button>}</label></div>
    <div className="pr-business-filter"><BusinessCategorySelect categories={configuration.categories} value={businessCategory} onChange={setBusinessCategory} label="筛选提示词业务分类" includeAll /></div>
    <div className="pr-category-filters">{CATEGORIES.map(item => <button className={category === item.id ? 'active' : ''} key={item.id} onClick={() => setCategory(item.id)}><item.icon size={14} />{item.label}</button>)}</div>
    <div className="pr-results-heading"><span>{tab === 'builtin' ? '从内置模板开始' : '你的工作方法库'}<b>{filtered.length}</b></span><small><ShieldCheck size={12} />内置模板通用，自定义仅当前工作区</small></div>
    {filtered.length ? <div className="pr-card-grid">{filtered.map(prompt => {
      const variables = extractVariables(prompt.content);
      const Icon = CATEGORIES.find(item => item.id === prompt.category)?.icon ?? Braces;
      return <article className="panel pr-template-card" key={prompt.id}><div className="pr-card-top"><span className={`pr-card-icon pr-category-${prompt.category}`}><Icon size={20} /></span><span className={`pr-source-badge ${prompt.builtin ? '' : 'custom'}`}>{prompt.builtin ? '内置模板' : '我的模板'}</span></div><h2>{prompt.name}</h2><p className="pr-card-description">{prompt.description}</p><div className="pr-card-snippet">{prompt.content}</div><div className="pr-card-variables"><Braces size={12} />{variables.length ? <><span>{variables.slice(0, 3).map(variable => <code key={variable}>{variable}</code>)}</span>{variables.length > 3 && <em>+{variables.length - 3}</em>}</> : <span className="pr-no-variable-label">固定提示词，直接应用</span>}</div><div className="pr-card-meta"><span>{PROMPT_CATEGORY_LABELS[prompt.category]}<i />{prompt.mode === 'create' ? '创作' : '精修'}</span><span>{prompt.builtin ? '可另存副本' : prompt.updatedAt}</span></div><footer><button className="btn-icon" onClick={() => setPicker(prompt)} aria-label={`预览${prompt.name}`} title="预览与填写变量"><Eye size={15} /></button><button className="pr-card-edit" onClick={() => edit(prompt)}>{prompt.builtin ? <Copy size={13} /> : <Pencil size={13} />}{prompt.builtin ? '编辑副本' : '编辑'}</button><button className="btn btn-primary" onClick={() => setPicker(prompt)}>使用模板<ArrowRight size={13} /></button></footer></article>;
    })}</div> : <section className="panel pr-empty-state"><span className="pr-empty-icon">{tab === 'mine' && !query && category === 'all' && businessCategory === 'all' ? <Braces size={31} /> : <Search size={29} />}</span><h2>{tab === 'mine' && !query && category === 'all' && businessCategory === 'all' ? '把你的第一条常用提示词存下来' : '没有找到匹配的模板'}</h2><p>{tab === 'mine' && !query && category === 'all' && businessCategory === 'all' ? '可以从空白开始，也可以编辑内置模板，另存为自己的版本。' : '试试其他关键词，或查看全部分类。'}</p><div>{tab === 'mine' && !query && category === 'all' && businessCategory === 'all' ? <><button className="btn btn-primary" onClick={create}><Plus size={15} />新建我的模板</button><button className="btn btn-secondary" onClick={() => setTab('builtin')}>浏览内置模板</button></> : <button className="btn btn-secondary" onClick={() => { setQuery(''); setCategory('all'); setBusinessCategory('all'); }}>清除筛选</button>}</div></section>}
    <div className="pr-page-note"><ShieldCheck size={14} /><span>模板是创作辅助，不保证输出质量。应用后可以继续修改，只有开始生成才会新增演示调用记录。</span></div>
    {picker && <PromptPicker useTemplates={configuration.useTemplates} prompts={[picker]} onClose={() => setPicker(null)} onUse={(template, content) => { onUsePrompt(template, content); setPicker(null); }} />}
    {editor && <PromptEditor useTemplates={configuration.useTemplates} categories={configuration.categories} initial={editor.draft} templateId={editor.id} onClose={() => setEditor(null)} onSave={save} />}
  </div>;
}

function CheckIcon() { return <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" /><path d="m5.3 8 1.8 1.8 3.7-3.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
