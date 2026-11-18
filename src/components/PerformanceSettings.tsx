import { useEffect, useRef, useState } from 'react';
import { Activity, Check, RefreshCw } from 'lucide-react';
import type { ApplicationPerformanceSnapshot } from '../performance-types';
import { RememberedDetails } from './RememberedDetails';
import './performance-settings.css';

const TASK_NAMES: Record<string, string> = { 'commerce-preview': '图片清晰预览', 'reference-text': '资料解读', office: '文档导出', wallpaper: '壁纸适配', engineering: '工程图适配', 'image-alpha': '图片检查', 'delivery-preflight': '交付检查', 'commerce-compose': '图片排版导出', 'commerce-alpha': '主体透明处理', 'commerce-protect': '主体精确保护', 'business-listing-zip': '成品打包', bead: '拼豆制图', 'bead-export': '拼豆导出', 'bead-bundle': '拼豆导出' };
const name = (task: string) => TASK_NAMES[task] || '本地文件处理';

export function PerformanceSettings() {
  const bridge = typeof window !== 'undefined' ? window.desktop?.performance : undefined;
  const [snapshot, setSnapshot] = useState<ApplicationPerformanceSnapshot>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), active = useRef(false), requestedMode = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const token = ++generation.current;
    if (bridge) void bridge.read().then(value => { if (token === generation.current) setSnapshot(value); }).catch(() => { if (token === generation.current) setError('性能信息暂未读取，请点击刷新；当前模式保持。'); });
    return () => { generation.current++; };
  }, [bridge]);
  async function update(lowResource?: boolean) {
    if (!bridge || active.current) return;
    const token = generation.current; active.current = true; setBusy(true); setError('');
    requestedMode.current = lowResource;
    try { const value = lowResource === undefined ? await bridge.read() : await bridge.save({ lowResource }); if (token === generation.current) { setSnapshot(value); requestedMode.current = undefined; } }
    catch (cause) { if (token === generation.current) setError(cause instanceof Error ? cause.message : '性能设置尚未保存，请重试。'); }
    finally { active.current = false; if (token === generation.current) setBusy(false); }
  }
  return <section className="panel op-settings-panel performance-settings" aria-label="运行与性能">
    <header><h2><Activity size={18} />运行与性能</h2><p>全应用生效，自动保存。当前编辑和预览优先于尚未开始的批量处理。</p></header>
    <div className="op-setting-switch-row"><div><b>低占用模式</b><p>操作时暂缓下一项后台处理；正在保存或处理的文件会继续完成。</p></div><button type="button" role="switch" aria-label="低占用模式" aria-checked={snapshot?.lowResource === true} disabled={!bridge || !snapshot || busy} className={`op-toggle${snapshot?.lowResource ? ' checked' : ''}`} onClick={() => { void update(!snapshot?.lowResource); }}><span>{snapshot?.lowResource && <Check size={10} />}</span></button></div>
    {!bridge ? <p className="performance-note">请在最新版桌面应用中管理后台处理。</p> : <RememberedDetails rememberKey="performance:details"><summary>查看运行情况</summary><div className="performance-summary"><span role="status">{snapshot?.running ? `正在处理：${name(snapshot.running.task)}` : snapshot ? '当前没有本地重任务' : '正在读取'}{snapshot?.pending ? ` · ${snapshot.pending} 项等待` : ''}</span><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { void update(); }}><RefreshCw size={14} />刷新采样</button></div><dl className="performance-metrics"><div><dt>CPU 采样合计</dt><dd>{snapshot?.cpuPercent === undefined ? '再次刷新后显示' : `${snapshot.cpuPercent}%`}</dd></div><div><dt>应用进程工作集</dt><dd>{snapshot?.memoryMb === undefined ? '暂未提供' : `${snapshot.memoryMb} MB`}</dd></div><div><dt>后台等待</dt><dd>{snapshot?.pending ?? '—'} 项</dd></div></dl><p className="performance-note">仅点击刷新时采样，不持续监控。进程采样合计用于观察变化，内存可能包含共享部分。</p>{!!snapshot?.recent.length && <ol className="performance-recent" aria-label="最近本地处理">{snapshot.recent.slice(-5).reverse().map((item, index) => <li key={index}><span>{name(item.task)}<small>{item.outcome === 'complete' ? '已完成' : item.outcome === 'cancelled' ? '已取消' : '未完成'}</small></span><span>等待 {Math.round(item.queueMs)} ms · 处理 {Math.round(item.runMs)} ms</span></li>)}</ol>}</RememberedDetails>}
    {(error || snapshot?.preferenceError) && <p className="performance-error" role="alert">{error || snapshot?.preferenceError}<button type="button" className="text-button" disabled={busy} onClick={() => { void update(snapshot?.preferenceError && requestedMode.current === undefined ? snapshot.lowResource : requestedMode.current); }}>重试</button></p>}
  </section>;
}
