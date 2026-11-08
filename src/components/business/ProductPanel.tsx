import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { ImagePlus, Plus, Search, Upload } from 'lucide-react';
import type { PageProps } from '../../types';
import type { BusinessOrder, BusinessProduct, BusinessState } from '../../business-types';
import type { ArtifactMetadata } from '../../live-types';
import type { BusinessCommit } from './BrandPanel';
import { useBusinessDraft } from '../../hooks/useBusinessDraft';
import { Select } from '../Select';
import { BusinessFormStatus } from './BusinessFormStatus';
import { BusinessImagePreview } from './BusinessImagePreview';

type SaveGuard = MutableRefObject<(() => Promise<boolean>) | undefined>;
export function ProductPanel({ props, state, order, commit, files, onImport, onRefresh }: { props: PageProps; state: BusinessState; order: BusinessOrder; commit: BusinessCommit; files: ArtifactMetadata[]; onImport: () => void; onRefresh: () => Promise<void> }) {
  const [selected, setSelected] = useState(''), [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [issue, setIssue] = useState('');
  const guard = useRef<(() => Promise<boolean>) | undefined>(undefined), working = useRef(false);
  const products = useMemo(() => state.products.filter(item => order.productIds.includes(item.id)), [state.products, order.productIds]);
  const visible = products.filter(item => `${item.name} ${item.sku}`.toLowerCase().includes(query.toLowerCase())).slice(0, 50), active = products.find(item => item.id === selected) || products[0];
  async function perform(action: () => void | Promise<void>) {
    if (working.current) return; working.current = true; setBusy(true); setIssue('');
    try { if (guard.current && !await guard.current()) { setIssue('当前商品尚未保存，请在原表单重试；输入仍保留。'); return; } await action(); }
    catch (cause) { setIssue(cause instanceof Error ? cause.message : '操作尚未完成，当前资料保留。'); }
    finally { working.current = false; setBusy(false); }
  }
  async function add() {
    const value: BusinessProduct = { id: crypto.randomUUID(), projectId: order.sourceProjectId, sku: `SKU-${products.length + 1}`, name: `商品${products.length + 1}`, referenceArtifactIds: [], facts: { material: '', dimensions: '', price: '', features: '' }, updatedAt: new Date().toISOString() };
    const saved = await commit(state => ({ ...state, products: [...state.products, value], orders: state.orders.map(item => item.id === order.id ? { ...item, productIds: [...item.productIds, value.id], updatedAt: value.updatedAt } : item) }));
    if (saved) setSelected(value.id); else throw Error('新商品尚未保存，原商品输入已保留。');
  }
  async function importImages() {
    const imported = (await props.workflowRunner.importFiles(order.sourceProjectId)).filter(file => ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType));
    if (imported.length) {
      const saved = await commit(state => ({ ...state, products: state.products.map(product => {
        if (!order.productIds.includes(product.id) || product.referenceArtifactIds.length) return product;
        const exact = imported.filter(file => file.name.replace(/\.[^.]+$/, '').replace(/_\d{4}-\d{2}-\d{2}.*$/, '').toLowerCase() === product.sku.toLowerCase());
        return exact.length === 1 ? { ...product, referenceArtifactIds: [exact[0].id], factsConfirmedAt: undefined, updatedAt: new Date().toISOString() } : product;
      }) }));
      if (saved) props.notify('原图已导入；仅匹配同名商品编号，请核对下面的图片。');
    }
    await onRefresh();
  }
  return <section className="bs-products">
    <header className="bs-panel-heading"><div><h2>商品与真实资料</h2><p>逐款绑定原图，先核对图片和参数，再用于制作。</p></div><div>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { void perform(onImport); }}><Upload size={15} />导入商品表</button>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { void perform(importImages); }}><ImagePlus size={15} />导入原图</button>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { void perform(add); }}><Plus size={15} />添加商品</button>
    </div></header>
    {issue && <p className="bs-error" role="alert">{issue}</p>}
    <div className="bs-product-layout"><aside><label className="bs-search"><Search size={16} /><input aria-label="搜索商品" placeholder="搜索名称／商品编号" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {visible.map(product => <button type="button" key={product.id} disabled={busy} className={active?.id === product.id ? 'is-selected' : ''} onClick={() => { if (product.id !== active?.id) void perform(() => setSelected(product.id)); }}><strong>{product.name}</strong><small>{product.sku} · {product.referenceArtifactIds.length ? `${product.referenceArtifactIds.length}张原图` : '待添加原图'}</small></button>)}
      {!products.length && <p className="bs-note">可导入CSV／Excel，也可先添加一款。</p>}{products.length > 50 && <p className="bs-note">仅显示前50款，可搜索定位。</p>}
    </aside>{active ? <ProductForm key={active.id} product={active} files={files} runner={props.workflowRunner} guard={guard} onSave={async value => Boolean(await commit(state => ({ ...state, products: state.products.map(item => item.id === value.id ? { ...value, updatedAt: new Date().toISOString() } : item) })))} /> : <div className="bs-empty"><h3>先添加一款商品</h3><p>商品表可包含：SKU、名称、材质、尺寸、售价、卖点、原图文件名。</p><button type="button" className="btn btn-primary" disabled={busy} onClick={() => { void perform(add); }}>添加第一款</button></div>}</div>
  </section>;
}
function ProductForm({ product, files, runner, guard, onSave }: { product: BusinessProduct; files: ArtifactMetadata[]; runner: PageProps['workflowRunner']; guard: SaveGuard; onSave: (product: BusinessProduct) => Promise<boolean> }) {
  const draft = useBusinessDraft(`product:${product.id}`, product.projectId, product, onSave), value = draft.value;
  useEffect(() => { guard.current = draft.save; return () => { if (guard.current === draft.save) guard.current = undefined; }; }, [guard, draft.save]);
  const images = files.filter(file => file.projectId === product.projectId && file.kind === 'image' && ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType) && !file.trashedAt && !file.unavailable), image = images.find(file => file.id === value.referenceArtifactIds[0]);
  return <div className="bs-product-form"><div className="bs-form-grid">
    <label>商品编号<input className="field" aria-label="商品编号" value={value.sku} maxLength={100} onChange={event => draft.update(old => ({ ...old, sku: event.target.value, factsConfirmedAt: undefined }))} /></label>
    <label>商品名称<input className="field" aria-label="商品名称" value={value.name} maxLength={200} onChange={event => draft.update(old => ({ ...old, name: event.target.value, factsConfirmedAt: undefined }))} /></label>
    <label className="bs-full">主原图<Select aria-label="商品主原图" value={value.referenceArtifactIds[0] || ''} onValueChange={id => draft.update(old => ({ ...old, referenceArtifactIds: id ? [id] : [], factsConfirmedAt: undefined }))} options={[{ value: '', label: '选择这款商品的真实原图' }, ...images.map(file => ({ value: file.id, label: file.name })), ...(!image && value.referenceArtifactIds[0] ? [{ value: value.referenceArtifactIds[0], label: '原图暂不可用，请重新选择', disabled: true }] : [])]} /></label>
    {value.referenceArtifactIds.length > 0 && <div className="bs-full"><BusinessImagePreview file={image} runner={runner} /><p className="bs-note">{image?.name || '原图不可用，当前关联保留；请检查项目文件或重新选择。'}</p></div>}
    {Object.entries({ material: '材质', dimensions: '尺寸／规格', price: '展示价格', features: '真实卖点' }).map(([key, label]) => <label key={key} className={key === 'features' ? 'bs-full' : ''}>{label}<input className="field" aria-label={`商品${label}`} maxLength={2000} value={value.facts[key] || ''} placeholder="未提供可留空，系统不编造" onChange={event => draft.update(old => ({ ...old, facts: { ...old.facts, [key]: event.target.value }, factsConfirmedAt: undefined }))} /></label>)}
  </div><label className="bs-checkbox"><input type="checkbox" checked={Boolean(value.factsConfirmedAt)} onChange={event => draft.update(old => ({ ...old, factsConfirmedAt: event.target.checked ? new Date().toISOString() : undefined }))} />我已核对这款商品的原图与资料</label><BusinessFormStatus {...draft} onReset={draft.reset} onSave={() => { void draft.save(); }} /></div>;
}
