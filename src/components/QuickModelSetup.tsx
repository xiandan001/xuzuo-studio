import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Cpu, Image, KeyRound, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import type { StudioConfiguration } from '../configuration-types';
import { MODEL_CATALOG, catalogConnectionMatches, catalogModelDraft } from '../model-catalog';
import { PROVIDER_PRESETS } from '../model-presets';
import { quickSetupConnections, quickSetupEntries, quickSetupSites } from '../lib/quick-model-setup';
import { ModalPortal } from './ModalPortal';
import { Select } from './Select';
import './quick-model-setup.css';

export function QuickModelSetup({ configuration, onClose, onComplete }: { configuration: StudioConfiguration; onClose: () => void; onComplete: () => void }) {
  const providers = PROVIDER_PRESETS.filter(provider => quickSetupEntries(provider.id).length > 0);
  const [step, setStep] = useState(0), [providerId, setProviderId] = useState(providers[0]?.id || '');
  const [site, setSite] = useState(() => quickSetupSites(providers[0]?.id || '')[0]?.value || '');
  const [secret, setSecret] = useState(''), [useExisting, setUseExisting] = useState(true), [keyName, setKeyName] = useState('');
  const [textId, setTextId] = useState(''), [imageId, setImageId] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState<string[]>([]);
  const [pendingEntries, setPendingEntries] = useState<string[]>();
  const current = useRef(configuration); current.current = configuration;
  const saving = useRef(false), admitting = useRef(false), mounted = useRef(true), completedKeys = useRef(new Set<string>());
  const entries = useMemo(() => quickSetupEntries(providerId, site), [providerId, site]);
  const textEntries = entries.filter(entry => entry.capabilities.includes('text')), imageEntries = entries.filter(entry => entry.capabilities.includes('image-generation'));
  const selectedText = textEntries.find(entry => entry.id === textId), selectedImage = imageEntries.find(entry => entry.id === imageId);
  const existingKeys = configuration.credentials.filter(key => key.enabled && configuration.connections.some(connection => connection.id === key.connectionId && entries.some(entry => catalogConnectionMatches(entry, connection))));
  const providerName = PROVIDER_PRESETS.find(provider => provider.id === providerId)?.name || providerId;
  const selected = [selectedText, selectedImage].filter(entry => !!entry);
  const canReuse = useExisting && existingKeys.length > 0;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setTextId(textEntries[0]?.id || ''); setImageId(''); setError(''); }, [providerId, site]);
  useEffect(() => {
    if (!pendingEntries || saving.current) return;
    const chosen = pendingEntries.map(id => MODEL_CATALOG.find(entry => entry.id === id)!);
    const groups = quickSetupConnections(chosen, configuration.connections);
    if (groups.some(group => group.create)) return;
    saving.current = true;
    void (async () => {
      try {
        for (const group of groups) {
          const config = current.current;
          const hasKey = config.credentials.some(key => key.connectionId === group.connection.id && key.enabled);
          if ((!canReuse || !hasKey) && !completedKeys.current.has(group.connection.id)) {
            if (!secret.trim()) throw Error('所选用途还需要这把 API Key，请填入后继续。');
            const okay = await config.saveCredential({ name: keyName.trim() || `${providerName} Key`, connectionId: group.connection.id, secret: secret.trim() });
            if (!okay) throw Error('Key 未能加密保存，已保存的连接保留，可以继续重试。');
            completedKeys.current.add(group.connection.id);
          }
          for (const entry of group.entries) {
            const latest = current.current;
            if (latest.models.some(model => !model.demo && model.enabled && model.connectionId === group.connection.id && model.modelId === entry.modelId)) continue;
            if (!latest.saveModel(catalogModelDraft(entry, group.connection))) throw Error('模型尚未保存，已保存的连接和 Key 保留，可以继续重试。');
          }
        }
        if (mounted.current) { setSecret(''); setSaved(chosen.map(entry => entry.name)); setStep(3); }
      } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '接入未完成，已保存配置保留。'); }
      finally { saving.current = false; admitting.current = false; if (mounted.current) { setBusy(false); setPendingEntries(undefined); } }
    })();
  }, [pendingEntries, configuration.connections]);
  function chooseProvider(value: string) { setProviderId(value); setSite(quickSetupSites(value)[0]?.value || ''); setSecret(''); setKeyName(''); completedKeys.current.clear(); }
  function save() {
    if (busy || admitting.current || !selected.length) return;
    if (!configuration.vaultStatus.available) { setError(configuration.vaultStatus.reason || '请在桌面版接入模型。'); return; }
    admitting.current = true; setError(''); setBusy(true);
    const groups = quickSetupConnections(selected, configuration.connections);
    for (const group of groups.filter(group => group.create)) {
      const { id: _id, status: _status, ...draft } = group.connection;
      if (!configuration.saveConnection(draft)) { admitting.current = false; setBusy(false); setError('连接尚未保存，请检查配置存储后重试。'); return; }
    }
    setPendingEntries(selected.map(entry => entry.id));
  }
  const close = () => { if (!busy) { setSecret(''); onClose(); } };
  return <ModalPortal onClose={close} busy={busy}><div className="quick-model-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section className="quick-model-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-model-title">
    <header><span><Cpu size={23} /></span><div><h2 id="quick-model-title">快速接入模型</h2><p>选服务商，保存 Key，再选你要做的事。</p></div><button type="button" className="btn-icon" aria-label="关闭快速接入" disabled={busy} onClick={close}><X size={19} /></button></header>
    <ol className="quick-model-steps" aria-label="接入进度">{['服务商', 'API Key', '用途', '完成'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={step >= index ? 'reached' : ''}><span>{step > index ? <Check size={13} /> : index + 1}</span>{label}</li>)}</ol>
    <div className="quick-model-body">
      {error && <p className="quick-model-error" role="alert">{error}</p>}
      {step === 0 && <><label>选择服务商<Select aria-label="快速接入服务商" value={providerId} options={providers.map(provider => ({ value: provider.id, label: provider.name }))} onValueChange={chooseProvider} /></label><label>API 站点<Select aria-label="快速接入API站点" value={site} options={quickSetupSites(providerId)} onValueChange={value => { setSite(value); setSecret(''); completedKeys.current.clear(); }} /></label><p className="quick-model-note">使用所选站点的按量 API Key。自定义地址与其他型号可在高级管理中配置。</p></>}
      {step === 1 && <><div className="quick-model-provider"><KeyRound size={19} /><div><strong>{providerName}</strong><small>{site}</small></div></div>{existingKeys.length > 0 && <label className="quick-model-choice"><input type="checkbox" checked={useExisting} onChange={event => setUseExisting(event.target.checked)} />使用该站点已保存的 Key</label>}{!canReuse && <><label>API Key<input aria-label="快速接入API Key" type="password" autoComplete="new-password" spellCheck={false} value={secret} onChange={event => setSecret(event.target.value)} placeholder="粘贴自己的 API Key" /></label><label>账户名称（可选）<input aria-label="快速接入账户名称" maxLength={80} value={keyName} onChange={event => setKeyName(event.target.value)} placeholder={`${providerName} Key`} /></label></>}<p className="quick-model-note"><ShieldCheck size={16} />Key 只在本机加密保存；接入本身不调用模型。</p></>}
      {step === 2 && <><p className="quick-model-note">先选常用用途，之后随时可以增加。单价与计价条件从现有官方目录带入。</p><section className="quick-model-use"><label className="quick-model-choice"><input type="checkbox" disabled={!textEntries.length || busy} checked={!!selectedText} onChange={event => setTextId(event.target.checked ? textEntries[0]?.id || '' : '')} /><Cpu size={19} /><strong>文字对话与文档</strong></label>{selectedText && <><Select aria-label="快速接入文字模型" disabled={busy} value={textId} options={textEntries.map(entry => ({ value: entry.id, label: entry.name, description: entry.modelId }))} onValueChange={setTextId} /><p>{selectedText.pricing.displayLines.slice(0, 2).join(' · ')}</p></>}{!textEntries.length && <p>此站点暂没有可快速接入的文字模型。</p>}</section><section className="quick-model-use"><label className="quick-model-choice"><input type="checkbox" disabled={!imageEntries.length || busy} checked={!!selectedImage} onChange={event => setImageId(event.target.checked ? imageEntries[0]?.id || '' : '')} /><Image size={19} /><strong>图片生成与编辑</strong></label>{selectedImage && <><Select aria-label="快速接入图片模型" disabled={busy} value={imageId} options={imageEntries.map(entry => ({ value: entry.id, label: entry.name, description: entry.modelId }))} onValueChange={setImageId} /><p>{selectedImage.pricing.displayLines.slice(0, 2).join(' · ')}</p></>}{!imageEntries.length && <p>此站点暂没有可快速接入的生图模型。</p>}</section>{canReuse && selected.some(entry => quickSetupConnections([entry], configuration.connections).some(group => group.create || !configuration.credentials.some(key => key.connectionId === group.connection.id && key.enabled))) && <label>此用途还需填入该站点 Key<input aria-label="补全快速接入API Key" type="password" autoComplete="new-password" value={secret} onChange={event => setSecret(event.target.value)} placeholder="将为缺少 Key 的连接加密保存" disabled={busy} /></label>}</>}
      {step === 3 && <div className="quick-model-success"><span><Check size={30} /></span><h3>已接入，可以开始使用</h3>{saved.map(name => <p key={name}>{name}</p>)}<small>执行前会自动预检；配置完成不代表账户已开通全部模型权限。</small></div>}
    </div><footer>{step > 0 && step < 3 && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setError(''); setStep(step - 1); }}><ArrowLeft size={15} />上一步</button>}<span />{step < 2 ? <button type="button" className="btn btn-primary" disabled={!providerId || !site || step === 1 && !canReuse && !secret.trim()} onClick={() => { setError(''); setStep(step + 1); }}>下一步<ArrowRight size={15} /></button> : step === 2 ? <button type="button" className="btn btn-primary" disabled={busy || !selected.length} onClick={save}>{busy ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}{busy ? '正在保存配置…' : '保存并完成接入'}</button> : <button type="button" className="btn btn-primary" onClick={onComplete}>开始使用<ArrowRight size={15} /></button>}</footer>
  </section></div></ModalPortal>;
}
