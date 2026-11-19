import { useState, type ReactNode } from 'react';
import { CircleUserRound, Eye, Image, LoaderCircle, MessageSquare } from 'lucide-react';
import type { usePreparedRedPacketCover } from '../hooks/usePreparedRedPacketCover';
import layout from '../../electron/red-packet-cover-layout.json';
import './red-packet-cover.css';

const curve = Array.from({ length: 33 }, (_, i) => { const t = i / 32; return (100 * t) + '% ' + (100 * (1 - (2 * t - 1) ** 2)) + '%'; });
const corners = 'polygon(' + curve.join(', ') + ', 100% 100%, 0 100%)';
export const coverFileSize = (bytes: number) => (bytes / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 3 }) + ' KB';

export function RedPacketCoverPreview({ preparation, original }: {
  preparation: ReturnType<typeof usePreparedRedPacketCover>; original?: ReactNode;
}) {
  const [view, setView] = useState<'original' | 'message' | 'open'>('original');
  const [crop, setCrop] = useState(72), [showSource, setShowSource] = useState(false);
  const overlay = view === 'open', bubble = view === 'message';
  const { file, error, retry } = preparation, { identity, button, cornerDepth } = layout;
  return <section className="red-packet-result" aria-label="微信红包封面结果">
    <header className="red-packet-result-toolbar">
      <div className="red-packet-view" role="group" aria-label="红包封面预览方式">
        <button type="button" aria-pressed={view === 'original'} onClick={() => setView('original')}><Image size={15} />原图</button>
        <button type="button" aria-pressed={bubble} onClick={() => setView('message')}><MessageSquare size={15} />聊天气泡</button>
        <button type="button" aria-pressed={overlay} onClick={() => setView('open')}><Eye size={15} />拆红包页</button>
      </div>
      {file && <output className="red-packet-spec" title={file.bytes.toLocaleString('zh-CN') + ' 字节'}>
        {file.width} × {file.height} px · JPG · <strong>{coverFileSize(file.bytes)}</strong>
      </output>}
    </header>
    <div className={bubble ? 'red-packet-stage is-chat' : 'red-packet-stage'}>
      {file ? <div className={bubble ? 'red-packet-card is-bubble' : overlay ? 'red-packet-card with-system' : 'red-packet-card'}>
        {bubble && <div className="red-packet-chat-sender"><CircleUserRound size={25} /><span>发送者</span></div>}<div className="red-packet-frame">
        <img src={file.dataUrl} style={bubble ? { objectPosition: 'center ' + crop + '%' } : undefined} alt={bubble ? '聊天中的红包封面取景' : overlay ? '封面及微信拆红包页遮挡示意' : '将要导出的封面原图'} width={file.width} height={file.height} />
        {bubble && <button type="button" className="red-packet-bubble-open" aria-label="点开红包预览拆红包页" onClick={() => setView('open')}>
          <span className="red-packet-bubble-line"><span className="red-packet-mini-envelope" aria-hidden="true"><i /></span><strong>恭喜发财，大吉大利</strong></span>
          <small>微信红包</small>
        </button>}
        {overlay && <div className="red-packet-overlay" aria-hidden="true">
          <div className="red-packet-system-info" style={{left: identity.left * 100 + '%', top: identity.top * 100 + '%', width: (identity.right - identity.left) * 100 + '%', height: (identity.bottom - identity.top) * 100 + '%'}}>
            <span><CircleUserRound size={21} />发送者的红包</span><strong>恭喜发财，大吉大利</strong>
          </div>
          <div className="red-packet-system-corners" style={{height: cornerDepth * 100 + '%', clipPath: corners}} />
          <span className="red-packet-system-open" style={{left: button.centerX * 100 + '%', top: button.centerY * 100 + '%', width: button.diameterRatio * 100 + '%'}}><b>開</b></span>
        </div>}
      </div>{overlay && <div className="red-packet-system-foot" aria-hidden="true" />}</div> : error ? <p className="red-packet-result-error" role="alert">{error} <button type="button" className="text-button" onClick={retry}>重新准备</button></p>
        : <p className="red-packet-result-note" role="status"><LoaderCircle size={16} className="spin" />正在本机准备封面…</p>}
    </div>
    {bubble && file && <label className="red-packet-crop">气泡取景<input type="range" min="0" max="100" value={crop} onChange={event => setCrop(Number(event.target.value))} /></label>}
    <footer className="red-packet-caption">
      <span>{bubble ? '聊天中点开前的示意，实际取景可在微信平台调整。' : overlay ? '拆红包页模拟 · 昵称、祝福语和按钮只在预览中显示。' : '预览与导出使用同一份 JPG。'}</span>
      {original && !error && <button type="button" className="text-button" aria-expanded={showSource} onClick={() => setShowSource(value => !value)}>{showSource ? '收起生成源图' : '查看生成源图'}</button>}
    </footer>
    {(showSource || error) && original}
  </section>;
}
