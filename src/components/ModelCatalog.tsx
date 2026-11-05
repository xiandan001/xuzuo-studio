import { useState } from 'react';
import { ArrowRight, BookOpen, Check, CircleHelp, Copy, Link2, Search, ShieldCheck } from 'lucide-react';
import type { ModelCapability, ModelConnection } from '../configuration-types';
import { MODEL_CATALOG, MODEL_CATALOG_DATE, filterModelCatalog, matchingCatalogConnections } from '../model-catalog';
import type { ModelCatalogEntry } from '../model-catalog';
import { CAPABILITY_LABELS, PROVIDER_PRESETS } from '../model-presets';
import { Select } from './Select';
import { RememberedDetails } from './RememberedDetails';
import './model-catalog.css';

interface ModelCatalogProps {
  connections: ModelConnection[];
  onSelect: (entry: ModelCatalogEntry, connectionId: string) => void;
  onCreateConnection: (entry: ModelCatalogEntry) => void;
  onCopySource: (url: string) => void;
}

export function CatalogPriceDetails({ entry, onCopySource }: { entry: ModelCatalogEntry; onCopySource: (url: string) => void }) {
  return <div className="mc-price-details"><div className="mc-price-lines">{entry.pricing.displayLines.map((line, index) => <p key={index}>{line}</p>)}</div>{entry.pricing.example && <p className="mc-example"><b>参考花费</b>{entry.pricing.example}</p>}{entry.pricing.note && <p className="mc-pricing-note">{entry.pricing.note}</p>}<div className="mc-source-links">{entry.sources.map((source, index) => <button type="button" key={`${source.url}:${source.label}:${index}`} title={source.url} onClick={() => onCopySource(source.url)}><Copy size={13} />复制{source.label}</button>)}</div></div>;
}

export function ModelCatalogCard({ entry, onChoose, onCopySource }: { entry: ModelCatalogEntry; onChoose: (entry: ModelCatalogEntry) => void; onCopySource: (url: string) => void }) {
  const provider = PROVIDER_PRESETS.find(item => item.id === entry.providerId)?.name || entry.providerId;
  return <article className={`mc-card ${entry.support.ready ? '' : 'mc-card-unsupported'}`} aria-label={`目录模型 ${entry.name}`}><header><div><span>{provider}</span><h3>{entry.name}</h3></div><div className="mc-card-heading-actions"><span className={`mc-status mc-status-${entry.status}`}>{entry.status === 'preview' ? '预览版' : entry.status === 'older' ? '仍可用旧款' : '当前型号'}</span><button type="button" className="btn btn-primary" disabled={!entry.support.ready} title={entry.support.note} onClick={() => onChoose(entry)}>{entry.support.ready ? <Check size={15} /> : <CircleHelp size={15} />}{entry.support.ready ? '选择使用' : '暂不能选用'}</button></div></header><code className="mc-model-id">{entry.modelId}</code><div className="mc-capabilities">{entry.capabilities.map(capability => <span key={capability}>{CAPABILITY_LABELS[capability]}</span>)}</div><p className="mc-description">{entry.description}</p><p className="mc-region">{entry.region} · 核对 {entry.checkedAt}</p><div className="mc-price-summary">{entry.pricing.displayLines.slice(0, 3).map((line, index) => <p key={index}>{line}</p>)}{entry.pricing.example && <p className="mc-example"><b>参考花费</b>{entry.pricing.example}</p>}</div><RememberedDetails className="mc-price-disclosure" rememberKey={`catalog:${entry.id}:pricing`}><summary>完整计费细则与官方来源</summary><CatalogPriceDetails entry={entry} onCopySource={onCopySource} /></RememberedDetails><footer><div><strong>{entry.support.ready ? '可填入配置' : '接口需适配'}</strong><p>{entry.support.ready ? '按实际计费用量自动计算；美元费用同时提供参考人民币换算。仍需自己的 Key 与账户权限。' : entry.support.note}</p></div></footer></article>;
}

export function ModelCatalog({ connections, onSelect, onCreateConnection, onCopySource }: ModelCatalogProps) {
  const [providerId, setProviderId] = useState('all');
  const [capability, setCapability] = useState<ModelCapability | 'all'>('all');
  const [query, setQuery] = useState('');
  const [readyOnly, setReadyOnly] = useState(false);
  const [selection, setSelection] = useState<ModelCatalogEntry>();
  const [connectionId, setConnectionId] = useState('');
  const [visibleCount, setVisibleCount] = useState(12);
  const entries = filterModelCatalog({ providerId, capability, query, readyOnly });
  const providerIds = new Set(MODEL_CATALOG.map(entry => entry.providerId));
  const providers = PROVIDER_PRESETS.filter(item => providerIds.has(item.id));
  const matches = selection ? matchingCatalogConnections(selection, connections) : [];
  const clearSelection = () => { setSelection(undefined); setConnectionId(''); setVisibleCount(12); };
  function choose(entry: ModelCatalogEntry) {
    if (!entry.support.ready) return;
    const compatible = matchingCatalogConnections(entry, connections);
    if (compatible.length === 1) { onSelect(entry, compatible[0].id); return; }
    if (!compatible.length) { onCreateConnection(entry); return; }
    setSelection(entry); setConnectionId('');
  }
  return <section className="mc-catalog" aria-label="官方模型目录"><div className="mc-intro"><BookOpen size={21} /><div><strong>按供应商和用途选择，不必记模型 ID</strong><p>资料核对至 {MODEL_CATALOG_DATE}。这里是官方价目快照，不是实时余额或已领取免费额度。</p></div></div><div className="mc-filters"><label><span>供应商</span><Select className="field" aria-label="目录供应商" value={providerId} onValueChange={value => { setProviderId(value); clearSelection(); }} options={[{ value: 'all', label: '全部供应商' }, ...providers.map(item => ({ value: item.id, label: item.name }))]} /></label><label><span>用途</span><Select className="field" aria-label="目录用途" value={capability} onValueChange={value => { setCapability(value as ModelCapability | 'all'); clearSelection(); }} options={[{ value: 'all', label: '全部用途' }, ...(['text', 'vision', 'image-generation', 'image-editing'] as const).map(value => ({ value, label: CAPABILITY_LABELS[value] }))]} /></label><label className="mc-search"><Search size={17} /><input aria-label="搜索模型目录" value={query} onChange={event => { setQuery(event.target.value); clearSelection(); }} placeholder="搜索模型名称或完整 ID" /></label></div><div className="mc-result-heading"><span>{entries.length} 个模型</span><label><input type="checkbox" checked={readyOnly} onChange={event => { setReadyOnly(event.target.checked); clearSelection(); }} />只看当前可配置</label></div>{selection && <div className="mc-connection-choice" role="region" aria-label="目录连接选择"><div><Link2 size={19} /><strong>为 {selection.name} 选择已有连接</strong></div><p>仅显示供应商、接口协议与计价地域匹配的连接。</p><div><Select className="field" aria-label="目录模型所属连接" value={connectionId} onValueChange={setConnectionId} options={[{ value: '', label: '请选择本次使用的连接' }, ...matches.map(item => ({ value: item.id, label: item.name, description: item.baseUrl }))]} /><button className="btn btn-primary" disabled={!matches.some(item => item.id === connectionId)} onClick={() => onSelect(selection, connectionId)}>继续配置<ArrowRight size={15} /></button></div></div>}<div className="mc-grid">{entries.slice(0, visibleCount).map(entry => <ModelCatalogCard key={entry.id} entry={entry} onChoose={choose} onCopySource={onCopySource} />)}</div>{entries.length > visibleCount && <button type="button" className="btn btn-secondary mc-show-more" onClick={() => setVisibleCount(value => value + 12)}>显示更多模型 · 还有 {entries.length - visibleCount} 个</button>}{!entries.length && <div className="mc-empty"><Search size={30} /><h3>没有匹配的模型</h3><p>试试其它供应商、用途或关键词，也可以返回手动填写。</p></div>}<p className="mc-footnote"><ShieldCheck size={15} />选择只填写配置，不调用模型、不读取完整 Key。当前已适配条目可按官方规则自动计算费用；缺少具体计费用量时会说明未计算部分。</p></section>;
}
