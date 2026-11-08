// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BeadMarketImportPreview, BeadMarketOffer } from '../../bead-market-types';
import { BeadMarketPanel } from './BeadMarketPanel';
import { BeadMarketImportDialog } from './BeadMarketImportDialog';
import { BeadMarketOfferEditor } from './BeadMarketOfferEditor';
import { cleanupMarket, marketBackend, marketButton, marketClick, marketDomSetup, marketFill, marketOffer, marketSelect, marketStamp, mountMarket } from './market-test-fixtures';

beforeEach(() => { marketDomSetup(); vi.useFakeTimers(); vi.setSystemTime(marketStamp); });
afterEach(async () => { await cleanupMarket(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const connect = (b: ReturnType<typeof marketBackend>) => Object.defineProperty(window, 'desktop', { configurable: true, value: { beadMarket: b.bridge } });
describe('材料比价真实React交互（Native接口模拟，无实际查询或账单）', () => {
  it('StrictMode effect重放后查询会结束busy，导入预览可正常打开与关闭', async () => {
    const b = marketBackend(); b.state.spec.diameterMm = '2.6'; b.bridge.importFile = vi.fn(async () => ({ token: 'strict-preview', source: 'table' as const, offers: [marketOffer()], issues: [], warnings: [] })); connect(b);
    await mountMarket(<StrictMode><BeadMarketPanel props={b.props} projectId={b.document.projectId} document={b.document} /></StrictMode>);
    await marketClick(marketButton('开始比价')); expect(b.bridge.query).toHaveBeenCalledTimes(1); expect(marketButton('开始比价').disabled).toBe(false); expect(document.querySelector('[aria-label="拼豆材料三平台比价"]')?.textContent).not.toContain('正在查询…');
    await marketClick(marketButton('补充报价')); await marketClick(marketButton('导入报价表')); expect(document.querySelector('[aria-label="检查导入的材料报价"]')).not.toBeNull();
    await marketClick(document.querySelector<HTMLButtonElement>('[aria-label="关闭报价导入"]')!); expect(document.querySelector('[aria-label="检查导入的材料报价"]')).toBeNull(); expect(marketButton('补充报价').disabled).toBe(false);
  });
  it('首次只确认珠径，不会在渲染时联网，之后一键查询并先保存真实图纸', async () => {
    const b = marketBackend(), before = vi.fn(async () => true); connect(b); const { host } = await mountMarket(<BeadMarketPanel props={b.props} projectId={b.document.projectId} document={b.document} beforeQuery={before} />);
    expect(marketButton('开始比价').disabled).toBe(true); expect(b.bridge.query).not.toHaveBeenCalled(); expect(host.querySelector('select,input[type=color]')).toBeNull();
    await marketSelect('拼豆采购珠径', '2.6mm'); await act(async () => vi.advanceTimersByTime(700)); expect(b.state.spec.diameterMm).toBe('2.6'); expect(b.bridge.query).not.toHaveBeenCalled();
    await marketClick(marketButton('开始比价')); expect(before).toHaveBeenCalled(); expect(b.bridge.query).toHaveBeenCalledWith({ projectId: b.document.projectId, force: false });
  });
  it('尚未保存图纸时不发送查询，保留清楚的处理入口', async () => {
    const b = marketBackend(); b.state.spec.diameterMm = '2.6'; connect(b); await mountMarket(<BeadMarketPanel props={b.props} projectId={b.document.projectId} document={b.document} beforeQuery={async () => false} />);
    await marketClick(marketButton('开始比价')); expect(b.bridge.query).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('请先保存当前图纸与库存');
  });
  it('运费未知时显示待补齐，不把候选、失配或空价计作零元总价', async () => {
    const b = marketBackend('bead-project', [marketOffer('offer-a', { shippingCents: undefined }), marketOffer('offer-b', { diameterMm: '5', priceCents: 30, verification: 'candidate' })]); b.state.spec.diameterMm = '2.6'; connect(b); const { host } = await mountMarket(<BeadMarketPanel props={b.props} projectId={b.document.projectId} document={b.document} />);
    expect(host.querySelector('.bm-total')?.textContent).toContain('待补齐'); expect(host.querySelector('.bm-total')?.textContent).not.toContain('¥0.00'); expect(host.textContent).toContain('珠径不一致');
    const offered = [...host.querySelectorAll<HTMLButtonElement>('.bm-offer-actions button')].filter(button => button.textContent?.includes('补齐后采用')); expect(offered).toHaveLength(1); expect(offered[0].disabled).toBe(true);
  });
  it('平台需要登录时明确展示状态，可打开对应平台，不编商品价格', async () => {
    const b = marketBackend(); b.state.spec.diameterMm = '2.6'; const fingerprint = b.snapshot().demand!.fingerprint;
    b.state.lastQuery = { id: 'query-one', fingerprint, status: 'complete', startedAt: marketStamp, finishedAt: marketStamp, platforms: ['1688', 'taobao', 'pdd'], codes: ['W1'], sources: { taobao: { status: 'needs-login', message: '请在平台窗口中登录后采集所选规格。', updatedAt: marketStamp, count: 0 } } }; connect(b);
    await mountMarket(<BeadMarketPanel props={b.props} projectId={b.document.projectId} document={b.document} />); expect(document.body.textContent).toContain('需要登录'); await marketClick(marketButton('去登录／验证')); expect(b.bridge.openSource).toHaveBeenCalledWith({ projectId: b.document.projectId, platform: 'taobao', offerId: undefined });
  });
  it('新项目不会出现旧项目迟到返回的导入预览', async () => {
    const a = marketBackend('a'), b = marketBackend('b'); let resolve!: (preview: BeadMarketImportPreview) => void; a.bridge.importFile = vi.fn(() => new Promise<BeadMarketImportPreview>(done => { resolve = done; })); connect(a);
    const { root } = await mountMarket(<BeadMarketPanel props={a.props} projectId="a" document={a.document} />); await marketClick(marketButton('补充报价')); await marketClick(marketButton('导入报价表'));
    connect(b); await act(async () => root.render(<BeadMarketPanel props={b.props} projectId="b" document={b.document} />)); await act(async () => resolve({ token: 'old-preview', source: 'table', offers: [marketOffer()], issues: [], warnings: [] })); expect(document.querySelector('[aria-label="检查导入的材料报价"]')).toBeNull();
  });
  it('截图识读前可选模型与来源平台，无Key仍可手动填写', async () => {
    const b = marketBackend(); const manual = vi.fn(), extract = vi.fn(async () => {}); const preview: BeadMarketImportPreview = { token: 'screenshot-preview', source: 'image', artifactId: 'screenshot', offers: [], issues: [], warnings: [] };
    await mountMarket(<BeadMarketImportDialog props={b.props} projectId={b.document.projectId} preview={preview} rows={b.snapshot().demand!.rows} onClose={() => {}} onCommit={async () => {}} onExtract={extract} onManual={manual} />);
    expect(marketButton('AI识读截图').disabled).toBe(true); await marketClick(marketButton('手动填写')); expect(manual).toHaveBeenCalledTimes(1); expect(extract).not.toHaveBeenCalled();
  });
  it('报价表先核对后保存，导出通过真实Native方法且不调用识读', async () => {
    const b = marketBackend('bead-project', [marketOffer()]); b.state.spec.diameterMm = '2.6'; connect(b); await mountMarket(<BeadMarketPanel props={b.props} projectId={b.document.projectId} document={b.document} />);
    await marketClick(marketButton('导出采购Excel')); expect(b.bridge.export).toHaveBeenCalledWith({ projectId: b.document.projectId, format: 'xlsx' }); expect(b.props.workflowRunner.saveArtifact).toHaveBeenCalledWith('export-one'); expect(b.bridge.extractImage).not.toHaveBeenCalled();
  });
  it('人工价格以分保存，未填运费保持未知，原有图纸和费用不变', async () => {
    const b = marketBackend(); b.state.spec.diameterMm = '2.6'; connect(b); const original = JSON.stringify(b.document); await mountMarket(<BeadMarketPanel props={b.props} projectId={b.document.projectId} document={b.document} />);
    await marketClick(marketButton('手动录入一条报价')); await marketFill('报价商品名称', '核对过的白色单包'); await marketFill('材料商品链接', 'https://item.taobao.com/item.htm?id=12345'); await marketFill('报价每包粒数', '1000'); await marketFill('报价每包价格', '1.29'); await marketSelect('报价色号', 'W1');
    const confirm = [...document.querySelectorAll('label')].find(label => label.textContent?.includes('我已对照来源核对品牌'))!.querySelector<HTMLInputElement>('input')!; await marketClick(confirm); await marketClick(marketButton('确认报价'));
    expect(b.state.offers).toHaveLength(1); expect(b.state.offers[0]).toMatchObject({ priceCents: 129, packCount: 1000, verification: 'reviewed', code: 'W1' }); expect(b.state.offers[0].shippingCents).toBeUndefined(); expect(JSON.stringify(b.document)).toBe(original); expect(b.props.ledger).toEqual([]);
  });
  it('范围起步价不会自动填入确定价，用户填写与确认后才可采用', async () => {
    const b = marketBackend(), onSave = vi.fn(async (_offer: BeadMarketOffer) => {}); const offer = marketOffer('offer-range', { priceKind: 'range', priceCents: 50, verification: 'candidate' });
    await mountMarket(<BeadMarketOfferEditor offer={offer} rows={b.snapshot().demand!.rows} projectId={b.document.projectId} onClose={() => {}} onSave={onSave} />);
    expect(document.querySelector<HTMLInputElement>('[aria-label="报价每包价格"]')?.value).toBe(''); await marketFill('报价每包价格', '1.29');
    const confirm = [...document.querySelectorAll('label')].find(label => label.textContent?.includes('我已对照来源核对品牌'))!.querySelector<HTMLInputElement>('input')!; await marketClick(confirm); await marketClick(marketButton('确认报价'));
    expect(onSave.mock.calls[0][0]).toMatchObject({ priceCents: 129, priceKind: 'regular', verification: 'reviewed' });
  });
  it('截图识读前模型与账户可见，明确重试才传retry并提醒实费记录', async () => {
    const b = marketBackend(); b.props.configuration.models = [{ id: 'vision', name: '测试视觉模型', connectionId: 'connection', enabled: true, capabilities: ['vision'] }] as typeof b.props.configuration.models; b.props.configuration.connections = [{ id: 'connection', enabled: true }] as typeof b.props.configuration.connections; b.props.configuration.credentials = [{ id: 'saved-key', connectionId: 'connection', enabled: true, name: '测试已存账户' }] as typeof b.props.configuration.credentials;
    const extract = vi.fn().mockRejectedValueOnce(Error('读取暂未完成，未自动重发')).mockResolvedValue(undefined), preview: BeadMarketImportPreview = { token: 'screenshot-preview', source: 'image', artifactId: 'screenshot', offers: [], issues: [], warnings: [] };
    await mountMarket(<BeadMarketImportDialog props={b.props} projectId={b.document.projectId} preview={preview} rows={b.snapshot().demand!.rows} onClose={() => {}} onCommit={async () => {}} onExtract={extract} onManual={() => {}} />);
    await marketSelect('报价截图来源平台', '拼多多'); await marketClick(marketButton('AI识读截图')); expect(extract.mock.calls[0][0]).toEqual({ artifactId: 'screenshot', platform: 'pdd', modelConfigId: 'vision', credentialId: 'saved-key' });
    expect(document.body.textContent).toContain('重新识读会再次调用模型'); await marketClick(marketButton('重新识读截图')); expect(extract.mock.calls[1][0]).toMatchObject({ retry: true, platform: 'pdd' });
  });
  it('多条已有候选可一次核对，不伪造导入token，也不自动核对', async () => {
    const b = marketBackend('bead-project', [marketOffer('offer-a', { verification: 'candidate', reviewedAt: undefined }), marketOffer('offer-b', { code: 'B1', verification: 'candidate', reviewedAt: undefined })]); b.state.spec.diameterMm = '2.6'; connect(b);
    await mountMarket(<BeadMarketPanel props={b.props} projectId={b.document.projectId} document={b.document} />); await marketClick(marketButton('批量核对候选')); expect(b.state.offers.every(offer => offer.verification === 'candidate')).toBe(true);
    const confirmed = [...document.querySelectorAll('label')].find(label => label.textContent?.includes('我已对照来源核对所选报价'))!.querySelector<HTMLInputElement>('input')!; await marketClick(confirmed); await marketClick(marketButton('保存已核对报价'));
    expect(b.state.offers.every(offer => offer.verification === 'reviewed')).toBe(true); expect(b.bridge.commitImport).not.toHaveBeenCalled(); expect(b.bridge.query).not.toHaveBeenCalled();
  });
  it('适用阶梯价以实际每包价显示，与按缺口计算的小计一致', async () => {
    const b = marketBackend('bead-project', [marketOffer('offer-a', { packCount: 10, priceCents: 150, tiers: [{ minPacks: 5, priceCents: 120 }] })]); b.state.spec.diameterMm = '2.6'; connect(b);
    const { host } = await mountMarket(<BeadMarketPanel props={b.props} projectId={b.document.projectId} document={b.document} />); const price = host.querySelector('.bm-offer-price')!;
    expect(price.textContent).toContain('¥1.20／包'); expect(price.textContent).toContain('材料¥8.40'); expect(price.textContent).not.toContain('¥1.50／包');
  });
  it('人工确认同店合单后自动生成店铺标签，不要求寻找数字ID', async () => {
    const b = marketBackend(), onSave = vi.fn(async (_offer: BeadMarketOffer) => {}); await mountMarket(<BeadMarketOfferEditor offer={marketOffer('offer-a', { sellerId: '' })} rows={b.snapshot().demand!.rows} projectId={b.document.projectId} onClose={() => {}} onSave={onSave} />);
    await marketClick(document.querySelector<HTMLElement>('summary')!); const merge = [...document.querySelectorAll('label')].find(label => label.textContent?.includes('已确认同店多色可以合单'))!.querySelector<HTMLInputElement>('input')!; await marketClick(merge); await marketClick(marketButton('确认报价'));
    expect(onSave.mock.calls[0][0].sellerId).toBe('manual-shop-taobao-测试材料店');
  });
  it('缺少某个色号报价时可直接补查该色，不用重查整张图纸', async () => {
    const b = marketBackend(); b.state.spec.diameterMm = '2.6'; connect(b); await mountMarket(<BeadMarketPanel props={b.props} projectId={b.document.projectId} document={b.document} />);
    await marketFill('搜索材料报价', 'W1'); await marketClick(marketButton('去三平台补查 W1')); expect(b.bridge.query).toHaveBeenCalledWith({ projectId: b.document.projectId, force: true, codes: ['W1'] });
  });
});
