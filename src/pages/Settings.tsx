import { ApplicationMaintenance } from '../components/ApplicationMaintenance';
import { ApplicationUpdates } from '../components/ApplicationUpdates';
import { BeadMarketSessions } from '../components/bead-market/BeadMarketSessions';
import { APP_VERSION } from '../lib/app-version';
import { AppearanceSettings } from '../components/AppearanceControl';
import { InterfaceLayoutSettings } from '../components/InterfaceLayoutControl';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, CheckCircle2, ChevronRight, ExternalLink, FolderOpen, KeyRound, LockKeyhole, Monitor, RotateCcw, Save, ShieldCheck, SlidersHorizontal, Sparkles, Wallet } from 'lucide-react';
import type { PageProps, Preferences } from '../types';
import { INITIAL_PREFERENCES } from '../data';
import { migratePreferences } from '../lib/preferences';
import { settingsPreferenceError } from '../lib/settings-preferences';
import { registerEditorSession } from '../lib/editor-session-guard';
import { downloadFile } from '../lib/files';
import './operations.css';

function Toggle({ id, checked, onChange, label }: { id?: string; checked: boolean; onChange: () => void; label: string }) { return <button id={id} type="button" role="switch" aria-checked={checked} aria-label={label} className={`op-toggle ${checked ? 'checked' : ''}`} onClick={onChange}><span>{checked && <Check size={10} />}</span></button>; }

const preferenceFields = [
  { key: 'studioName', label: '工作区名称', section: 'general' },
  { key: 'confirmGeneration', label: '生成前确认', section: 'general' },
  { key: 'reduceMotion', label: '界面动效', section: 'general' },
  { key: 'hourlyRate', label: '人工时薪', section: 'cost' },
  { key: 'channelFeePercent', label: '渠道抽成', section: 'cost' },
  { key: 'targetProfit', label: '目标利润', section: 'cost' },
  { key: 'monthlyBudget', label: '月度预算', section: 'cost' },
] as const;

export function Settings({ dataManagement, preferences, workspace, configuration, navigate, onUpdatePreferences, notify }: PageProps) {
  const [draft, setDraft] = useState<Preferences>({ ...migratePreferences(preferences), studioName: workspace.name });
  const [section, setSection] = useState('general');
  const [error, setError] = useState('');
  const saved = { ...migratePreferences(preferences), studioName: workspace.name };
  const savedSignature = JSON.stringify(saved);
  const baseline = useRef(saved), scope = useRef(workspace.id), draftRef = useRef(draft); draftRef.current = draft;
  const form = useRef<HTMLFormElement>(null), saving = useRef(false);
  const ready = scope.current === workspace.id;
  const changed = ready && JSON.stringify(draft) !== JSON.stringify(baseline.current);
  const changedFields = preferenceFields.filter(field => !Object.is(draft[field.key], baseline.current[field.key]));
  const fieldId = (key: string) => `settings-${workspace.id}-${key}`;
  useEffect(() => {
    const currentSaved = { ...migratePreferences(preferences), studioName: workspace.name };
    if (scope.current !== workspace.id) { scope.current = workspace.id; baseline.current = currentSaved; draftRef.current = currentSaved; setDraft(currentSaved); setError(''); return; }
    const previous = baseline.current, clean = JSON.stringify(draftRef.current) === JSON.stringify(previous);
    baseline.current = currentSaved;
    if (clean || JSON.stringify(draftRef.current) === JSON.stringify(currentSaved)) { draftRef.current = currentSaved; setDraft(currentSaved); setError(''); }
    else if (draftRef.current.studioName === previous.studioName && currentSaved.studioName !== previous.studioName) setDraft(current => ({ ...current, studioName: currentSaved.studioName }));
  }, [workspace.id, savedSignature]);
  const update = (changes: Partial<Preferences>) => { setDraft(current => ({ ...current, ...changes })); setError(''); };
  function savePreferences() {
    if (scope.current !== workspace.id || saving.current) return false;
    if (JSON.stringify(draftRef.current) === JSON.stringify(baseline.current)) return true;
    const message = settingsPreferenceError(draftRef.current);
    if (message) { setError(message); setSection(message.includes('工作区名称') ? 'general' : 'cost'); return false; }
    const next = { ...draftRef.current, studioName: draftRef.current.studioName.trim() };
    saving.current = true;
    try {
      if (onUpdatePreferences(next) !== true) throw new Error('未收到本机写入确认，请重试保存；本次输入仍保留。');
      baseline.current = next; draftRef.current = next; setDraft(next); setError(''); guard.current.dirty = false;
      notify('当前工作区的名称与偏好已保存'); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '设置尚未保存，当前输入保留，请检查本机存储后重试。'); return false; }
    finally { saving.current = false; }
  }
  const save = (event: FormEvent) => { event.preventDefault(); savePreferences(); };
  function discard() { const next = { ...baseline.current }; draftRef.current = next; setDraft(next); setError(''); guard.current.dirty = false; notify('已还原到本工作区最近保存的设置', 'info'); }
  const restore = () => { const defaults = { ...INITIAL_PREFERENCES, studioName: workspace.name }; draftRef.current = defaults; setDraft(defaults); setError(''); notify('已填入本区默认值，点击保存后生效；也可放弃修改。', 'info'); };
  function focusPreference(field: typeof preferenceFields[number]) { setSection(field.section); requestAnimationFrame(() => { const target = document.getElementById(fieldId(field.key)); if (target && form.current?.contains(target)) target.focus(); }); }
  const guard = useRef({ dirty: changed, error, save: savePreferences }); guard.current = { dirty: changed, error, save: savePreferences };
  useEffect(() => registerEditorSession({ id: `settings-${workspace.id}`, projectId: '', label: '本工作区设置', kind: 'preferences', getState: () => ({ dirty: guard.current.dirty, pending: false, persistenceError: guard.current.dirty ? guard.current.error || '设置尚未保存，请保存或还原修改后离开。' : undefined }), save: async () => guard.current.save(), exportRecovery: () => downloadFile(`序作-未保存设置-${workspace.id}.json`, JSON.stringify({ type: 'xuzuo-settings-draft', version: 1, workspaceId: workspace.id, preferences: draftRef.current }, null, 2), 'application/json;charset=utf-8') }), [workspace.id]);
  const sections = [{ id: 'general', icon: SlidersHorizontal, name: '常规设置', description: '工作区与使用偏好' }, { id: 'api', icon: KeyRound, name: '模型与连接', description: '模型、凭证与平台登录' }, { id: 'cost', icon: Wallet, name: '成本与报价', description: '本区成本与利润参数' }, { id: 'local', icon: ShieldCheck, name: '数据与版本', description: '本区数据与版本偏好' }];
  return <div className="op-page">
    <div className="page-heading"><div><p className="op-eyebrow">MAKE IT FEEL LIKE YOUR OWN</p><h1 className="page-title">设置</h1><p className="page-description">外观与布局即时保存；工作区信息和报价参数点击保存后生效。</p></div><span className="op-settings-version"><Monitor size={15} /> 桌面工作台 v{APP_VERSION}</span></div>
    <div className="op-workspace-scope"><FolderOpen size={15} /><span>当前工作区</span><b title={workspace.name}>{workspace.name}</b><small>与其他工作区独立</small></div>
    <div className="op-settings-layout"><aside className="op-settings-nav">{sections.map(item => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)}><item.icon size={18} /><span><b>{item.name}</b><small>{item.description}</small></span><ChevronRight size={14} /></button>)}<div className="op-settings-support"><span><Sparkles size={17} /></span><b>从容创作，有序交付。</b><p>真实任务在桌面后台执行，模拟记录单独保留。</p></div></aside>
      <form ref={form} className="op-settings-content" aria-label="当前工作区设置" noValidate onSubmit={save} onKeyDown={event => { if (event.target instanceof Node && event.currentTarget.contains(event.target) && !event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); savePreferences(); } }}>
        {section === 'general' && <><InterfaceLayoutSettings notify={notify} /><AppearanceSettings notify={notify} /><section className="panel op-settings-panel"><header><h2>工作区信息</h2><p>名称会同步到当前工作区入口，不改动其他工作区。</p></header><div className="op-settings-fields"><label><span className="form-label">工作区名称</span><input id={fieldId('studioName')} aria-label="工作区名称" className="field" required maxLength={30} value={draft.studioName} onChange={e => update({ studioName: e.target.value })} placeholder="例如：品牌创作工作区" /><small>仅保存到本机，不会创建在线账号。</small></label><div className="op-readonly-row"><span>界面语言</span><b>简体中文</b></div></div></section><section className="panel op-settings-panel"><header><h2>本工作区的使用偏好</h2><p>这些偏好随当前工作区保存，切换工作区后分别读取。</p></header><div className="op-setting-switch-row"><div><b>生成前逐次确认</b><p>默认关闭。开启后，每次生成或精修前弹出确认窗口；关闭后，点击生成或精修会直接调用所选模型，并按实际用量记录费用。</p></div><Toggle id={fieldId('confirmGeneration')} checked={draft.confirmGeneration} onChange={() => update({ confirmGeneration: !draft.confirmGeneration, confirmGenerationVersion: 1 })} label="生成前逐次确认" /></div><div className="op-setting-switch-row"><div><b>减少界面动效</b><p>减少当前工作区内的过渡动画，保持更直接的操作体验。</p></div><Toggle id={fieldId('reduceMotion')} checked={draft.reduceMotion} onChange={() => update({ reduceMotion: !draft.reduceMotion })} label="减少界面动效" /></div></section></>}
        {section === 'api' && <><section className="panel op-settings-panel"><header><h2>全应用模型中心</h2><p>统一管理国内外供应商、模型能力及多份凭证，各工作区的流程可分别选择。</p></header><div className="op-readonly-row"><span>已配置连接</span><b>{configuration.connections.filter(item => !item.demo).length} 个</b></div><div className="op-readonly-row"><span>自定义模型</span><b>{configuration.models.filter(item => !item.demo).length} 个</b></div><div className="op-readonly-row"><span>凭证库</span><b>{configuration.vaultStatus.available ? '系统加密可用' : '请在桌面版使用'}</b></div><button type="button" className="btn btn-primary" onClick={() => navigate('models')}><KeyRound size={15} />打开模型中心<ChevronRight size={14} /></button></section><div className="op-settings-info"><ShieldCheck size={18} /><p>认证检查与实际任务分别验证，模型和凭证需与你的账户权限匹配。真实调用会产生供应商费用，密钥由系统加密保存。</p></div><BeadMarketSessions /></>}
        {section === 'cost' && <><section className="panel op-settings-panel"><header><h2>本工作区的默认报价参数</h2><p>仅本区报价读取这些默认值，你也可以在单个项目中调整。</p></header><div className="op-settings-fields op-two-columns"><label><span className="form-label">每小时人工成本（元）</span><input id={fieldId('hourlyRate')} aria-label="每小时人工成本" className="field" type="number" min="0" step="0.01" required value={draft.hourlyRate} onChange={e => update({ hourlyRate: Number(e.target.value) })} /><small>将沟通、制作、检查和返工时间计入成本。</small></label><label><span className="form-label">渠道抽成（%）</span><input id={fieldId('channelFeePercent')} aria-label="渠道抽成" className="field" type="number" min="0" max="99.99" step="0.01" required value={draft.channelFeePercent} onChange={e => update({ channelFeePercent: Number(e.target.value) })} /><small>由你按真实渠道费用设置，不代表平台当前费率。</small></label><label><span className="form-label">目标利润金额（元）</span><input id={fieldId('targetProfit')} aria-label="目标利润金额" className="field" type="number" min="0" step="0.01" required value={draft.targetProfit} onChange={e => update({ targetProfit: Number(e.target.value) })} /><small>用于计算本区项目成本条件下的建议报价。</small></label><label><span className="form-label">本区月度预算（元）</span><input id={fieldId('monthlyBudget')} aria-label="本区月度预算" className="field" type="number" min="0" step="0.01" placeholder="选填，留空不设上限" value={draft.monthlyBudget ?? ''} onChange={e => update({ monthlyBudget: e.target.value.trim() === '' ? undefined : Number(e.target.value) })} /><small>留空不设上限，填写 0 表示零上限；不改变其他工作区或供应商预算。</small></label></div></section><div className="op-settings-info"><Wallet size={18} /><p>本区项目的费用按每次调用累计。精修、重生成和 AI 复核独立入账，切回旧版本不减少已发生的费用。建议报价不保证成交或盈利。</p></div></>}
        {section === 'local' && <>{dataManagement}<ApplicationUpdates /><ApplicationMaintenance /><section className="panel op-settings-panel"><header><h2>本地数据与版本</h2><p>本区项目与非秘密偏好保存在本机，其他工作区的数据独立管理。</p></header><div className="op-readonly-row"><span><FolderOpen size={16} /> 当前工作区</span><b>{workspace.name}</b></div><div className="op-readonly-row"><span>项目与偏好位置</span><b>本机存储 · 按工作区隔离</b></div><div className="op-readonly-row"><span>素材会话缓存</span><b>刷新或重启后清空</b></div><div className="op-readonly-row"><span><LockKeyhole size={16} /> 真实 API Key</span><b>{configuration.vaultStatus.available ? '主进程系统加密 · 不随项目导出' : '浏览器不可输入与保存'}</b></div><div className="op-setting-readonly-row"><span><ShieldCheck size={16} />版本与账本保护</span><b>始终保留</b></div><p>保存和恢复会新增版本，历史费用不随文件回收删除。当前没有自动清理历史的策略。</p></section><section className="panel op-settings-panel"><header><h2>恢复本区默认偏好</h2><p>先填入本区默认值，保存后才生效；工作区名称、项目和历史费用保持。</p></header><button type="button" className="btn btn-secondary" onClick={restore}><RotateCcw size={15} /> 填入本区默认偏好</button></section><div className="op-settings-info"><ShieldCheck size={18} /><p>工作流可生成真实 Office 文件并附检查报告。复杂版式、原稿保真和所有公式重算需另行验证，不能凭文件生成成功就认定内容正确。</p></div></>}
        {changed || error ? <section className={`op-settings-save-bar${error ? ' is-error' : ''}`} aria-label="工作区设置保存操作"><div className="op-settings-save-summary"><div className="op-settings-save-heading"><span className="op-unsaved-dot" /><strong role="status">{error ? '设置尚未保存' : `${changedFields.length || 1} 项修改待保存`}</strong><span className="op-settings-save-workspace" title={workspace.name}>当前工作区 · {workspace.name}</span></div>{changedFields.length > 0 && <div className="op-settings-change-list" aria-label="待保存的修改">{changedFields.map(field => <button type="button" key={field.key} className="op-settings-change-chip" onClick={() => focusPreference(field)} title={`查看${field.label}`}>{field.label}</button>)}</div>}{error && <p className="op-settings-save-error" role="alert">{error}</p>}</div><div className="op-settings-save-actions"><button type="button" className="btn btn-secondary" disabled={!changed} onClick={discard}>放弃修改</button><button className="btn btn-primary" type="submit" disabled={!ready || !changed}><Save size={15} />{error ? '重试保存' : '保存设置'}</button></div></section> : (section === 'general' || section === 'cost') && <p className="op-settings-saved-note" role="status"><CheckCircle2 size={15} /><span>本区设置无待保存修改</span><small>Ctrl / ⌘ + S 保存</small></p>}
      </form>
    </div><div className="op-settings-footer"><span>序作工作台 · 自由职业者的创作与交付空间</span><button className="btn btn-ghost" onClick={() => notify('真实调用由桌面后台执行并记录用量，未核对费用不得当作零成本；模拟模式不会调用供应商。', 'info')}>关于序作工作台 <ExternalLink size={13} /></button></div>
  </div>;
}

