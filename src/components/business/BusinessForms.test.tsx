// @vitest-environment jsdom
import { act, useState } from 'react';
import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductPanel } from './ProductPanel';
import { BrandPanel } from './BrandPanel';
import { FinancePanel } from './FinancePanel';
import { newBusinessState } from '../../lib/business-data';
import { guardedEditorSessions } from '../../lib/editor-session-guard';
import type { BusinessState } from '../../business-types';
import type { ArtifactMetadata } from '../../live-types';
import type { PageProps } from '../../types';

vi.mock('../Select', () => ({ Select: ({ value, onValueChange, options, ...rest }: { value: string; onValueChange: (value: string) => void; options: { value: string; label: string; disabled?: boolean }[] }) => <select {...rest} value={value} onChange={event => onValueChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [], stamp = '2026-11-08T00:00:00Z', image = 'data:image/png;base64,iVBORw0KGgo=';
const deferred = () => { let resolve!: (value: boolean) => void; const promise = new Promise<boolean>(done => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  const state: BusinessState = { ...newBusinessState('workspace'), products: ['a', 'b'].map(id => ({ id, sku: id, name: '商品' + id, projectId: 'project', referenceArtifactIds: [id + '-image'], facts: {}, updatedAt: stamp })), orders: [{ id: crypto.randomUUID(), name: '本次制作', recipe: 'merchant', sourceProjectId: 'project', brief: '', productIds: ['a', 'b'], projectIds: ['project'], runIds: [], outputIds: ['formal'], includedRevisions: 1, status: 'complete', factsRevision: 1, facts: {}, outputKinds: ['image'], imageCount: 1, sizes: [], tasks: [], bindings: {}, createdAt: stamp, updatedAt: stamp }], brands: ['first', 'second'].map(id => ({ id, name: id, contact: '', colors: [], font: 'Arial', voice: '', forbiddenClaims: [], approvedSampleIds: [], updatedAt: stamp })) };
  const files = ['a-image', 'b-image', 'formal', 'unselected-raw'].map(id => ({ id, name: id + '.png', projectId: 'project', mimeType: 'image/png', kind: 'image', path: '', bytes: 100, createdAt: stamp })) as ArtifactMetadata[];
  const props = { workspaceId: 'workspace', projects: [{ id: 'project', workspaceId: 'workspace' }], ledger: [], preferences: { hourlyRate: 60 }, notify: vi.fn(), workflowRunner: { importFiles: vi.fn(async () => []), thumbnailArtifact: vi.fn(async () => ({ dataUrl: image })) } } as unknown as PageProps;
  return { state, files, props, latest: state, beforeCommit: vi.fn(async () => true) };
}
async function mount(kind: 'products' | 'brands' | 'finance', f = fixture()) {
  const host = document.createElement('div'), root = createRoot(host); document.body.append(host); roots.push(root);
  function Harness() {
    const [state, setState] = useState(f.state);
    const commit: ComponentProps<typeof ProductPanel>['commit'] = async change => { if (!await f.beforeCommit()) return undefined; const next = change(f.latest); f.latest = next; setState(next); return next; };
    return kind === 'products' ? <ProductPanel props={f.props} state={state} order={state.orders[0]} files={f.files} commit={commit} onImport={() => {}} onRefresh={async () => {}} /> : kind === 'brands' ? <BrandPanel props={f.props} state={state} commit={commit} projectId="project" files={f.files} /> : <FinancePanel props={f.props} state={state} order={state.orders[0]} commit={commit} onImport={() => {}} />;
  }
  await act(async () => root.render(<Harness />)); return { host, f };
}
const field = (host: HTMLElement, label: string) => { const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`); if (!input) throw Error('Missing field ' + label); return input; };
async function fill(host: HTMLElement, label: string, value: string) { await act(async () => { const input = field(host, label), prototype = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }); }
const button = (host: HTMLElement, text: string) => { const result = [...host.querySelectorAll('button')].find(item => item.textContent?.includes(text)); if (!result) throw Error('Missing button ' + text); return result; };
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });

describe('business product and brand form interactions', () => {
  it('shows the selected true source thumbnail and preserves an unsaved product when switching fails', async () => {
    const { host, f } = await mount('products'); expect(host.querySelector('img')?.getAttribute('alt')).toBe('a-image.png');
    f.beforeCommit.mockResolvedValue(false); await fill(host, '商品名称', '输入尚未保存');
    await act(async () => button(host, '商品b').click());
    expect(field(host, '商品名称').value).toBe('输入尚未保存'); expect(host.textContent).toContain('当前商品尚未保存');
    f.beforeCommit.mockResolvedValue(true); await act(async () => button(host, '商品b').click());
    expect(f.latest.products[0].name).toBe('输入尚未保存'); expect(field(host, '商品名称').value).toBe('商品b');
  });
  it('waits for an unfinished product save and saves further typing before switching', async () => {
    const f = fixture(), first = deferred(); f.beforeCommit.mockImplementationOnce(() => first.promise); const { host } = await mount('products', f);
    await fill(host, '商品名称', '第一版'); await act(async () => button(host, '商品b').click());
    await fill(host, '商品名称', '等待期间补充'); expect(field(host, '商品名称').value).toBe('等待期间补充');
    await act(async () => first.resolve(true)); expect(f.latest.products[0].name).toBe('等待期间补充'); expect(field(host, '商品名称').value).toBe('商品b');
  });
  it('does not switch the active product merely because search results change', async () => {
    const { host } = await mount('products'); await fill(host, '商品名称', '正在编辑'); await fill(host, '搜索商品', '商品b');
    expect(field(host, '商品名称').value).toBe('正在编辑');
  });
  it('offers only real formal brand samples and refuses to leave failed brand inputs', async () => {
    const { host, f } = await mount('brands'); expect(host.querySelector('[aria-label="认可样张 formal.png"]')).not.toBeNull(); expect(host.querySelector('[aria-label="认可样张 unselected-raw.png"]')).toBeNull();
    await act(async () => host.querySelector<HTMLInputElement>('[aria-label="认可样张 formal.png"]')!.click());
    f.beforeCommit.mockResolvedValue(false); await fill(host, '品牌名称', '客户未保存名称'); await fill(host, '选择客户品牌', 'second');
    expect(field(host, '品牌名称').value).toBe('客户未保存名称'); expect(field(host, '选择客户品牌').value).toBe('first');
    f.beforeCommit.mockResolvedValue(true); await fill(host, '选择客户品牌', 'second');
    expect(f.latest.brands.find(item => item.id === 'first')?.approvedSampleIds).toEqual(['formal']); expect(field(host, '品牌名称').value).toBe('second');
  });
  it('finishes an outstanding logo import and saves it to the original customer before switching', async () => {
    const f = fixture(); let resolve!: (files: ArtifactMetadata[]) => void;
    vi.mocked(f.props.workflowRunner.importFiles).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { host } = await mount('brands', f); await act(async () => button(host, '添加Logo').click());
    expect(guardedEditorSessions().some(session => session.id === 'business-form:brand-logo:first')).toBe(true);
    await fill(host, '选择客户品牌', 'second'); expect(field(host, '品牌名称').value).toBe('first');
    await act(async () => resolve([{ ...f.files[0], id: 'new-logo' }]));
    expect(f.latest.brands.find(item => item.id === 'first')?.logoArtifactId).toBe('new-logo'); expect(field(host, '品牌名称').value).toBe('second');
  });
  it('keeps typed color separators and claim newlines while editing, then normalizes only on save', async () => {
    const { host, f } = await mount('brands'); await fill(host, '品牌标准色', '#123456,'); expect(field(host, '品牌标准色').value).toBe('#123456,');
    await fill(host, '品牌标准色', '#123456, #abcdef'); await fill(host, '品牌禁用表达', '不改商品外观\n'); expect(field(host, '品牌禁用表达').value).toBe('不改商品外观\n');
    await fill(host, '品牌禁用表达', '不改商品外观\n不编造认证'); await act(async () => button(host, '立即保存').click());
    expect(f.latest.brands.find(item => item.id === 'first')).toMatchObject({ colors: ['#123456', '#abcdef'], forbiddenClaims: ['不改商品外观', '不编造认证'] });
  });
});
describe('actual transaction quantities', () => {
  it('defaults a receipt to one unit and leaves refund quantity unknown unless explicitly entered', async () => {
    const { host, f } = await mount('finance'); expect(field(host, '实际售出件数').value).toBe('1');
    await fill(host, '实际交易金额', '30'); await fill(host, '实际售出件数', '3'); await act(async () => button(host, '记录收款').click());
    expect(f.latest.transactions[0]).toMatchObject({ kind: 'receipt', quantity: 3 }); expect(host.textContent).toContain('已记录售出件数：3');
    await fill(host, '交易类型', 'refund'); expect(field(host, '实际退款件数').value).toBe(''); await fill(host, '实际交易金额', '5'); await act(async () => button(host, '记录退款').click());
    expect(f.latest.transactions[1]).not.toHaveProperty('quantity'); expect(host.textContent).toContain('已记录退货件数：未记录');
  });
  it('does not write malformed quantities or clear the failed transaction draft', async () => {
    const { host, f } = await mount('finance'); await fill(host, '实际交易金额', '10'); await fill(host, '实际售出件数', '0.5'); await act(async () => button(host, '记录收款').click());
    expect(f.latest.transactions).toHaveLength(0); expect(host.textContent).toContain('件数请填写正整数');
    await fill(host, '实际售出件数', '2'); f.beforeCommit.mockResolvedValue(false); await act(async () => button(host, '记录收款').click());
    expect(field(host, '实际交易金额').value).toBe('10'); expect(field(host, '实际售出件数').value).toBe('2');
  });
});
