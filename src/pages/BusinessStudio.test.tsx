// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusinessImportPreview, BusinessProductionResult, BusinessState } from '../business-types';
import type { ArtifactMetadata } from '../live-types';
import { guardedEditorSessions } from '../lib/editor-session-guard';
import { artifact, backend, button, check, cleanupBusiness, click, deferred, field, mountBusiness, multiSkuFixture, order, seeded, select, time } from './business-studio-test-fixtures';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  localStorage.clear(); vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 50, left: 20, top: 50, bottom: 90, right: 420, width: 400, height: 40, toJSON: () => ({}) });
});
afterEach(async () => { await cleanupBusiness(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
async function flushDrafts() { await act(async () => { for (const session of guardedEditorSessions({ includeDirty: true }).filter(row => row.id.startsWith('business'))) expect(await session.save()).toBe(true); }); }
async function selectOrder(ui: Awaited<ReturnType<typeof mountBusiness>>, id: string) { const element = [...ui.host.querySelectorAll<HTMLButtonElement>('.bs-orders button')].find(row => row.textContent?.includes(`制作单${id}`)); if (!element) throw Error('Order not found: ' + id); await act(async () => element.click()); }

describe('业务制作真实React集成（Native bridge模拟，不调用API）', () => {
  it('首页仅有三个套餐入口，先确定项目且模型选择在制作前可见', async () => {
    const b = backend(), ui = await mountBusiness(b), cards = ui.host.querySelector('[aria-label="选择业务制作套餐"]')!;
    expect([...cards.querySelectorAll('button strong')].map(row => row.textContent)).toEqual(['商家商品套餐', '数字商品上架包', '客户资料套件']);
    await click(cards, '客户资料套件'); await select(ui.host, '业务制作保存项目', '现有本地项目'); await click(ui.host, '使用这个项目');
    expect(ui.host.querySelector('[aria-label="文字与资料模型"]')).not.toBeNull(); expect(ui.host.querySelector('[aria-label="图片与截图识读模型"]')).not.toBeNull();
    expect(b.current('workspace-a').orders).toHaveLength(1); expect(b.bridge.start).not.toHaveBeenCalled(); expect(b.bridge.assist).not.toHaveBeenCalled(); expect(b.bridge.listing).not.toHaveBeenCalled();
  });
  it('唯一启用真实模型及已保存账户自动带入并保存，示例和停用模型不抢占', async () => {
    const row = order('automatic'), b = backend([seeded('workspace-a', [row])]), ui = await mountBusiness(b); await selectOrder(ui, row.id); await flushDrafts();
    const model = ui.props.configuration.models[0]; await ui.render({ configuration: { ...ui.props.configuration, models: [model, { ...model, id: 'demo-model', name: '示例模型', demo: true }, { ...model, id: 'disabled-model', name: '停用模型', enabled: false }] } });
    expect(button(ui.host, '文字与资料模型').textContent).toContain('已配置多模态模型'); expect(button(ui.host, '文字与资料账户').textContent).toContain('已保存账户');
    await click(ui.host, '文字与资料模型'); expect(document.querySelector('[role="listbox"]')?.textContent).not.toMatch(/示例模型|停用模型/); await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(b.current('workspace-a').orders[0].bindings).toMatchObject({ text: { modelConfigId: 'configured-model', credentialId: 'saved-key' }, vision: { modelConfigId: 'configured-model', credentialId: 'saved-key' } });
    expect(b.bridge.start).not.toHaveBeenCalled(); expect(ui.props.ledger[0].costCents).toBe(157);
  });
  it('可以在制作前更换已有模型，进入下一阶段前自动保存本次选择和文字', async () => {
    const row = order('choose'), b = backend([seeded('workspace-a', [row])]), ui = await mountBusiness(b); await selectOrder(ui, row.id);
    const model = ui.props.configuration.models[0]; await ui.render({ configuration: { ...ui.props.configuration, models: [model, { ...model, id: 'second-model', name: '第二个已配置模型' }] } });
    await select(ui.host, '文字与资料模型', '第二个已配置模型'); await field(ui.host, '本次业务制作要求', '这是切换阶段前刚刚输入的内容。'); await click(ui.host, '2样稿与制作');
    const saved = b.current('workspace-a').orders[0]; expect(saved.brief).toBe('这是切换阶段前刚刚输入的内容。'); expect(saved.bindings.text).toEqual({ modelConfigId: 'second-model', credentialId: 'saved-key' }); expect(b.bridge.start).not.toHaveBeenCalled();
  });
  it('新建项目使用本地目录入口，回调创建对应制作单且不执行模型', async () => {
    const b = backend(), ui = await mountBusiness(b); await click(ui.host.querySelector('[aria-label="选择业务制作套餐"]')!, '商家商品套餐'); await click(ui.host, '选择文件夹，新建项目');
    expect(ui.props.onCreateProject).toHaveBeenCalledWith('image', expect.objectContaining({ quick: true, onCreated: expect.any(Function) }));
    const options = vi.mocked(ui.props.onCreateProject).mock.calls[0][1]!; const project = { ...ui.props.projects[0], id: 'folder-project', name: '本地目录创建的商品项目' };
    await act(async () => options.onCreated!(project)); expect(b.current('workspace-a').orders[0]).toMatchObject({ recipe: 'merchant', sourceProjectId: project.id, name: project.name }); expect(ui.host.textContent).toContain('商品与真实资料'); expect(b.bridge.start).not.toHaveBeenCalled();
  });
  it('资料中可以先选模型，首样只启动一次，样稿满意后继续而不再创建首样', async () => {
    const row = order('sample'), b = backend([seeded('workspace-a', [row])]), ui = await mountBusiness(b); await selectOrder(ui, row.id);
    await field(ui.host, '本次业务制作要求', '请做给真实合作客户，价格按已确认资料。'); await check(ui.host, '本次商品、资料与用途已核对');
    const pending = deferred<BusinessProductionResult>(), original = b.bridge.start; b.bridge.start = vi.fn(() => pending.promise);
    await click(ui.host, '先制作样稿'); await click(ui.host, '先制作样稿');
    expect(b.bridge.start).toHaveBeenCalledTimes(1); expect(b.bridge.start).toHaveBeenCalledWith({ workspaceId: 'workspace-a', orderId: row.id, sampleOnly: true });
    await act(async () => pending.resolve(await original({ workspaceId: 'workspace-a', orderId: row.id, sampleOnly: true }))); expect(ui.host.textContent).toContain('先检查这一款样稿');
    await click(ui.host, '样稿满意，继续其余'); expect(b.bridge.control).toHaveBeenCalledWith({ workspaceId: 'workspace-a', orderId: row.id, action: 'continue', taskId: undefined }); expect(b.bridge.start).toHaveBeenCalledTimes(1);
    expect(b.current('workspace-a').orders[0].brief).toContain('真实合作客户'); expect(ui.props.ledger[0].costCents).toBe(157);
  });
  it('切换制作单后，迟到的旧文件清单不能混入当前成品', async () => {
    const a = order('a', 'digital', { status: 'review', outputIds: ['file-a'] }), other = order('b', 'digital', { status: 'review', outputIds: ['file-b'] });
    const b = backend([seeded('workspace-a', [a, other])]), ui = await mountBusiness(b), old = deferred<ArtifactMetadata[]>();
    ui.props.workflowRunner.listProjectArtifacts = vi.fn(id => id === a.sourceProjectId ? old.promise : Promise.resolve([artifact('file-b', other.sourceProjectId)]));
    await selectOrder(ui, a.id); await selectOrder(ui, other.id); expect(ui.host.textContent).toContain('file-b.pptx');
    await act(async () => old.resolve([artifact('file-a', a.sourceProjectId)])); expect(ui.host.textContent).not.toContain('file-a.pptx'); expect(ui.host.textContent).toContain('file-b.pptx');
  });
  it('切换工作区后，旧工作区迟到的读取不能显示或成为当前制作单', async () => {
    const a = order('workspace-a-order'), other = order('workspace-b-order'), b = backend([seeded('workspace-a', [a]), seeded('workspace-b', [other])]), old = deferred<BusinessState>();
    b.bridge.snapshot = vi.fn(id => id === 'workspace-a' ? old.promise : Promise.resolve(structuredClone(b.current(id))));
    const ui = await mountBusiness(b); await ui.render({ workspaceId: 'workspace-b' }); expect(ui.host.textContent).toContain(other.name);
    await act(async () => old.resolve(seeded('workspace-a', [a]))); expect(ui.host.textContent).not.toContain(a.name); expect(ui.host.textContent).toContain(other.name); expect(b.bridge.start).not.toHaveBeenCalled();
  });
  it('切换制作单后，迟到的旧商品导入预览不能覆盖新制作单', async () => {
    const a = order('import-old', 'merchant'), other = order('import-current', 'merchant'), b = backend([seeded('workspace-a', [a, other])]), pending = deferred<BusinessImportPreview | undefined>();
    b.bridge.importPreview = vi.fn(() => pending.promise); const ui = await mountBusiness(b); await selectOrder(ui, a.id); await click(ui.host, '导入商品表'); await selectOrder(ui, other.id);
    await act(async () => pending.resolve({ token: 'old-import-token', kind: 'products', columns: ['SKU'], rows: [{ SKU: 'OLD-ONLY' }], issues: [], duplicates: 0, conflicts: [] }));
    expect(document.querySelector('[aria-label="检查表格导入"]')).toBeNull(); expect(ui.host.querySelector('.bs-order-heading h2')?.textContent).toBe(other.name); expect(b.bridge.importCommit).not.toHaveBeenCalled();
  });
  it('交付先采用真实文件，三项核验完整才确认，未采用文件不能直接交付', async () => {
    const row = order('delivery', 'digital'), file = artifact('actual-export', row.sourceProjectId), b = backend([seeded('workspace-a', [row])]), ui = await mountBusiness(b, { files: [file] }); await selectOrder(ui, row.id); await click(ui.host, '3成品与经营');
    await check(ui.host, '内容与商品事实已核对'); await check(ui.host, '图片、字体及素材的使用权已确认'); await check(ui.host, '实际文件可打开'); expect(button(ui.host, '确认当前版本交付').disabled).toBe(true);
    await select(ui.host, '采用最新导出文件', file.name); await click(ui.host, '采用此版本'); expect(b.bridge.adopt).toHaveBeenCalledWith({ workspaceId: 'workspace-a', orderId: row.id, taskId: undefined, artifactIds: [file.id] });
    expect(button(ui.host, '确认当前版本交付').disabled).toBe(true);
    await check(ui.host, '内容与商品事实已核对'); await check(ui.host, '图片、字体及素材的使用权已确认'); await check(ui.host, '实际文件可打开'); expect(button(ui.host, '确认当前版本交付').disabled).toBe(false); await click(ui.host, '确认当前版本交付');
    expect(b.bridge.deliver).toHaveBeenCalledWith({ workspaceId: 'workspace-a', orderId: row.id, checks: { content: true, rights: true, format: true } }); expect(ui.props.ledger[0].costCents).toBe(157);
  });
  it('采用失败保留原成品和错误信息，不能把未采用文件显示成已交付', async () => {
    const row = order('adopt-failure', 'digital'), file = artifact('unconfirmed-export', row.sourceProjectId), b = backend([seeded('workspace-a', [row])]); b.bridge.adopt = vi.fn(async () => { throw Error('该文件尚未通过正式格式检查'); });
    const ui = await mountBusiness(b, { files: [file] }); await selectOrder(ui, row.id); await click(ui.host, '3成品与经营'); await select(ui.host, '采用最新导出文件', file.name); await click(ui.host, '采用此版本');
    expect(ui.host.querySelector('[role="alert"]')?.textContent).toContain('尚未通过正式格式检查'); expect(button(ui.host, '确认当前版本交付').disabled).toBe(true); expect(b.current('workspace-a').orders[0].outputIds).toEqual([]); expect(b.bridge.deliver).not.toHaveBeenCalled();
  });
  it('模型任务未完成时切换制作单，迟到的首样回执不能切走当前页面', async () => {
    const a = order('slow', 'documents', { factsConfirmedAt: time }), other = order('current', 'digital', { status: 'review', outputIds: ['current-file'] }), b = backend([seeded('workspace-a', [a, other])]), pending = deferred<BusinessProductionResult>();
    b.bridge.start = vi.fn(() => pending.promise); const ui = await mountBusiness(b, { files: [artifact('current-file', other.sourceProjectId)] }); await selectOrder(ui, a.id); await click(ui.host, '先制作样稿'); await selectOrder(ui, other.id);
    await act(async () => pending.resolve({ state: b.update('workspace-a', a.id, { status: 'sample-review' }), projects: [] }));
    expect(ui.host.querySelector('.bs-order-heading h2')?.textContent).toBe(other.name); expect(ui.host.querySelector('[aria-label="业务制作阶段"] [aria-current="step"]')?.textContent).toBe('3成品与经营'); expect(ui.host.textContent).toContain('current-file.pptx');
  });
  it('已删除或不可用的采用文件不应让交付按钮可点击', async () => {
    const row = order('missing', 'digital', { status: 'review', outputIds: ['missing-file'] }), file = artifact('missing-file', row.sourceProjectId, { unavailable: true, trashedAt: time }), b = backend([seeded('workspace-a', [row])]), ui = await mountBusiness(b, { files: [file] }); await selectOrder(ui, row.id);
    await check(ui.host, '内容与商品事实已核对'); await check(ui.host, '图片、字体及素材的使用权已确认'); await check(ui.host, '实际文件可打开');
    expect(button(ui.host, '确认当前版本交付').disabled).toBe(true); expect(b.bridge.deliver).not.toHaveBeenCalled();
  });
  it('收款和退款按实际金额与件数录入，不更改已消耗API账本', async () => {
    const row = order('money', 'digital'), b = backend([seeded('workspace-a', [row])]), ui = await mountBusiness(b); await selectOrder(ui, row.id); await click(ui.host, '3成品与经营'); await click(ui.host, '收支与工时');
    await field(ui.host, '实际交易金额', '120.50'); await field(ui.host, '实际售出件数', '3'); await click(ui.host, '记录收款');
    await select(ui.host, '交易类型', '退款'); await field(ui.host, '实际交易金额', '18.50'); await field(ui.host, '实际退款件数', '1'); await click(ui.host, '记录退款');
    expect(b.current('workspace-a').transactions.map(row => ({ kind: row.kind, amountCents: row.amountCents, quantity: row.quantity }))).toEqual([{ kind: 'receipt', amountCents: 12050, quantity: 3 }, { kind: 'refund', amountCents: 1850, quantity: 1 }]); expect(ui.props.ledger[0].costCents).toBe(157); expect(b.bridge.start).not.toHaveBeenCalled();
  });
  it('首次异步恢复已选制作单，应直接打开其成品阶段而不是退回资料准备', async () => {
    const row = order('remembered', 'digital', { status: 'review', outputIds: ['ready-file'] }), b = backend([seeded('workspace-a', [row])]), wait = deferred<BusinessState>();
    localStorage.setItem('xuzuo-disclosure-v1:workspace:workspace-a:business-selected', JSON.stringify({ version: 1, value: row.id })); b.bridge.snapshot = vi.fn(() => wait.promise);
    const ui = await mountBusiness(b, { files: [artifact('ready-file', row.sourceProjectId)] }); await act(async () => wait.resolve(b.current('workspace-a')));
    expect(ui.host.querySelector('[aria-label="业务制作阶段"] [aria-current="step"]')?.textContent).toBe('3成品与经营'); expect(ui.host.textContent).toContain('ready-file.pptx');
  });
  it('同项目两款SKU中替换第二款方图，采用定位到第二任务并保留两款其他尺寸', async () => {
    const f = multiSkuFixture('replace-sku'), b = backend([f.state]);
    // Model Native adoption's task-scoped response; this bridge performs no file or model request.
    b.bridge.adopt = vi.fn(async input => {
      const current = b.current(input.workspaceId).orders.find(row => row.id === input.orderId)!;
      const tasks = current.tasks.map(task => task.id === input.taskId ? { ...task, artifactIds: [...input.artifactIds] } : task);
      return { state: b.update(input.workspaceId, input.orderId, { tasks, outputIds: tasks.flatMap(task => task.artifactIds) }), projects: [] };
    });
    const ui = await mountBusiness(b, { files: f.files }); await selectOrder(ui, f.row.id); await select(ui.host, '采用最新导出文件', 'b-new.png');
    expect(button(ui.host, '采用此版本').disabled).toBe(true); await select(ui.host, '选择要替换的成品', 'b-square.png'); await click(ui.host, '采用此版本');
    expect(b.bridge.adopt).toHaveBeenCalledWith({ workspaceId: 'workspace-a', orderId: f.row.id, taskId: 'task-b', artifactIds: ['b-tall', 'b-new'] });
    const current = b.current('workspace-a'); expect(current.orders[0].outputIds).toEqual(['a-square', 'a-tall', 'b-tall', 'b-new']); expect(current.orders[0].tasks[0].artifactIds).toEqual(['a-square', 'a-tall']); expect(current.orders[0].runIds).toEqual(f.row.runIds); expect(current.transactions).toEqual(f.state.transactions);
    expect([...ui.host.querySelectorAll('.bs-final-grid article strong')].map(item => item.textContent)).toEqual(['a-square.png', 'a-tall.png', 'b-tall.png', 'b-new.png']); expect(ui.props.ledger[0].costCents).toBe(157); expect(b.bridge.start).not.toHaveBeenCalled();
  });
  it('结束已采用新导出的返修轮次只确认反馈，整单成品、API运行和实收记录全部保留', async () => {
    const f = multiSkuFixture('finish-feedback'); f.state.orders[0] = { ...f.row, outputIds: ['a-square', 'a-tall', 'b-new', 'b-tall'] };
    const state: BusinessState = { ...f.state, feedback: [{ id: 'feedback-keep-all', orderId: f.row.id, round: 1, target: { projectId: f.row.sourceProjectId, artifactId: 'b-square' }, text: '只改商品B方图的价格', tasks: ['修改商品B方图价格，其他尺寸保持'], status: 'approved', runIds: ['paid-refine'], createdAt: '2026-11-08T01:00:00Z', updatedAt: '2026-11-08T01:00:00Z' }] }, b = backend([state]);
    const ui = await mountBusiness(b, { files: f.files }); await selectOrder(ui, f.row.id); await click(ui.host, '客户返修'); await click(ui.host, '已核对新导出，完成本轮');
    const current = b.current('workspace-a'); expect(current.feedback[0].status).toBe('confirmed'); expect(current.orders[0].outputIds).toEqual(state.orders[0].outputIds); expect(current.orders[0].runIds).toEqual(state.orders[0].runIds); expect(current.orders[0].tasks).toEqual(state.orders[0].tasks); expect(current.transactions).toEqual(state.transactions);
    expect(b.bridge.adopt).not.toHaveBeenCalled(); expect(b.bridge.start).not.toHaveBeenCalled(); expect(ui.props.ledger[0].costCents).toBe(157); expect(ui.host.textContent).toContain('已核对完成');
  });
  it('仅有返修清单或未采用的新导出时不能结束轮次，原成品与实收账目保留', async () => {
    const f = multiSkuFixture('unfinished-feedback'), state: BusinessState = { ...f.state, feedback: [{ id: 'feedback-not-exported', orderId: f.row.id, round: 1, target: { projectId: f.row.sourceProjectId, artifactId: 'b-square' }, text: '修改B方图价格', tasks: ['修改B方图价格'], status: 'approved', runIds: [], createdAt: '2026-11-08T01:00:00Z', updatedAt: '2026-11-08T01:00:00Z' }] }, b = backend([state]);
    const ui = await mountBusiness(b, { files: f.files }); await selectOrder(ui, f.row.id); await click(ui.host, '客户返修'); await click(ui.host, '已核对新导出，完成本轮');
    expect(ui.host.querySelector('[role="alert"]')?.textContent).toContain('先保存并导出修改后的成品'); const current = b.current('workspace-a'); expect(current.feedback[0].status).toBe('approved'); expect(current.orders[0].outputIds).toEqual(f.row.outputIds); expect(current.orders[0].runIds).toEqual(f.row.runIds); expect(current.transactions).toEqual(f.state.transactions); expect(b.bridge.adopt).not.toHaveBeenCalled(); expect(b.bridge.deliver).not.toHaveBeenCalled(); expect(ui.props.ledger[0].costCents).toBe(157);
  });
});
