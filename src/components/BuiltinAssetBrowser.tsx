import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Image, Search, Shapes, ShieldCheck, X } from 'lucide-react';
import { BUILTIN_ASSETS, BUILTIN_COLLECTIONS, builtinAssetImage, builtinAssetLicense, filterBuiltinAssets } from '../lib/builtin-assets';
import type { BuiltinAsset, BuiltinAssetOrigin } from '../lib/builtin-assets';
import { Select } from './Select';

export function BuiltinAssetBrowser({ onPick, busy, assets = BUILTIN_ASSETS, collection, onCollection, onShowAll }: { onPick: (asset: BuiltinAsset) => void; busy: boolean; assets?: BuiltinAsset[]; collection: string; onCollection: (value: string) => void; onShowAll: () => void }) {
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState<BuiltinAssetOrigin>('all'), [transparent, setTransparent] = useState(false), [limit, setLimit] = useState(12);
  const filtered = useMemo(() => filterBuiltinAssets(assets, { query, collection, origin, transparent }), [assets, query, collection, origin, transparent]);
  useEffect(() => { setLimit(12); }, [query, collection, origin, transparent]);
  function clear() { setQuery(''); onCollection('all'); setOrigin('all'); setTransparent(false); }
  return <section className="builtin-asset-browser" aria-label="内置素材">
    <div className="builtin-library-intro"><span><Shapes size={23} /></span><div><h2>给下一份作品，一个好起点</h2><p>{BUILTIN_ASSETS.length} 件背景、业务图解、透明装饰和开源图标。无需生成，预览与使用不产生 API 费用。</p></div><small><ShieldCheck size={14} />每件素材附来源与使用许可</small></div>
    <div className="builtin-asset-toolbar"><label className="asset-library-search"><Search size={17} /><input aria-label="搜索内置素材" placeholder="搜索流程、时间线、封面、图标…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label="清除内置素材搜索" onClick={() => setQuery('')}><X size={15} /></button>}</label><Select aria-label="筛选素材集合" value={collection} onValueChange={onCollection} options={[{ value: 'all', label: '全部集合' }, ...BUILTIN_COLLECTIONS.map(value => ({ value, label: value }))]} /><Select aria-label="筛选素材来源" value={origin} onValueChange={value => setOrigin(value as BuiltinAssetOrigin)} options={[{ value: 'all', label: '全部来源' }, { value: 'original', label: '序作原创' }, { value: 'open-source', label: '开源素材' }]} /><button className={`builtin-transparent-toggle ${transparent ? 'active' : ''}`} aria-pressed={transparent} onClick={() => setTransparent(value => !value)}>透明背景</button></div>
    <div className="asset-library-result-count"><span>{filtered.length} 件素材</span>{(query || collection !== 'all' || origin !== 'all' || transparent) && <button onClick={clear}>清除筛选</button>}</div>
    <div className="asset-library-grid builtin-asset-grid">{filtered.slice(0, limit).map(asset => <article className="panel builtin-asset-card" key={asset.id}><button type="button" className="builtin-asset-open" disabled={busy} aria-label={`查看素材 ${asset.name}`} onClick={() => onPick(asset)}><div className={`builtin-asset-thumb ${asset.transparent ? 'is-transparent' : ''}`}>{builtinAssetImage(asset) ? <img src={builtinAssetImage(asset)} alt={asset.name} width="320" height="180" loading="lazy" decoding="async" /> : <Image size={28} />}<span>{asset.transparent ? '透明 PNG' : `${asset.width} × ${asset.height}`}</span></div><div className="builtin-asset-card-info"><span>{asset.collection}<ArrowUpRight size={15} /></span><h3>{asset.name}</h3><p>{asset.description}</p><footer><span>{asset.origin === 'original' ? '序作原创' : '开源素材'}</span><b>{builtinAssetLicense(asset)?.name || asset.licenseId}</b></footer></div></button></article>)}</div>
    {!filtered.length && <div className="panel empty-state"><Search size={30} /><h3>没有找到匹配的素材</h3><p>换个关键词，或清除集合与来源筛选。</p><button className="btn btn-secondary" onClick={() => { clear(); onShowAll(); }}>查看全部内置素材</button></div>}
    {filtered.length > limit && <div className="asset-library-load-more"><button className="btn btn-secondary" onClick={() => setLimit(value => value + 12)}>再显示 {Math.min(12, filtered.length - limit)} 件 · 已显示 {limit} / {filtered.length}</button></div>}
  </section>;
}
