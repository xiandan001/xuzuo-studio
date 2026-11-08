import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import BusinessStudio from '../../src/pages/BusinessStudio';
import { artifact, order, seeded, time } from '../../src/pages/business-studio-demo-data';
import type { BusinessBridge, BusinessOrder, BusinessState } from '../../src/business-types';
import type { PageProps, Project } from '../../src/types';
import type { ArtifactMetadata } from '../../src/live-types';
import { checkedBusinessState } from '../../src/lib/business-data';
import { writeDisclosure } from '../../src/lib/disclosure-state';
import '../../src/styles.css';
import '../../src/theme.css';
import '../../src/appearance-palettes.css';
import '../../src/surface-depth.css';
import '../../src/next-interface.css';

// This page exercises the actual BusinessStudio. All Native functions below are in-memory examples.
// There is no Key, fetch, HTTP API, file access, or production main-process import.
const workspaceId = 'browser-business-example', imageUrls = new Map<string, string>(), files: ArtifactMetadata[] = [];
document.documentElement.dataset.appTheme = 'light'; document.documentElement.dataset.appPalette = 'violet';
writeDisclosure(`workspace:${workspaceId}:business-selected`, '');
const merchant = order('merchant', 'merchant', { name: '青禾茶饮 · 上新商品套餐', productIds: ['tea-product'], factsConfirmedAt: time, brief: '制作夏季上新主图，保留真实瓶身和已确认文案。', bindings: { text: { modelConfigId: 'example-text', credentialId: 'example-key' }, vision: { modelConfigId: 'example-text', credentialId: 'example-key' }, 'image-generation': { modelConfigId: 'example-image', credentialId: 'example-key' }, 'image-editing': { modelConfigId: 'example-image', credentialId: 'example-key' } } });
const digital = order('digital', 'digital', { name: '原创壁纸 · 数字上架包', factsConfirmedAt: time });
const documents = order('documents', 'documents', { name: '山野合作 · 客户资料套件', factsConfirmedAt: time, facts: { 目标与受众: '咖啡品牌合作伙伴', 交付范围: '提案、执行方案、预算表', 时间与预算: '由客户核定，不虚构数字' } });
let state: BusinessState = { ...seeded(workspaceId, [merchant, digital, documents]), products: [{ id: 'tea-product', sku: 'QH-001', name: '青禾高山绿茶', projectId: merchant.sourceProjectId, referenceArtifactIds: ['tea-original'], facts: { material: 'PET瓶装', dimensions: '500mL', price: '12元', features: '清新自然，夏季限定' }, factsConfirmedAt: time, updatedAt: time }] };
const listeners = new Set<(event: { workspaceId: string; revision: number }) => void>();
const calls: { start: unknown[]; control: unknown[]; deliver: unknown[]; listing: number; assist: number } = { start: [], control: [], deliver: [], listing: 0, assist: 0 };
Object.defineProperty(window, 'businessBrowserFixture', { value: Object.freeze({ kind: 'isolated-business-example', snapshot: () => structuredClone(state), calls: () => structuredClone(calls) }) });
function notice() { for (const listener of listeners) listener({ workspaceId, revision: state.revision }); }
function update(orderId: string, change: Partial<BusinessOrder>) { state = { ...state, revision: state.revision + 1, orders: state.orders.map(row => row.id === orderId ? { ...row, ...change } : row) }; notice(); return structuredClone(state); }
function sample(id: string, title: string, color = '#dce8db') {
  const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 800; const context = canvas.getContext('2d')!;
  context.fillStyle = color; context.fillRect(0, 0, 800, 800); context.fillStyle = '#2d5947'; context.font = 'bold 48px Microsoft YaHei, sans-serif'; context.fillText(title, 55, 95);
  context.fillStyle = '#a9bf68'; context.beginPath(); context.roundRect(295, 220, 210, 385, 35); context.fill(); context.fillStyle = '#fafbf0'; context.fillRect(310, 355, 180, 180); context.fillStyle = '#2d5947'; context.font = 'bold 32px Microsoft YaHei, sans-serif'; context.fillText('青禾', 360, 415); context.font = '24px Microsoft YaHei, sans-serif'; context.fillText('500mL · ¥12', 325, 480); context.fillStyle = '#ffffff'; context.fillRect(325, 185, 150, 50); context.fillStyle = '#46644a'; context.font = '22px Microsoft YaHei, sans-serif'; context.fillText('交互验收示例 · 非模型生成成品', 55, 735);
  imageUrls.set(id, canvas.toDataURL('image/png'));
}
function addImage(id: string, projectId: string, name: string) { if (!files.some(file => file.id === id)) files.push(artifact(id, projectId, { name, kind: 'image', mimeType: 'image/png', path: `example/${id}.png` })); sample(id, name.replace(/\.png$/, '')); return files.find(file => file.id === id)!; }
addImage('tea-original', merchant.sourceProjectId, 'QH-001-真实原图（示例）.png'); addImage('digital-original', digital.sourceProjectId, '原创壁纸-完成作品（示例）.png');
const projects: Project[] = state.orders.map(row => ({ id: row.sourceProjectId, workspaceId, name: row.name, description: row.brief, kind: row.recipe === 'documents' ? 'word' : 'image', status: 'draft', updatedAt: time, costCents: 0, version: 1, accent: 'green' }));
const bridge: BusinessBridge = {
  snapshot: async id => { if (id !== workspaceId) throw Error('隔离示例工作区'); return structuredClone(state); },
  save: async input => { if (input.workspaceId !== workspaceId || input.expectedRevision !== state.revision) throw Error('BUSINESS_CONFLICT'); state = { ...checkedBusinessState(structuredClone(input.state), workspaceId), revision: state.revision + 1 }; notice(); return structuredClone(state); },
  onChanged: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  start: async input => { calls.start.push(structuredClone(input)); const row = state.orders.find(order => order.id === input.orderId)!; if (!row.factsConfirmedAt || row.recipe === 'merchant' && !row.productIds.length) throw Error('示例资料也必须先确认'); const file = addImage(`sample-${row.id}`, row.sourceProjectId, `${row.name}-本地示例样稿.png`); return { state: update(row.id, { status: 'sample-review', outputIds: [file.id], tasks: [{ id: `compose-${row.id}`, kind: 'image', operation: 'compose', projectId: row.sourceProjectId, label: '首款独立图层样稿（模拟）', status: 'complete', artifactIds: [file.id], factsRevision: row.factsRevision }] }), projects: [] }; },
  control: async input => { calls.control.push(structuredClone(input)); const row = state.orders.find(order => order.id === input.orderId)!; if (input.action === 'continue') { const file = addImage(`finished-${row.id}`, row.sourceProjectId, `${row.name}-本地示例正式版.png`); return { state: update(row.id, { status: 'review', outputIds: [file.id], tasks: [...row.tasks, { id: `remaining-${row.id}`, kind: 'image', operation: 'compose', projectId: row.sourceProjectId, label: '其余商品尺寸适配（模拟）', status: 'complete', artifactIds: [file.id], factsRevision: row.factsRevision }] }), projects: [] }; } return { state: update(row.id, { status: input.action === 'pause' ? 'paused' : 'failed' }), projects: [] }; },
  adopt: async input => ({ state: update(input.orderId, { outputIds: input.artifactIds, status: 'review' }), projects: [] }),
  deliver: async input => { calls.deliver.push(structuredClone(input)); if (!Object.values(input.checks).every(Boolean)) throw Error('需核对实际内容、权限和格式'); return { state: update(input.orderId, { status: 'complete' }), projects: [] }; },
  exportRecovery: async () => ({ saved: false }),
  prepare: async input => ({ state: structuredClone(state), projects: projects.filter(project => state.orders.find(row => row.id === input.orderId)?.projectIds.includes(project.id)) }),
  importPreview: async () => undefined, importCommit: async () => structuredClone(state),
  assist: async () => { calls.assist++; return { text: '这是隔离示例：依据已确认的名称、容量和价格整理文案，不调用模型。', runId: 'example-only' }; },
  listing: async () => { calls.listing++; throw Error('浏览器验收仅验证界面；真实ZIP由Native目标测试覆盖，不创建假ZIP。'); },
};
Object.defineProperty(window, 'desktop', { configurable: true, value: { business: bridge } });
function Fixture() {
  const [intent, setIntent] = useState<PageProps['businessIntent']>(), [message, setMessage] = useState(''), [dark, setDark] = useState(false), [, rerender] = useState(0);
  const model = (id: string, name: string, capabilities: string[]) => ({ id, name, capabilities, enabled: true, connectionId: 'example-connection', modelId: 'example-only', pricing: { unit: 'request', currency: 'CNY', input: '0', output: '0' } });
  const props = { workspaceId, projects, configuration: { models: [model('example-text', '示例已配置文字与识图模型', ['text', 'vision']), model('example-image', '示例已配置图片模型', ['image-generation', 'image-editing'])], credentials: [{ id: 'example-key', name: '示例账户 · 无真实Key', enabled: true, connectionId: 'example-connection', lastFour: 'DEMO', updatedAt: time }], connections: [{ id: 'example-connection', name: '隔离模拟连接', enabled: true, providerId: 'example', protocol: 'openai-responses', status: 'configured', baseUrl: 'https://not-called.invalid' }] }, businessIntent: intent, onBusinessIntentConsumed: () => setIntent(undefined), onOpenBusiness: (recipe: BusinessOrder['recipe'], orderId?: string) => setIntent({ token: crypto.randomUUID(), recipe, orderId }), onCreateProject: (kind: Project['kind'], options?: Parameters<PageProps['onCreateProject']>[1]) => { const project = { ...projects[0], id: crypto.randomUUID(), name: options?.initial?.name || '示例新建项目', kind }; projects.push(project); options?.onCreated?.(project); rerender(value => value + 1); setMessage('示例项目已建；这里不访问真实文件夹。'); }, onBatchProjectsCreated: () => {}, navigate: () => setMessage('仅展示业务工作台；本次不打开其他软件或调用模型。'), notify: (text: string) => setMessage(text), ledger: [], preferences: { hourlyRate: 50 }, workflowRunner: { runs: [], listProjectArtifacts: async (projectId: string) => structuredClone(files.filter(file => file.projectId === projectId)), thumbnailArtifact: async (id: string) => ({ mimeType: 'image/png', dataUrl: imageUrls.get(id) }), previewArtifact: async (id: string) => ({ mimeType: 'image/png', dataUrl: imageUrls.get(id) }), saveArtifact: async () => { setMessage('这是交互示例，不写磁盘；正式导出已有Native测试。'); return { saved: false }; }, importFiles: async (projectId: string) => [addImage(`import-${Date.now()}`, projectId, '手工导入完成作品（示例）.png')], trashArtifact: async () => {}, restoreArtifact: async () => {}, listTrashedArtifacts: async () => [] } } as unknown as PageProps;
  return <><header className="fixture-bar"><div><strong>隔离交互验收</strong><span>真实业务组件 · 示例资料／模拟接口 · 无Key、不调用模型</span></div><button className="btn btn-secondary" onClick={() => { const next = !dark; setDark(next); document.documentElement.dataset.appTheme = next ? 'dark' : 'light'; }}>{dark ? '切到白天' : '切到黑夜'}</button></header>{message && <div className="fixture-message" role="status">{message}<button onClick={() => setMessage('')} aria-label="关闭示例提示">×</button></div>}<BusinessStudio {...props} /></>;
}
const style = document.createElement('style'); style.textContent = 'body{height:auto;min-height:100vh;background:var(--ui-bg)}#root{height:auto}.fixture-bar{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 28px;background:var(--ui-surface);border-bottom:1px solid var(--ui-border);color:var(--ui-fg)}.fixture-bar strong{display:block}.fixture-bar span{font-size:13px;color:var(--ui-fg-secondary)}.fixture-message{margin:12px 32px;padding:12px 16px;border:1px solid var(--ui-border);background:var(--ui-focus-soft);color:var(--ui-fg);border-radius:10px;display:flex;justify-content:space-between;gap:12px}'; document.head.append(style);
createRoot(document.getElementById('root')!).render(<Fixture />);
