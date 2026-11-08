import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { ImagePlus, Plus } from 'lucide-react';
import type { PageProps } from '../../types';
import type { ArtifactMetadata } from '../../live-types';
import type { BusinessBrand, BusinessState } from '../../business-types';
import { useBusinessDraft } from '../../hooks/useBusinessDraft';
import { registerEditorSession } from '../../lib/editor-session-guard';
import { Select } from '../Select';
import { RememberedDetails } from '../RememberedDetails';
import { BusinessFormStatus } from './BusinessFormStatus';
import { BusinessImagePreview } from './BusinessImagePreview';

export type BusinessCommit = (change: (state: BusinessState) => BusinessState) => Promise<BusinessState | undefined>;
const emptyBrand = (): BusinessBrand => ({ id: crypto.randomUUID(), name: '', contact: '', colors: ['#2463eb'], font: 'Microsoft YaHei', voice: '清楚、自然、可信', forbiddenClaims: ['不编造功效、认证、销量和商品参数'], approvedSampleIds: [], updatedAt: new Date().toISOString() });
type BrandInput = Omit<BusinessBrand, 'colors' | 'forbiddenClaims'> & { colorText: string; forbiddenText: string };
function brandInput(value: BusinessBrand): BrandInput { const { colors, forbiddenClaims, ...rest } = value; return { ...rest, colorText: colors.join(', '), forbiddenText: forbiddenClaims.join('\n') }; }
export function BrandPanel({ props, state, commit, projectId, files = [], onSelected }: { props: PageProps; state: BusinessState; commit: BusinessCommit; projectId?: string; files?: ArtifactMetadata[]; onSelected?: (id: string) => void }) {
  const [selected, setSelected] = useState(state.brands[0]?.id || ''), [fresh, setFresh] = useState<BusinessBrand>(() => emptyBrand()), [busy, setBusy] = useState(false), [issue, setIssue] = useState('');
  const guard = useRef<(() => Promise<boolean>) | undefined>(undefined), working = useRef(false);
  const value = state.brands.find(item => item.id === selected) || fresh;
  const projects = new Set(props.projects.filter(item => item.workspaceId === props.workspaceId && !item.trashedAt && !item.purgedAt).map(item => item.id)), formal = new Set(state.orders.flatMap(item => item.outputIds));
  const samples = files.filter(file => projects.has(file.projectId || '') && formal.has(file.id) && file.kind === 'image' && !file.trashedAt && !file.unavailable);
  async function choose(id: string, create = false) {
    if (working.current) return; working.current = true; setBusy(true); setIssue('');
    try {
      if (guard.current && !await guard.current()) { setIssue('当前客户资料尚未保存，请在原表单重试；输入仍保留。'); return; }
      if (create || !id) setFresh(emptyBrand()); setSelected(id);
    } catch (cause) { setIssue(cause instanceof Error ? cause.message : '当前输入尚未保存。'); }
    finally { working.current = false; setBusy(false); }
  }
  return <div className="bs-panel"><header className="bs-panel-heading"><div><h2>客户与品牌</h2><p>沿用客户的颜色、风格与认可样张；联系方式仅用于本地记录。</p></div><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { void choose('', true); }}><Plus size={16} />新客户</button></header>
    <label>选择客户<Select aria-label="选择客户品牌" disabled={busy} value={selected} onValueChange={id => { if (id !== selected) void choose(id); }} options={[{ value: '', label: '新增客户' }, ...state.brands.map(item => ({ value: item.id, label: item.name }))]} /></label>
    {issue && <p className="bs-error" role="alert">{issue}</p>}
    <BrandForm key={value.id} initial={value} projectId={projectId} props={props} files={files} samples={samples} guard={guard} onSave={async value => {
      const next = { ...value, updatedAt: new Date().toISOString() }, saved = await commit(state => ({ ...state, brands: [...state.brands.filter(item => item.id !== value.id), next] }));
      if (saved) { setSelected(value.id); onSelected?.(value.id); } return Boolean(saved);
    }} />
  </div>;
}
function BrandForm({ initial, projectId, props, files, samples, guard, onSave }: { initial: BusinessBrand; projectId?: string; props: PageProps; files: ArtifactMetadata[]; samples: ArtifactMetadata[]; guard: MutableRefObject<(() => Promise<boolean>) | undefined>; onSave: (value: BusinessBrand) => Promise<boolean> }) {
  const draft = useBusinessDraft(`brand:${initial.id}`, projectId || `business-${props.workspaceId}`, brandInput(initial), async input => {
    const { colorText, forbiddenText, ...value } = input;
    return onSave({ ...value, colors: colorText.split(/[,，\s]+/).filter(Boolean), forbiddenClaims: forbiddenText.split('\n').map(text => text.trim()).filter(Boolean) });
  }), value = draft.value;
  const [importing, setImporting] = useState(false), [issue, setIssue] = useState(''), [query, setQuery] = useState('');
  const importTask = useRef<Promise<void> | undefined>(undefined);
  useEffect(() => { const save = async () => { await importTask.current; return draft.save(); }; guard.current = save; return () => { if (guard.current === save) guard.current = undefined; }; }, [guard, draft.save]);
  useEffect(() => registerEditorSession({ id: `business-form:brand-logo:${initial.id}`, projectId: projectId || '', label: '品牌Logo导入', getState: () => ({ dirty: false, pending: !!importTask.current }), save: async () => { await importTask.current; return draft.save(); }, exportRecovery: async () => false }), [initial.id, projectId, draft.save]);
  const update = <K extends keyof BrandInput>(key: K, next: BrandInput[K]) => draft.update(old => ({ ...old, [key]: next }));
  function importLogo() {
    if (!projectId || importTask.current) return; setImporting(true); setIssue('');
    const task = (async () => {
      try { const imported = await props.workflowRunner.importFiles(projectId), image = imported.find(file => ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType)); if (image) draft.update(old => ({ ...old, projectId, logoArtifactId: image.id })); else if (imported.length) setIssue('Logo请选择PNG、JPEG或WebP图片。'); }
      catch (cause) { setIssue(cause instanceof Error ? cause.message : 'Logo尚未导入。'); } finally { setImporting(false); }
    })(); importTask.current = task; void task.finally(() => { if (importTask.current === task) importTask.current = undefined; });
  }
  const filtered = samples.filter(file => file.name.toLowerCase().includes(query.toLowerCase())).slice(0, 50), approved = value.approvedSampleIds;
  return <div className="bs-form-grid">
    <label>客户／品牌名称<input className="field" aria-label="品牌名称" maxLength={120} value={value.name} onChange={event => update('name', event.target.value)} placeholder="例如：山野咖啡" /></label>
    <label>联系方式 <small>可选，不自动传给模型</small><input className="field" aria-label="客户联系方式" maxLength={300} value={value.contact} onChange={event => update('contact', event.target.value)} /></label>
    <label>标准色 <small>多个色值用逗号分隔</small><input className="field" aria-label="品牌标准色" maxLength={150} value={value.colorText} onChange={event => update('colorText', event.target.value)} placeholder="#2463eb, #ffffff" /></label>
    <label>字体<Select aria-label="品牌字体" value={value.font} onValueChange={font => update('font', font)} options={['Microsoft YaHei', 'SimSun', 'Arial', 'sans-serif'].map(font => ({ value: font, label: font }))} /></label>
    <label className="bs-full">表达风格<textarea className="field" aria-label="品牌表达风格" rows={2} maxLength={2000} value={value.voice} onChange={event => update('voice', event.target.value)} placeholder="例如：自然、温暖；卖点清楚，不使用夸张词" /></label>
    <label className="bs-full">不能改、不能说的内容<textarea className="field" aria-label="品牌禁用表达" rows={3} maxLength={4000} value={value.forbiddenText} onChange={event => update('forbiddenText', event.target.value)} /></label>
    <div className="bs-full bs-logo-row"><button type="button" className="btn btn-secondary" disabled={!projectId || importing} onClick={() => { void importLogo(); }}><ImagePlus size={16} />{importing ? '正在导入…' : value.logoArtifactId ? '更换已保存Logo' : '添加Logo'}</button><small>{value.logoArtifactId ? 'Logo原图用于本地排版，后续可独立调整。' : projectId ? '可稍后添加。' : '打开制作单后可添加Logo。'}</small></div>
    <RememberedDetails className="bs-full" rememberKey={`business-brand:${initial.id}:samples`}><summary>客户认可的品牌样张 <small>{approved.length} 张，仅用于延续风格</small></summary>
      <p className="bs-note">选择当前工作区的正式成品，需已得到客户认可。选择和保存均不调用模型。</p>
      <label>搜索正式成品<input className="field" aria-label="搜索品牌样张" value={query} onChange={event => setQuery(event.target.value)} placeholder="输入图片名称" /></label>
      {filtered.map(file => <label className="bs-checkbox" key={file.id}><input type="checkbox" aria-label={`认可样张 ${file.name}`} checked={approved.includes(file.id)} disabled={!approved.includes(file.id) && approved.length >= 100} onChange={event => update('approvedSampleIds', event.target.checked ? [...approved, file.id] : approved.filter(id => id !== file.id))} />{file.name}</label>)}
      {!filtered.length && <p className="bs-note">{samples.length ? '没有匹配的成品，请换个名称搜索。' : '当前尚无可选择的正式图片；制作并确认成品后，可回来加入品牌样张。'}</p>}
      {!!approved.length && <div><h4>已认可样张</h4>{approved.map(id => { const file = files.find(file => file.id === id); return <p key={id}>{file?.name || '原样张暂未读取'}{(!file || file.unavailable || file.trashedAt) && ' · 请检查原项目文件'}<button type="button" className="text-button" aria-label={`移除品牌样张 ${file?.name || id}`} onClick={() => update('approvedSampleIds', approved.filter(item => item !== id))}>移除</button></p>; })}<BusinessImagePreview file={files.find(file => file.id === approved.at(-1) && !file.trashedAt && !file.unavailable)} runner={props.workflowRunner} /></div>}
    </RememberedDetails>
    {issue && <p className="bs-error bs-full" role="alert">{issue}</p>}<div className="bs-full"><BusinessFormStatus {...draft} onReset={draft.reset} onSave={() => { void draft.save(); }} /></div>
  </div>;
}
