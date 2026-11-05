import { ModalPortal } from '../components/ModalPortal';
import { hasManagedDialog } from '../lib/dialog-stack';
import { Select, isSelectInteraction } from '../components/Select';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, BadgeCheck, BookOpen, Check, ChevronRight, CircleHelp, ClipboardCheck, Cpu, Globe2, KeyRound, Link2, LoaderCircle, LockKeyhole, Pencil, Plus, Power, Search, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { ApiProtocol, CredentialMetadata, ModelCapability, ModelConfiguration, ModelConnection, ModelPricing } from '../configuration-types';
import type { PageProps } from '../types';
import { CAPABILITY_LABELS, PROTOCOL_LABELS, PROVIDER_PRESETS } from '../model-presets';
import { downloadFile } from '../lib/files';
import { connectionError, modelError, publicModelPricing } from '../lib/configuration';
import { connectionCredentials, modelSetupSummary, selectedConnectionCredential } from '../lib/model-setup';
import { automaticBillingEntry } from '../lib/catalog-billing';
import { MODEL_CATALOG, MODEL_CATALOG_DATE, catalogConnectionDraft, catalogConnectionMatches, catalogModelDraft, matchingCatalogConnections } from '../model-catalog';
import type { ModelCatalogEntry } from '../model-catalog';
import { CatalogPriceDetails, ModelCatalog } from '../components/ModelCatalog';
import { RememberedDetails } from '../components/RememberedDetails';
import './models.css';

type ConnectionDraft = Omit<ModelConnection, 'id' | 'status' | 'demo'>;
type ModelDraft = Omit<ModelConfiguration, 'id' | 'demo'>;
type ModelsTab = 'connections' | 'models' | 'credentials';
type CredentialDraft = { id?: string; name: string; connectionId: string };

const PRICING_UNITS: Record<ModelPricing['unit'], string> = { 'million-tokens': '每百万 Token', image: '每张图片', second: '每秒', request: '每次请求' };
const CONFIGURABLE_PROTOCOLS = (Object.keys(PROTOCOL_LABELS) as ApiProtocol[]).filter(protocol => protocol !== 'demo');
const CAPABILITIES = Object.keys(CAPABILITY_LABELS) as ModelCapability[];

function cleanEndpoint(value: string) {
  if (!value) return '';
  try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.toString(); }
  catch { return ''; }
}

function exportConfiguration(connections: ModelConnection[], models: ModelConfiguration[]) {
  const safeConnections = connections.map(item => ({ id: item.id, name: item.name, providerId: item.providerId, protocol: item.protocol, baseUrl: cleanEndpoint(item.baseUrl), enabled: item.enabled, status: item.status, demo: Boolean(item.demo) }));
  const safeModels = models.map(item => ({ id: item.id, name: item.name, modelId: item.modelId, connectionId: item.connectionId, capabilities: [...item.capabilities], pricing: publicModelPricing(item.pricing), enabled: item.enabled, demo: Boolean(item.demo) }));
  return downloadFile('序作-模型连接配置.json', JSON.stringify({ type: 'xuzuo-model-configuration', version: 1, configurationOnly: true, connections: safeConnections, models: safeModels, note: '仅包含连接与模型元数据，不包含凭证、API Key 或凭证引用。地址中的查询参数及认证信息已省略。' }, null, 2));
}

function Modal({ title, subtitle, icon, children, footer, onClose, busy = false, className = '', error = '' }: { title: string; subtitle: string; icon: ReactNode; children: ReactNode; footer: ReactNode; onClose: () => void; busy?: boolean; className?: string; error?: string }) {
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  const panelRef = useRef<HTMLElement>(null);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => { if (error) { const body = panelRef.current?.querySelector<HTMLElement>('.mdl-dialog-body'); if (body) body.scrollTop = 0; } }, [error]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>('input:not([disabled]):not([aria-hidden="true"]), [role="combobox"]:not([disabled]), textarea:not([disabled])')?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (hasManagedDialog()) return;
      if ((event.key === 'Escape' || event.key === 'Tab') && isSelectInteraction(event)) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busyRef.current) closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const elements = [...(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([aria-hidden="true"]), textarea:not([disabled]), select:not([disabled]), a[href]') || [])].filter(element => element.getClientRects().length > 0);
      const first = elements[0]; const last = elements[elements.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', keydown, true); previous?.focus(); };
  }, []);
  return <ModalPortal onClose={onClose} busy={busy}><div className="mdl-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><section ref={panelRef} className={`mdl-dialog ${className}`} role="dialog" aria-modal="true" aria-label={title}><header><span className="mdl-dialog-icon">{icon}</span><div><h2>{title}</h2><p>{subtitle}</p></div><button type="button" className="btn-icon" disabled={busy} aria-label={`关闭${title}`} onClick={onClose}><X size={19} /></button></header><div className="mdl-dialog-body">{error && <p className="mdl-form-error mdl-form-error-top" role="alert">{error}</p>}{children}</div><footer>{footer}</footer></section></div></ModalPortal>;
}

function EnabledButton({ enabled, onClick, disabled = false, name }: { enabled: boolean; onClick: () => void; disabled?: boolean; name: string }) {
  return <button type="button" className={`mdl-enable-button ${enabled ? 'is-enabled' : ''}`} aria-label={`${enabled ? '停用' : '启用'}${name}`} title={enabled ? '停用后不能用于新任务' : '启用此配置'} onClick={onClick} disabled={disabled}><Power size={13} />{enabled ? '已启用' : '已停用'}</button>;
}

function emptyModel(connectionId: string): ModelDraft {
  return { name: '', modelId: '', connectionId, capabilities: ['text'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '', output: '' }, enabled: true };
}

function unverifiedPricing(pricing: ModelPricing, clearValues = false): ModelPricing {
  return { unit: pricing.unit, currency: pricing.currency, input: clearValues ? '' : pricing.input, output: clearValues ? '' : pricing.output, exchangeRate: pricing.exchangeRate, referenceOnly: pricing.referenceOnly === true, ...(pricing.referenceOnly ? { referenceNote: '复杂计价仍需核对。要自行填写单价，请先切换手动核算。' } : {}) };
}

export function Models({ configuration, workflowRunner, notify }: PageProps) {
  const { connections, models, credentials, vaultStatus } = configuration;
  const [tab, setTab] = useState<ModelsTab>('connections');
  const [query, setQuery] = useState('');
  const [connectionEditor, setConnectionEditor] = useState<{ id?: string; draft: ConnectionDraft } | null>(null);
  const [modelEditor, setModelEditor] = useState<{ id?: string; draft: ModelDraft; catalogEntryId?: string } | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogConnection, setCatalogConnection] = useState<ModelCatalogEntry>();
  const [resumeCatalog, setResumeCatalog] = useState<ModelCatalogEntry>();
  const [modelNotice, setModelNotice] = useState('');
  const [credentialEditor, setCredentialEditor] = useState<CredentialDraft | null>(null);
  const [secret, setSecret] = useState('');
  const [savingCredential, setSavingCredential] = useState(false);
  const [busyCredentialId, setBusyCredentialId] = useState('');
  const [formError, setFormError] = useState('');
  const [checkingId, setCheckingId] = useState('');
  const [connectionCheck, setConnectionCheck] = useState<ModelConnection | null>(null);
  const [checkCredentialId, setCheckCredentialId] = useState('');
  const [checkMessage, setCheckMessage] = useState('');
  const [checkSucceeded, setCheckSucceeded] = useState<boolean>();
  const checkPending = useRef(false), credentialSavePending = useRef(false), credentialTogglePending = useRef(false);
  const setup = modelSetupSummary(connections, models, credentials);
  const checkKeys = connectionCheck ? connectionCredentials(credentials, connectionCheck.id) : [];
  const checkKeySignature = checkKeys.map(item => item.id).join('|');
  useEffect(() => { if (connectionCheck && !checkPending.current) setCheckCredentialId(current => selectedConnectionCredential(credentials, connectionCheck.id, current)); }, [connectionCheck?.id, checkKeySignature]);
  const availableConnections = connections.filter(connection => !connection.demo);
  const lowerQuery = query.trim().toLowerCase();
  const matches = (...values: string[]) => values.join(' ').toLowerCase().includes(lowerQuery);
  const filteredConnections = connections.filter(item => matches(item.name, PROVIDER_PRESETS.find(preset => preset.id === item.providerId)?.name || '本地演示', item.baseUrl, PROTOCOL_LABELS[item.protocol]));
  const filteredModels = models.filter(item => matches(item.name, item.modelId, connections.find(connection => connection.id === item.connectionId)?.name || '', ...item.capabilities.map(capability => CAPABILITY_LABELS[capability])));
  const filteredCredentials = credentials.filter(item => matches(item.name, connections.find(connection => connection.id === item.connectionId)?.name || ''));
  const currentPreset = connectionEditor ? PROVIDER_PRESETS.find(preset => preset.id === connectionEditor.draft.providerId) || PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1] : undefined;
  const originEntry = modelEditor?.catalogEntryId ? MODEL_CATALOG.find(item => item.id === modelEditor.catalogEntryId) : undefined;
  const automaticBilling = modelEditor ? Boolean(automaticBillingEntry(modelEditor.draft, connections)) : false;

  useEffect(() => {
    if (!resumeCatalog) return;
    const compatible = matchingCatalogConnections(resumeCatalog, connections);
    if (compatible.length !== 1) return;
    const draft = catalogModelDraft(resumeCatalog, compatible[0]);
    setModelEditor({ draft, catalogEntryId: resumeCatalog.id }); setResumeCatalog(undefined); setCatalogConnection(undefined);
  }, [resumeCatalog, connections]);

  function openConnection(connection?: ModelConnection) {
    setFormError(''); setCatalogConnection(undefined);
    if (connection && !connection.demo) { const { name, providerId, protocol, baseUrl, enabled } = connection; setConnectionEditor({ id: connection.id, draft: { name, providerId, protocol, baseUrl, enabled } }); }
    else { const preset = PROVIDER_PRESETS[0]; setConnectionEditor({ draft: { name: '', providerId: preset.id, protocol: preset.protocol, baseUrl: preset.baseUrl, enabled: true } }); }
  }
  function updateConnection(changes: Partial<ConnectionDraft>) { setConnectionEditor(current => current && { ...current, draft: { ...current.draft, ...changes } }); setFormError(''); }
  function selectProvider(providerId: string) { const preset = PROVIDER_PRESETS.find(item => item.id === providerId); if (preset) updateConnection({ providerId, protocol: preset.protocol, baseUrl: preset.baseUrl }); }
  function saveConnection(event: FormEvent) {
    event.preventDefault(); if (!connectionEditor) return;
    if (!connectionEditor.draft.name.trim() || !connectionEditor.draft.baseUrl.trim()) { setFormError('请填写连接名称和从服务商控制台获取的 Base URL。'); return; }
    const validation = connectionError(connectionEditor.draft); if (validation) { setFormError(validation); return; }
    if (catalogConnection && !catalogConnectionMatches(catalogConnection, { ...connectionEditor.draft, id: 'new-catalog-connection', status: 'configured' })) { setFormError('此模型价目绑定指定供应商、协议和地域。请保留相应官方连接信息；其它服务可返回手动填写。'); return; }
    if (configuration.saveConnection(connectionEditor.draft, connectionEditor.id)) { setConnectionEditor(null); if (catalogConnection) setResumeCatalog(catalogConnection); } else setFormError(configuration.storageIssue?.message || '连接尚未保存，请检查本机配置存储后重试；当前输入保留。');
  }
  function closeConnection() { setConnectionEditor(null); setFormError(''); if (catalogConnection) { setCatalogOpen(true); setCatalogConnection(undefined); } }
  function openCatalog() { setFormError(''); setModelNotice(''); setModelEditor(null); setCatalogOpen(true); }
  function selectCatalog(entry: ModelCatalogEntry, connectionId: string) {
    const connection = connections.find(item => item.id === connectionId);
    if (!connection) { notify('连接已变化，请重新选择。', 'error'); return; }
    try { const draft = catalogModelDraft(entry, connection); setModelEditor({ draft, catalogEntryId: entry.id }); setCatalogOpen(false); setModelNotice('已带入目录参数，保存本身不会调用模型。'); setFormError(''); }
    catch (error) { notify(error instanceof Error ? error.message : '此型号暂不能填入运行配置。', 'error'); }
  }
  function createCatalogConnection(entry: ModelCatalogEntry) {
    try { const draft = catalogConnectionDraft(entry); setCatalogConnection(entry); setConnectionEditor({ draft }); setCatalogOpen(false); setFormError(''); }
    catch (error) { notify(error instanceof Error ? error.message : '请先配置对应地域的官方连接。', 'error'); }
  }
  function checkConnection(connection: ModelConnection) { if (checkPending.current) return; setConnectionCheck(connection); setCheckCredentialId(selectedConnectionCredential(credentials, connection.id)); setCheckMessage(''); setCheckSucceeded(undefined); }
  async function sendConnectionCheck() {
    if (!connectionCheck || !checkCredentialId || checkPending.current || !workflowRunner.runtimeStatus.available) return;
    checkPending.current = true;
    setCheckingId(connectionCheck.id); setCheckMessage(''); setCheckSucceeded(undefined);
    try { const result = await configuration.checkConnection(connectionCheck.id, checkCredentialId); setCheckSucceeded(result?.ok); setCheckMessage(result?.message || '认证检查已结束；当前接口未返回详细结果，请查看系统提示。'); }
    catch { setCheckSucceeded(false); setCheckMessage('认证检查未完成，请检查连接、凭证和网络后重试。'); }
    finally { checkPending.current = false; setCheckingId(''); }
  }
  function openModel(model?: ModelConfiguration) {
    if (!model) { openCatalog(); return; }
    setFormError(''); setModelNotice(''); setCatalogOpen(false);
    const { name, modelId, connectionId, capabilities, pricing, enabled } = model;
    const connection = connections.find(item => item.id === connectionId);
    const source = pricing.verifiedAt && pricing.officialUrl && connection ? MODEL_CATALOG.find(entry => entry.modelId === modelId && entry.checkedAt === pricing.verifiedAt && catalogConnectionMatches(entry, connection)) : undefined;
    setModelEditor({ id: model.demo ? undefined : model.id, draft: { name: model.demo ? `${name}（副本）` : name, modelId, connectionId, capabilities: [...capabilities], pricing: { ...pricing }, enabled }, catalogEntryId: source?.id });
  }
  function openManualModel() { setCatalogOpen(false); setModelNotice(''); setFormError(''); setModelEditor({ draft: emptyModel(availableConnections[0]?.id || '') }); }
  function updateModel(changes: Partial<ModelDraft>) {
    const identityChanged = Boolean(modelEditor && (changes.modelId !== undefined && changes.modelId !== modelEditor.draft.modelId || changes.connectionId !== undefined && changes.connectionId !== modelEditor.draft.connectionId || changes.capabilities && JSON.stringify(changes.capabilities) !== JSON.stringify(modelEditor.draft.capabilities)));
    setModelEditor(current => current && { ...current, ...(identityChanged ? { catalogEntryId: undefined } : {}), draft: { ...current.draft, ...changes, ...(identityChanged ? { pricing: unverifiedPricing(current.draft.pricing, true) } : {}) } });
    if (identityChanged) setModelNotice('型号、连接或能力已改变，旧单价和官方核对标记已清除，请重新核对价格。'); setFormError('');
  }
  function updatePricing(changes: Partial<ModelPricing>) {
    const exchangeOnly = Object.keys(changes).every(key => key === 'exchangeRate');
    const formatChanged = Boolean(modelEditor && (changes.unit && changes.unit !== modelEditor.draft.pricing.unit || changes.currency && changes.currency !== modelEditor.draft.pricing.currency));
    setModelEditor(current => !current || current.draft.pricing.referenceOnly && !exchangeOnly ? current : { ...current, ...(exchangeOnly ? {} : { catalogEntryId: undefined }), draft: { ...current.draft, pricing: exchangeOnly ? { ...current.draft.pricing, ...changes } : { ...unverifiedPricing(current.draft.pricing, formatChanged), ...changes, referenceOnly: false } } });
    if (!exchangeOnly) setModelNotice(formatChanged ? '计价单位或币种已变化，旧单价已清空，请重新填写。' : '价格已按手动输入处理，不再标记为已核对官方单价。'); setFormError('');
  }
  function useManualPricing() {
    setModelEditor(current => current && { ...current, catalogEntryId: undefined, draft: { ...current.draft, pricing: { unit: current.draft.pricing.unit, currency: current.draft.pricing.currency, input: '', output: '', exchangeRate: current.draft.pricing.exchangeRate, referenceOnly: false } } });
    setModelNotice('已切换手动核算并清除参考数值与官方认证。请按自己的实际计费规则填写单价，无法确认时留空。');
  }
  function saveModel(event: FormEvent) {
    event.preventDefault(); if (!modelEditor) return;
    if (!modelEditor.draft.name.trim() || !modelEditor.draft.modelId.trim() || !modelEditor.draft.connectionId) { setFormError('请填写显示名称、真实模型 ID，并选择所属连接。'); return; }
    if (!modelEditor.draft.capabilities.length) { setFormError('至少选择一种模型能力。'); return; }
    const validation = modelError(modelEditor.draft, connections); if (validation) { setFormError(validation); return; }
    if (configuration.saveModel(modelEditor.draft, modelEditor.id)) setModelEditor(null); else setFormError(configuration.storageIssue?.message || '模型尚未保存，请检查本机配置存储后重试；当前输入保留。');
  }
  function closeCredential() { setSecret(''); setCredentialEditor(null); setFormError(''); }
  function openCredential(credential?: CredentialMetadata, connectionId?: string) {
    setSecret(''); setFormError('');
    setCredentialEditor(credential ? { id: credential.id, name: credential.name, connectionId: credential.connectionId } : { name: '', connectionId: connectionId || availableConnections[0]?.id || '' });
  }
  async function saveCredential(event: FormEvent) {
    event.preventDefault();
    if (!credentialEditor || !vaultStatus.available || credentialSavePending.current) return;
    if (!credentialEditor.name.trim() || !credentialEditor.connectionId || !secret.trim()) { setFormError('请填写凭证名称、所属连接和新的 API Key。'); return; }
    credentialSavePending.current = true;
    const input = { ...credentialEditor, name: credentialEditor.name.trim(), secret: secret.trim() };
    setSecret(''); setSavingCredential(true); setFormError('');
    try { if (await configuration.saveCredential(input)) setCredentialEditor(null); else setFormError('未能保存。密钥输入已清空，请确认桌面密钥库状态后重新填写。'); }
    catch { setFormError('保存失败。密钥输入已清空，请重新填写后重试。'); }
    finally { input.secret = ''; credentialSavePending.current = false; setSavingCredential(false); }
  }
  async function toggleCredential(credential: CredentialMetadata) {
    if (credentialTogglePending.current) return; credentialTogglePending.current = true;
    setBusyCredentialId(credential.id);
    try { await configuration.setCredentialEnabled(credential.id, !credential.enabled); }
    catch { notify('无法更新凭证状态，请稍后重试。', 'error'); }
    finally { credentialTogglePending.current = false; setBusyCredentialId(''); }
  }
  async function exportSafe() { try { if (await exportConfiguration(connections, models)) notify('已导出连接与模型配置，不包含 API Key 或凭证。'); } catch (error) { notify(error instanceof Error ? error.message : '模型连接配置未能导出。', 'error'); } }
  function copyDocumentation(url: string) {
    void navigator.clipboard.writeText(url).then(() => notify('官方文档链接已复制，可以粘贴到浏览器查看。')).catch(() => notify(`官方文档：${url}`, 'info'));
  }
  const add = () => { if (tab === 'connections') openConnection(); else if (tab === 'models') openModel(); else openCredential(); };
  const switchTab = (next: ModelsTab) => { setTab(next); setQuery(''); };

  return <div className="mdl-page">
    <div className="page-heading"><div><p className="mdl-eyebrow">YOUR MODELS, YOUR WAY</p><h1 className="page-title">模型与连接</h1><p className="page-description">把不同服务商、模型与密钥整理好，让每一步都可以自己选择。</p></div><div className="mdl-heading-actions"><button className="btn btn-secondary" onClick={exportSafe}><ArrowDownToLine size={15} />导出配置</button><button className="btn btn-primary" onClick={add} disabled={tab === 'credentials' && availableConnections.length === 0}><Plus size={16} />{tab === 'connections' ? '添加连接' : tab === 'models' ? '添加模型' : '添加 API Key'}</button></div></div>
    <RememberedDetails className="mdl-setup-disclosure" rememberKey="models:setup-guide" defaultOpen={!setup.readyModels.length}><summary>{setup.readyModels.length ? `${setup.readyModels.length} 个模型已配齐配置 · 设置指南` : '首次设置：连接 → 模型 → Key'}</summary><section className="mdl-setup-panel panel" aria-label="模型配置进度"><div className="mdl-setup-steps"><button onClick={() => switchTab('connections')}><Link2 size={18} /><span><strong>1. 服务连接</strong><small>{setup.enabledConnections.length} 条启用 / {setup.realConnections.length} 条真实连接</small></span></button><button onClick={() => switchTab('models')}><Cpu size={18} /><span><strong>2. 模型配置</strong><small>{setup.enabledModels.length} 个启用模型</small></span></button><button onClick={() => switchTab('credentials')}><KeyRound size={18} /><span><strong>3. API Key</strong><small>{setup.enabledKeys.length} 把启用凭证</small></span></button></div><footer><p><ShieldCheck size={15} />{setup.readyModels.length ? `${setup.readyModels.length} 个模型的本地配置已配齐，执行前仍会预检接口。` : !setup.realConnections.length ? '先添加服务连接，再选择模型并保存该连接的 Key。' : !setup.enabledConnections.length ? '现有连接全部停用，请在服务连接中启用。' : !setup.realModels.length ? '连接已有，下一步从目录选择适合用途的模型。' : !setup.enabledModels.length ? '现有模型尚未启用，或所属连接已停用。' : '模型还缺同一连接下启用的 Key，配置后即可用于工作流。'}</p><button className="btn btn-secondary" onClick={() => { if (!setup.realConnections.length) openConnection(); else if (!setup.enabledConnections.length) switchTab('connections'); else if (!setup.realModels.length) openCatalog(); else if (!setup.enabledModels.length) switchTab('models'); else if (setup.missingKeyConnectionId) { switchTab('credentials'); openCredential(undefined, setup.missingKeyConnectionId); } else switchTab('models'); }}>{!setup.realConnections.length ? '添加服务连接' : !setup.enabledConnections.length ? '管理服务连接' : !setup.realModels.length ? '选择模型' : !setup.enabledModels.length ? '管理模型' : setup.missingKeyConnectionId ? '补全 API Key' : '查看模型配置'}<ArrowRight size={14} /></button></footer></section></RememberedDetails>
    <section className="mdl-catalog-entry"><BookOpen size={22} /><div><strong>不知道填哪个模型？从官方目录选择</strong><p>文字、图片理解、生成和编辑分开筛选，查看准确 ID、价格条件与参考花费。资料核对 {MODEL_CATALOG_DATE}。</p></div><button className="btn btn-primary" onClick={openCatalog}>浏览模型目录<ArrowRight size={15} /></button></section>
    <div className="mdl-safety-note"><CircleHelp size={15} /><p>供应商预设和能力勾选不等于全部接口已验证。工作流真实运行前会检查适配情况；未支持的协议会阻止执行。认证检查仅验证所选凭证访问基础接口的结果，不保证所有模型、余额或多模态能力可用。</p></div>
    <div className="mdl-toolbar"><div className="tabs mdl-tabs">{([{ id: 'connections', name: '服务连接', icon: Link2, count: connections.length }, { id: 'models', name: '模型配置', icon: Cpu, count: models.length }, { id: 'credentials', name: 'API Key', icon: KeyRound, count: credentials.length }] as const).map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => switchTab(item.id)}><item.icon size={15} />{item.name}<span>{item.count}</span></button>)}</div><label className="mdl-search"><Search size={15} /><input aria-label="搜索模型与连接" value={query} onChange={event => setQuery(event.target.value)} placeholder={tab === 'connections' ? '搜索服务商、连接或协议…' : tab === 'models' ? '搜索模型名称、ID 或能力…' : '搜索凭证名称或所属连接…'} /></label></div>

    {tab === 'connections' && <><div className="mdl-section-heading"><span>从连接开始<b>{filteredConnections.length}</b></span><small>每条连接可配置多个模型与多把 Key</small></div><div className="mdl-card-grid">{query && !filteredConnections.length && <div className="panel mdl-search-empty"><Search size={25} /><strong>没有匹配的连接</strong><p>现有配置没有删除，可清除搜索后查看。</p><button className="btn btn-secondary" onClick={() => setQuery('')}>清除搜索</button></div>}{filteredConnections.map(connection => {
      const preset = PROVIDER_PRESETS.find(item => item.id === connection.providerId);
      const modelCount = models.filter(model => model.connectionId === connection.id).length;
      const keyCount = credentials.filter(credential => credential.connectionId === connection.id).length;
      return <article className={`panel mdl-connection-card ${connection.enabled ? '' : 'mdl-disabled'}`} key={connection.id}><div className="mdl-card-heading"><span className={`mdl-provider-icon ${connection.demo ? 'mdl-provider-demo' : ''}`}>{connection.demo ? <Sparkles size={22} /> : <Globe2 size={21} />}</span><span className={`mdl-state ${connection.demo ? 'demo' : connection.status === 'format-checked' ? 'checked' : ''}`}>{connection.demo ? '内置演示' : connection.status === 'format-checked' ? '格式已检查' : '已保存 · 未验证'}</span></div><h2>{connection.name}</h2><p className="mdl-provider-name">{preset?.name || '本地演示引擎'}<span>·</span>{preset?.region || '无需联网'}</p><div className="mdl-endpoint"><span>{PROTOCOL_LABELS[connection.protocol]}</span><code title={connection.baseUrl}>{connection.demo ? '本机模拟 · 不调用任何 API' : connection.baseUrl}</code></div><div className="mdl-card-counts"><span><Cpu size={13} />{modelCount} 个模型</span><span><KeyRound size={13} />{connection.demo ? '无需凭证' : `${keyCount} 把 Key`}</span></div><footer><EnabledButton enabled={connection.enabled} name={connection.name} disabled={Boolean(connection.demo)} onClick={() => configuration.setConnectionEnabled(connection.id, !connection.enabled)} />{!connection.demo && <><button className="mdl-text-button" onClick={() => { setTab('credentials'); openCredential(undefined, connection.id); }}><KeyRound size={13} />添加 Key</button><button className="btn-icon" aria-label={`编辑连接${connection.name}`} title="编辑连接" onClick={() => openConnection(connection)}><Pencil size={14} /></button><button className="mdl-check-button" aria-label={`检查${connection.name}真实连接`} onClick={() => checkConnection(connection)}>{checkingId === connection.id ? <LoaderCircle size={13} className="spin" /> : <ClipboardCheck size={13} />}检查连接</button></>}</footer></article>;
    })}<button className="mdl-add-card" onClick={() => openConnection()}><span><Plus size={24} /></span><b>添加自己的服务连接</b><small>选预设，或填写自定义地址与协议</small><ArrowRight size={16} /></button></div></>}

    {tab === 'models' && <><div className="mdl-section-heading"><span>可选模型<b>{filteredModels.length}</b></span><small>支持哪些输入、输出，由具体模型与接口决定</small></div>{filteredModels.length ? <div className="mdl-model-list">{filteredModels.map(model => {
      const connection = connections.find(item => item.id === model.connectionId);
      const priceKnown = !model.pricing.referenceOnly && (model.pricing.input.trim() !== '' || model.pricing.output.trim() !== '');
      const officialPrice = Boolean(model.pricing.officialUrl && model.pricing.verifiedAt);
      const automatic = Boolean(automaticBillingEntry(model, connections));
      return <article className={`panel mdl-model-row ${model.enabled && connection?.enabled ? '' : 'mdl-disabled'}`} key={model.id}><span className="mdl-model-icon"><Cpu size={22} /></span><div className="mdl-model-main"><div><h2>{model.name}</h2>{model.demo && <span className="mdl-state demo">演示</span>}{connection && !connection.enabled && <span className="mdl-state">连接已停用</span>}</div><p><span>{connection?.name || '连接不存在'}</span><ChevronRight size={11} /><code>{model.modelId}</code></p><div className="mdl-capability-tags">{model.capabilities.map(capability => <span key={capability}>{CAPABILITY_LABELS[capability]}</span>)}</div></div><div className="mdl-model-price"><span>{model.demo ? '演示费用单独记账' : automatic ? '官方规则 · 自动核算' : model.pricing.referenceOnly ? `${officialPrice ? '官方参考' : '费用待核对'} · ${model.pricing.currency}` : priceKnown ? `${model.pricing.currency} · ${PRICING_UNITS[model.pricing.unit]}` : '价格待核对'}</span><small>{model.demo ? '不等于供应商真实单价' : automatic ? '实际用量 × 官方费率，自动累计原币与参考人民币' : model.pricing.referenceOnly ? '复杂计价，实际费用待核对' : priceKnown ? `输入 ${model.pricing.input || '待核对'} / 输出 ${model.pricing.output || '待核对'}` : '不会将空白价格视为免费'}</small>{model.pricing.officialUrl && model.pricing.verifiedAt && <small className="mdl-price-official">价目核对 {model.pricing.verifiedAt}</small>}</div><div className="mdl-model-actions"><EnabledButton enabled={model.enabled} name={model.name} disabled={Boolean(model.demo)} onClick={() => configuration.setModelEnabled(model.id, !model.enabled)} /><button className="btn-icon" aria-label={`${model.demo ? '复制' : '编辑'}模型${model.name}`} title={model.demo ? '复制为自定义配置' : '编辑模型'} onClick={() => openModel(model)}><Pencil size={15} /></button></div></article>;
    })}</div> : <div className="panel mdl-empty"><Cpu size={32} /><h2>没有找到匹配的模型</h2><p>{query ? '现有模型没有删除，可清除搜索后查看。' : '从官方目录选择模型，或手动填写模型 ID。'}</p>{query && <button className="btn btn-secondary" onClick={() => setQuery('')}>清除搜索</button>}<button className="btn btn-secondary" onClick={() => openModel()}><Plus size={14} />添加模型</button></div>}</>}

    {tab === 'credentials' && <><section className={`mdl-vault-banner ${vaultStatus.available ? 'is-available' : ''}`}><span><LockKeyhole size={25} /></span><div><h2>{vaultStatus.available ? '桌面密钥库可用' : '此预览不接收真实密钥'}</h2><p>{vaultStatus.available ? 'API Key 通过系统加密后保存在本机。界面仅接收名称、末四位和状态，不能回读完整密钥。' : vaultStatus.reason || '浏览器没有桌面系统密钥库。请使用 Windows EXE 保存 Key；浏览器中只能查看配置交互。'}</p></div><button className="btn btn-secondary" onClick={() => { void configuration.refreshCredentials().catch(() => notify('无法刷新密钥库状态，请稍后重试。', 'error')); }}><ShieldCheck size={14} />刷新状态</button></section>{availableConnections.length === 0 && <div className="mdl-inline-note"><Link2 size={15} /><span>先添加一条服务连接，再为它保存 API Key。本地演示引擎不需要凭证。</span><button onClick={() => { setTab('connections'); openConnection(); }}>添加连接<ArrowRight size={13} /></button></div>}<div className="mdl-section-heading"><span>凭证列表<b>{filteredCredentials.length}</b></span><small>多把 Key 按名称区分，在工作流步骤中明确选择</small></div>{filteredCredentials.length ? <div className="mdl-credential-list">{filteredCredentials.map(credential => <article className={`panel mdl-credential-row ${credential.enabled ? '' : 'mdl-disabled'}`} key={credential.id}><span className="mdl-key-icon"><KeyRound size={21} /></span><div className="mdl-credential-main"><h2>{credential.name}</h2><p>{connections.find(item => item.id === credential.connectionId)?.name || '所属连接不存在'}<span>·</span>更新于 {credential.updatedAt}</p></div><code className="mdl-masked-key">•••• •••• {credential.lastFour}</code><span className="mdl-key-local"><ShieldCheck size={12} />本机加密</span><EnabledButton enabled={credential.enabled} name={`凭证${credential.name}`} disabled={!vaultStatus.available || !!busyCredentialId} onClick={() => { void toggleCredential(credential); }} /><button className="btn-icon" disabled={!vaultStatus.available} aria-label={`替换凭证${credential.name}`} title="填写新 Key 替换，不回读原值" onClick={() => openCredential(credential)}><Pencil size={15} /></button></article>)}</div> : <div className="panel mdl-empty"><KeyRound size={34} /><h2>{query ? '没有找到匹配的凭证' : '给自己的模型配好钥匙'}</h2><p>{query ? '试试搜索凭证名称或所属连接。' : '凭证可分别命名、替换和停用；不会出现在配置导出中。'}</p>{query && <button className="btn btn-secondary" onClick={() => setQuery('')}>清除搜索</button>}<button className="btn btn-secondary" disabled={availableConnections.length === 0} onClick={() => openCredential()}><Plus size={14} />添加 API Key</button></div>}</>}

    <div className="mdl-page-footnote"><ShieldCheck size={14} /><span>配置保存在本机，各工作区可引用。保存配置和密钥不调用模型；认证检查会访问你选择的服务地址，真实生成和重试可能收费。预设不代表所有型号与模态均已联通。</span></div>

    {catalogOpen && <Modal title="选择官方模型" subtitle={`按供应商和用途选择 · 资料核对 ${MODEL_CATALOG_DATE}`} icon={<BookOpen size={23} />} className="mdl-catalog-dialog" onClose={() => setCatalogOpen(false)} footer={<><span className="mdl-modal-note"><ShieldCheck size={14} />目录不含账户余额或已领取赠送额度，实际以自己的控制台为准。</span><button className="btn btn-secondary" onClick={openManualModel}>手动填写</button><button className="btn btn-primary" onClick={() => setCatalogOpen(false)}>关闭目录</button></>}><ModelCatalog connections={connections} onSelect={selectCatalog} onCreateConnection={createCatalogConnection} onCopySource={copyDocumentation} /></Modal>}
    {connectionCheck && <Modal title="检查真实连接" subtitle={connectionCheck.name} icon={<Globe2 size={22} />} busy={!!checkingId} onClose={() => setConnectionCheck(null)} footer={<><span className="mdl-modal-note"><ShieldCheck size={13} />只检查基础接口，不运行生成任务</span><button className="btn btn-secondary" disabled={!!checkingId} onClick={() => setConnectionCheck(null)}>关闭</button><button className="btn btn-primary" disabled={!!checkingId || !checkCredentialId || !workflowRunner.runtimeStatus.available} onClick={() => { void sendConnectionCheck(); }}>{checkingId ? <LoaderCircle size={14} className="spin" /> : <ClipboardCheck size={14} />}{checkingId ? '正在检查…' : '发送认证检查'}</button></>}><div className="mdl-probe-target"><span>请求服务地址</span><code>{cleanEndpoint(connectionCheck.baseUrl)}</code><small>{PROTOCOL_LABELS[connectionCheck.protocol]}</small></div><label className="mdl-field"><span>明确选择这次使用的 Key <b>*</b></span><Select className="field" aria-label="认证检查使用凭证" value={checkCredentialId} onValueChange={value => { setCheckCredentialId(value); setCheckMessage(''); }} disabled={!!checkingId} options={[{ value: '', label: '请选择同一连接下启用的凭证' }, ...checkKeys.map(credential => ({ value: credential.id, label: `${credential.name} · ••••${credential.lastFour}` }))]} /><small>{checkKeys.length === 1 ? '已带入这条连接唯一启用的 Key，点击发送才开始检查。' : '不会自动轮换或尝试其他 Key。请求会发送到上方服务地址。'}</small></label>{checkKeys.length === 0 && <div className="mdl-inline-note"><KeyRound size={16} /><span>这条连接还没有启用的 API Key。</span><button disabled={!!checkingId} onClick={() => { const id = connectionCheck.id; setConnectionCheck(null); switchTab('credentials'); openCredential(undefined, id); }}>为此连接添加 Key<ArrowRight size={13} /></button></div>}{!workflowRunner.runtimeStatus.available && <p className="mdl-probe-unavailable">{workflowRunner.runtimeStatus.reason || '请在 Windows 桌面应用中执行真实连接检查。'}</p>}<div className="mdl-credential-notice"><ShieldCheck size={18} /><div><b>认证检查范围</b><p>仅访问服务商的基础认证或模型目录接口。成功结果不保证某个模型、额度、图像、语音或视频生成一定可用；失败也可能是该服务商没有提供此目录接口。</p></div></div>{checkMessage && <p className={`mdl-probe-message ${checkSucceeded === false ? 'failed' : checkSucceeded ? 'passed' : ''}`} role={checkSucceeded === false ? 'alert' : 'status'}>{checkSucceeded === true ? <Check size={15} /> : <CircleHelp size={15} />}{checkMessage}</p>}</Modal>}
    {connectionEditor && <Modal error={formError} title={connectionEditor.id ? '编辑服务连接' : '添加服务连接'} subtitle={catalogConnection ? `先为 ${catalogConnection.name} 保存官方连接，再继续模型配置。` : "连接地址与协议分别配置，Key 在独立的密钥库中保存。"} icon={<Link2 size={22} />} onClose={closeConnection} footer={<><span className="mdl-modal-note"><ShieldCheck size={13} />只保存配置，不联网</span><button className="btn btn-secondary" onClick={closeConnection}>取消</button><button className="btn btn-primary" type="submit" form="mdl-connection-form"><Check size={14} />保存连接</button></>}><form id="mdl-connection-form" onSubmit={saveConnection}><div className="mdl-form-grid"><label className="mdl-field"><span>连接名称 <b>*</b></span><input className="field" aria-label="连接名称" maxLength={60} value={connectionEditor.draft.name} onChange={event => updateConnection({ name: event.target.value })} placeholder="例如：我的百炼账号 · 北京" /></label><label className="mdl-field"><span>服务商预设</span><Select className="field" aria-label="服务商预设" value={connectionEditor.draft.providerId} onValueChange={selectProvider} options={PROVIDER_PRESETS.map(preset => ({ value: preset.id, label: `${preset.name} · ${preset.region}` }))} /></label><label className="mdl-field mdl-full-width"><span>接口协议 <b>*</b></span><Select className="field" aria-label="接口协议" value={connectionEditor.draft.protocol} onValueChange={value => updateConnection({ protocol: value as ApiProtocol })} options={CONFIGURABLE_PROTOCOLS.map(protocol => ({ value: protocol, label: PROTOCOL_LABELS[protocol] }))} /><small>更换协议不会自动保证地址兼容；图像、音频、视频专用接口需要各自适配。</small></label><label className="mdl-field mdl-full-width"><span>Base URL <b>*</b></span><input className="field mdl-code-field" aria-label="Base URL" value={connectionEditor.draft.baseUrl} onChange={event => updateConnection({ baseUrl: event.target.value })} placeholder="从服务商控制台复制，例如 https://api.example.com/v1" autoComplete="off" spellCheck={false} /><small>填写服务基础地址，不填 Key、认证参数或完整请求内容。</small></label></div><div className="mdl-preset-note"><BadgeCheck size={17} /><div><b>{currentPreset?.name} · {currentPreset?.region}</b><p>{currentPreset?.note}</p>{currentPreset?.docsUrl && <button type="button" className="mdl-doc-button" onClick={() => copyDocumentation(currentPreset.docsUrl)}>复制官方文档链接<ArrowRight size={12} /></button>}</div></div><label className="mdl-checkbox-line"><input type="checkbox" checked={connectionEditor.draft.enabled} onChange={event => updateConnection({ enabled: event.target.checked })} />保存后启用此连接</label></form></Modal>}

    {modelEditor && <Modal error={formError} title={modelEditor.id ? '编辑模型配置' : '添加模型配置'} subtitle={modelEditor.catalogEntryId ? '目录参数已带入。确认所属连接与价格方式，再保存到本机。' : '可自定义模型 ID、能力和单价。未知价格留空。'} icon={<Cpu size={23} />} onClose={() => setModelEditor(null)} footer={<>
      <span className="mdl-modal-note"><ShieldCheck size={13} />保存配置不调用模型，不读取完整 Key</span>
      {!modelEditor.id && <button className="btn btn-secondary" onClick={openCatalog}>重新从目录选择</button>}
      <button className="btn btn-secondary" onClick={() => setModelEditor(null)}>取消</button><button className="btn btn-primary" type="submit" form="mdl-model-form"><Check size={14} />保存模型</button>
    </>}><form id="mdl-model-form" onSubmit={saveModel}>
      <div className="mdl-form-grid"><label className="mdl-field"><span>显示名称 <b>*</b></span><input className="field" aria-label="模型显示名称" maxLength={60} value={modelEditor.draft.name} onChange={event => updateModel({ name: event.target.value })} placeholder="例如：常用文案模型" /></label>
        <label className="mdl-field"><span>所属连接 <b>*</b></span><Select className="field" aria-label="模型所属连接" value={modelEditor.draft.connectionId} onValueChange={value => updateModel({ connectionId: value })} options={connections.length ? connections.map(connection => ({ value: connection.id, label: `${connection.name}${connection.enabled ? '' : '（已停用）'}` })) : [{ value: '', label: '先添加连接' }]} /></label>
        <label className="mdl-field mdl-full-width"><span>模型 ID <b>*</b></span><input className="field mdl-code-field" aria-label="模型 ID" value={modelEditor.draft.modelId} onChange={event => updateModel({ modelId: event.target.value })} placeholder="粘贴控制台中的完整模型 ID" autoComplete="off" spellCheck={false} /><small>目录只代表公开型号。账户权限、实际接入点及地域仍以自己控制台为准。</small></label>
      </div>
      <fieldset className="mdl-capability-fieldset"><legend>模型能力 <b>*</b><small>输入理解与输出生成分开声明</small></legend><div className="mdl-capability-checkboxes">{CAPABILITIES.map(capability => <label key={capability} className={modelEditor.draft.capabilities.includes(capability) ? 'checked' : ''}><input type="checkbox" checked={modelEditor.draft.capabilities.includes(capability)} onChange={event => updateModel({ capabilities: event.target.checked ? [...modelEditor.draft.capabilities, capability] : modelEditor.draft.capabilities.filter(item => item !== capability) })} /><span>{CAPABILITY_LABELS[capability]}</span></label>)}</div><p>图片理解不等于图片生成。手动勾选能力不会增加新的接口适配或账户权限。</p></fieldset>
      <section className="mdl-price-section"><header><h3>{automaticBilling ? '自动费用核算' : modelEditor.draft.pricing.referenceOnly ? '参考计价与费用说明' : '调用单价'}</h3><span>{automaticBilling ? '按实际用量自动计算' : modelEditor.draft.pricing.referenceOnly ? '费用待计算' : modelEditor.draft.pricing.verifiedAt ? '已带入目录价目' : '手动核算'}</span></header>
        {(modelEditor.draft.pricing.referenceOnly || modelEditor.draft.pricing.verifiedAt) && <section className="mdl-official-pricing" aria-label="目录价格说明"><header><ShieldCheck size={16} />{modelEditor.draft.pricing.officialUrl && modelEditor.draft.pricing.verifiedAt ? `官方价目核对 ${modelEditor.draft.pricing.verifiedAt}` : '当前费用待核对'}</header>{originEntry ? <CatalogPriceDetails entry={originEntry} onCopySource={copyDocumentation} /> : <>{modelEditor.draft.pricing.referenceNote && <p>{modelEditor.draft.pricing.referenceNote}</p>}{modelEditor.draft.pricing.officialUrl && <button type="button" className="text-button" onClick={() => copyDocumentation(modelEditor.draft.pricing.officialUrl!)}>复制官方价格链接<ArrowRight size={13} /></button>}</>}{modelEditor.draft.pricing.referenceOnly && <><p>{automaticBilling ? '将按返回的实际计费用量与保存的官方规则自动计算。软件会处理文字、图片及缓存等适用细项，美元自动换算参考人民币；不需要逐次填写花费。手动核算仅为可选方式。' : '当前参考价格含多种计费条件，不能按一个固定单价计算。缺少适用规则或计费用量时，会保留已知部分并说明原因。'}</p><button type="button" className="btn btn-secondary" onClick={useManualPricing}>改为手动核算</button></>}</section>}
        {!modelEditor.draft.pricing.referenceOnly && <div className="mdl-form-grid"><label className="mdl-field"><span>计价单位</span><Select className="field" aria-label="模型计价单位" value={modelEditor.draft.pricing.unit} onValueChange={value => updatePricing({ unit: value as ModelPricing['unit'] })} options={Object.entries(PRICING_UNITS).map(([unit, label]) => ({ value: unit, label }))} /></label>
          <label className="mdl-field"><span>货币</span><Select className="field" aria-label="模型计价货币" value={modelEditor.draft.pricing.currency} onValueChange={value => updatePricing({ currency: value as ModelPricing['currency'] })} options={[{ value: 'CNY', label: 'CNY · 人民币' }, { value: 'USD', label: 'USD · 美元' }]} /></label>
          {modelEditor.draft.pricing.currency === 'USD' && <label className="mdl-field mdl-full-width"><span>USD 折合人民币汇率</span><input className="field" aria-label="USD 折合人民币汇率" inputMode="decimal" value={modelEditor.draft.pricing.exchangeRate || ''} onChange={event => updatePricing({ exchangeRate: event.target.value })} placeholder="留空自动获取参考汇率；也可手动填写" /><small>留空使用带日期与来源的公共参考汇率；填写后采用你的手动汇率。原币费用始终单独保留。</small></label>}
          <label className="mdl-field"><span>{modelEditor.draft.pricing.unit === 'million-tokens' ? '输入价格' : '基础价格'}</span><input className="field" aria-label="模型输入价格" inputMode="decimal" value={modelEditor.draft.pricing.input} onChange={event => updatePricing({ input: event.target.value })} placeholder="未知时留空" /></label>
          <label className="mdl-field"><span>{modelEditor.draft.pricing.unit === 'million-tokens' ? '输出价格' : '输出价格（可选）'}</span><input className="field" aria-label="模型输出价格" inputMode="decimal" value={modelEditor.draft.pricing.output} onChange={event => updatePricing({ output: event.target.value })} placeholder="未知时留空" /></label>
        </div>}
        {modelNotice && <p className="mdl-pricing-mode-note" role="status">{modelNotice}</p>}<p>每次生成、精修与重试独立记账。已匹配官方规则的型号按返回用量自动计算；未计算部分会说明原因，已知美元不会因缺汇率而消失。最终支付结算可能不同。</p>
      </section><label className="mdl-checkbox-line"><input type="checkbox" checked={modelEditor.draft.enabled} onChange={event => updateModel({ enabled: event.target.checked })} />启用此模型配置</label>
    </form></Modal>}

    {credentialEditor && <Modal error={formError} title={credentialEditor.id ? '替换 API Key' : '添加 API Key'} subtitle="仅通过桌面密钥库保存；原有完整 Key 不会回到界面。" icon={<KeyRound size={23} />} busy={savingCredential} onClose={closeCredential} footer={<><span className="mdl-modal-note"><LockKeyhole size={13} />{vaultStatus.available ? '系统加密 · 不写入网页存储' : '浏览器禁止输入真实 Key'}</span><button className="btn btn-secondary" disabled={savingCredential} onClick={closeCredential}>取消</button><button className="btn btn-primary" type="submit" form="mdl-credential-form" disabled={!vaultStatus.available || savingCredential || availableConnections.length === 0}>{savingCredential ? <LoaderCircle className="spin" size={14} /> : <LockKeyhole size={14} />}{savingCredential ? '正在安全保存…' : '加密保存 Key'}</button></>}><form id="mdl-credential-form" onSubmit={event => { void saveCredential(event); }}><div className="mdl-form-grid"><label className="mdl-field"><span>凭证名称 <b>*</b></span><input className="field" aria-label="凭证名称" maxLength={60} value={credentialEditor.name} onChange={event => { setCredentialEditor(current => current && { ...current, name: event.target.value }); setFormError(''); }} placeholder="例如：个人账号 · 日常制作" disabled={savingCredential} /></label><label className="mdl-field"><span>所属连接 <b>*</b></span><Select className="field" aria-label="凭证所属连接" value={credentialEditor.connectionId} onValueChange={value => { setCredentialEditor(current => current && { ...current, connectionId: value }); setFormError(''); }} disabled={savingCredential} options={availableConnections.length ? availableConnections.map(connection => ({ value: connection.id, label: `${connection.name}${connection.enabled ? '' : '（已停用）'}` })) : [{ value: '', label: '请先添加服务连接' }]} /></label><label className="mdl-field mdl-full-width"><span>{credentialEditor.id ? '新的 API Key' : 'API Key'} <b>*</b></span><input className="field mdl-code-field" aria-label="API Key 密钥" type="password" value={secret} onChange={event => { setSecret(event.target.value); setFormError(''); }} placeholder={vaultStatus.available ? credentialEditor.id ? '输入新 Key 替换，原 Key 不会回显' : '只在此桌面窗口中填写自己的 API Key' : '请在 Windows EXE 中填写，浏览器输入已禁用'} autoComplete="off" spellCheck={false} disabled={!vaultStatus.available || savingCredential} /><small>保存、取消或关闭都会清空本次输入，不提供查看已存完整密钥的功能。</small></label></div><div className={`mdl-credential-notice ${vaultStatus.available ? '' : 'unavailable'}`}><LockKeyhole size={19} /><div><b>{vaultStatus.available ? '由 Windows 系统保护' : '当前环境没有可用的桌面密钥库'}</b><p>{vaultStatus.available ? '密钥只提交给本机桌面主进程加密保存。配置导出、项目和工作流中只保留引用，不包含真实 Key；保存本身不会发送给服务商；只有你确认认证检查或真实任务后，才会通过所选连接使用。' : vaultStatus.reason || '请打开 Windows 桌面应用再保存真实 Key。网页预览不会降级使用 localStorage 保存密钥。'}</p></div></div>{credentialEditor.id && <p className="mdl-replace-note">替换需要重新输入新的 Key，不能从旧凭证读取原值。原凭证名称和引用 ID 会保留。</p>}</form></Modal>}
  </div>;
}
