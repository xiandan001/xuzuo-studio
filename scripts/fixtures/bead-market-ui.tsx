import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PageProps } from '../../src/types';
import type { BeadDocument } from '../../src/bead-types';
import { BeadMarketPanel } from '../../src/components/bead-market/BeadMarketPanel';
import { BrandColorPicker } from '../../src/components/business/BrandColorPicker';
import { BeadMarketSessions } from '../../src/components/bead-market/BeadMarketSessions';
import '../../src/styles.css';
import '../../src/theme.css';
import '../../src/appearance-palettes.css';
import '../../src/surface-depth.css';
import '../../src/next-interface.css';

const projectId = 'market-ui-project';
function Fixture() {
  const [document, setDocument] = useState<BeadDocument>(), [dark, setDark] = useState(false), [issue, setIssue] = useState(''), [color, setColor] = useState(localStorage.getItem('market-ui-color') || '#2463eb');
  useEffect(() => { documentElement(false); void window.desktop!.beads!.read({ projectId }).then(value => { if (value) setDocument(value); else setIssue('原生图纸未读取'); }, error => setIssue(String(error))); }, []);
  const props = { workspaceId: 'market-ui-workspace', projects: [{ id: projectId, workspaceId: 'market-ui-workspace', name: '合成材料采购验收', kind: 'image' }], activeProject: { id: projectId, name: '合成材料采购验收', kind: 'image' }, configuration: { models: [], connections: [], credentials: [] }, ledger: [], preferences: { hourlyRate: 0 }, navigate: () => setIssue('测试不切换到其他应用页面'), notify: (value: string) => setIssue(value), workflowRunner: { runs: [], saveArtifact: (id: string) => window.desktop!.runtime.saveArtifact(id), previewArtifact: (id: string) => window.desktop!.runtime.previewArtifact(id), thumbnailArtifact: (id: string) => window.desktop!.runtime.thumbnailArtifact(id) } } as unknown as PageProps;
  return <><header className="market-fixture-bar"><div><strong>独立采购界面验收</strong><small>真实React与Native文件／计算／导出；平台响应为合成数据，无Key、不联网、不代表真实商家报价</small></div><button type="button" className="btn btn-secondary" onClick={() => { const next = !dark; setDark(next); documentElement(next); }}>{dark ? '切到白天' : '切到黑夜'}</button></header><main className="market-fixture-content">{issue && <p role="status">{issue}</p>}<section className="market-fixture-platforms"><BeadMarketSessions /></section>{document ? <BeadMarketPanel props={props} projectId={projectId} document={document} /> : <p role="status">正在读取真实本地图纸…</p>}<section className="market-fixture-brand"><h2>品牌配色</h2><BrandColorPicker value={color} onChange={value => { setColor(value); localStorage.setItem('market-ui-color', value); }} rememberKey="market-ui-color-advanced" brandName="合成品牌" /><p role="status">配色已保存到本次隔离浏览器</p></section></main></>;
}
function documentElement(dark: boolean) { document.documentElement.dataset.appTheme = dark ? 'dark' : 'light'; document.documentElement.dataset.appPalette = 'violet'; }
const style = document.createElement('style'); style.textContent = 'body{height:auto;min-height:100vh;background:var(--ui-bg)}#root{height:auto}.market-fixture-bar{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 28px;background:var(--ui-surface);color:var(--ui-fg);border-bottom:1px solid var(--ui-border)}.market-fixture-bar strong,.market-fixture-bar small{display:block}.market-fixture-bar small{font-size:12px;color:var(--ui-fg-secondary)}.market-fixture-content{padding:24px;max-width:1488px;margin:auto;min-width:0}.market-fixture-brand{padding:24px;margin-top:24px;border:1px solid var(--ui-border);border-radius:16px;background:var(--ui-surface);color:var(--ui-fg)}.market-fixture-brand h2{font-size:21px;margin:0 0 16px}.market-fixture-brand p{font-size:12px;color:var(--ui-fg-secondary)}'; document.head.append(style);
createRoot(document.getElementById('root')!).render(<Fixture />);
