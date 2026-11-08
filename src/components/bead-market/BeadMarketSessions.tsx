import { useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import type { BeadMarketBridge, BeadMarketPlatform, BeadMarketPlatformSession } from '../../bead-market-types';
import { MARKET_NAMES, marketError, marketTime } from './market-ui';
import './bead-market-sessions.css';

type SessionBridge = Pick<BeadMarketBridge, 'sessions' | 'login' | 'confirmLogin' | 'onSessionChanged'>;
const labels: Record<BeadMarketPlatformSession['status'], string> = { 'not-opened': '未打开', opened: '待确认登录', confirmed: '上次已确认登录', 'needs-login': '需重新登录' };
const platforms = Object.keys(MARKET_NAMES) as BeadMarketPlatform[];
export function BeadMarketSessions({ bridge = typeof window === 'undefined' ? undefined : window.desktop?.beadMarket, compact = false }: { bridge?: SessionBridge; compact?: boolean } = {}) {
  const [entries, setEntries] = useState<BeadMarketPlatformSession[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState<BeadMarketPlatform>(), [issue, setIssue] = useState('');
  const alive = useRef(true), request = useRef(0), working = useRef(false), bridgeRef = useRef(bridge); bridgeRef.current = bridge;
  const ready = Boolean(bridge?.sessions && bridge?.login);
  async function reload() {
    const target = bridgeRef.current, epoch = ++request.current;
    if (!target?.sessions) { if (alive.current) { setLoading(false); setIssue('请在新版桌面应用中管理平台登录。'); } return; }
    try { const value = await target.sessions(); if (!Array.isArray(value)) throw Error('登录记录暂时无法读取。'); if (alive.current && epoch === request.current) { setEntries(value); setIssue(''); } }
    catch (cause) { if (alive.current && epoch === request.current) setIssue(marketError(cause)); }
    finally { if (alive.current && epoch === request.current) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true; void reload(); let timer: ReturnType<typeof setTimeout> | undefined, dirty = false;
    const schedule = () => { dirty = true; request.current++; if (document.hidden || timer !== undefined) return; timer = setTimeout(() => { timer = undefined; if (alive.current && !document.hidden && dirty) { dirty = false; void reload(); } }, 250); };
    const visible = () => { if (!document.hidden && dirty) schedule(); }, remove = bridge?.onSessionChanged?.(schedule); document.addEventListener('visibilitychange', visible);
    return () => { alive.current = false; request.current++; if (timer !== undefined) clearTimeout(timer); remove?.(); document.removeEventListener('visibilitychange', visible); };
  }, [bridge]);
  async function login(platform: BeadMarketPlatform) {
    if (!bridge?.login || working.current) return; working.current = true; setBusy(platform); setIssue('');
    try { const result = await bridge.login({ platform }); if (!result.opened) throw Error('平台窗口尚未打开，请重试。'); if (alive.current) await reload(); }
    catch (cause) { if (alive.current) setIssue(marketError(cause)); }
    finally { working.current = false; if (alive.current) setBusy(undefined); }
  }
  async function confirm(platform: BeadMarketPlatform) {
    if (!bridge?.confirmLogin || working.current) return; working.current = true; setBusy(platform); setIssue(''); const epoch = ++request.current; let saved = false;
    try { const value = await bridge.confirmLogin({ platform }); saved = true; if (alive.current && epoch === request.current) setEntries(value); }
    catch (cause) { if (alive.current) setIssue(marketError(cause)); }
    finally { working.current = false; if (alive.current) { setBusy(undefined); if (saved) await reload(); } }
  }
  return <section className={`bm-sessions${compact ? ' is-compact' : ''}`} aria-label="采购平台提前登录"><header><div><span><ShieldCheck size={16} />全应用共用</span>{compact ? <h3>采购平台登录</h3> : <h2>采购平台登录</h2>}<p>可提前登录一次，后续项目复用平台网页会话。</p></div><button type="button" className="text-button" aria-label="刷新平台登录记录" disabled={loading || !!busy || !ready} onClick={() => { void reload(); }}><RefreshCw size={14} />刷新记录</button></header><div className="bm-session-grid">{platforms.map(platform => { const entry = entries.find(item => item.platform === platform), status = entry?.status || 'not-opened'; return <article key={platform} className={`bm-session-card is-${status}`} aria-label={`${MARKET_NAMES[platform]}网页登录记录`}><div><strong>{MARKET_NAMES[platform]}</strong><span>{loading ? '正在读取本机记录…' : labels[status]}</span></div><p>{entry?.userConfirmedAt ? `上次确认：${marketTime(entry.userConfirmedAt)}` : entry?.openedAt ? `打开记录：${marketTime(entry.openedAt)}` : '账号和验证码由你直接在平台页面填写。'}</p><div className="bm-session-actions"><button type="button" className="btn btn-secondary" aria-label={`提前登录${MARKET_NAMES[platform]}`} disabled={!ready || !!busy} onClick={() => { void login(platform); }}><ExternalLink size={14} />{busy === platform ? '正在处理…' : status === 'confirmed' ? '打开平台' : '提前登录'}</button>{status === 'opened' && bridge?.confirmLogin && <button type="button" className="text-button" aria-label={`确认${MARKET_NAMES[platform]}已完成网页登录`} disabled={!!busy} onClick={() => { void confirm(platform); }}>我已完成登录</button>}</div></article>; })}</div>{issue && <p className="bm-session-error" role="alert">{issue}<button type="button" className="text-button" disabled={!ready || !!busy} onClick={() => { void reload(); }}>重新读取记录</button></p>}<p className="bm-session-note">登录状态以平台实际页面为准，平台可能要求重新验证。这里是网页登录会话；开放平台 API 授权需平台另行批准。</p></section>;
}
