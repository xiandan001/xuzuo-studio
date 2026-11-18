import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleUserRound, Download, Gift, LoaderCircle } from 'lucide-react';
import type { WorkflowRunner } from '../configuration-types';
import type { ArtifactMetadata } from '../live-types';
import './red-packet-cover.css';

type PreviewState = { url: string } | { error: string };

export function RedPacketCoverPreview({ source, runner, original, disabled, exporting, exportError, onExport }: {
  source?: ArtifactMetadata; runner: WorkflowRunner; original: ReactNode; disabled: boolean;
  exporting: boolean; exportError: string; onExport: () => void;
}) {
  const [view, setView] = useState<'original' | 'mock'>('original');
  const [preview, setPreview] = useState<PreviewState>();
  const [retry, setRetry] = useState(0);
  const runnerRef = useRef(runner);
  runnerRef.current = runner;
  useEffect(() => {
    if (!source || view !== 'mock' || preview) return;
    let current = true;
    const read = runnerRef.current.thumbnailArtifact || runnerRef.current.previewArtifact;
    void read(source.id).then(result => {
      if (!result.dataUrl || !/^data:image\/(?:png|jpeg|webp);base64,/i.test(result.dataUrl)) throw Error('预览格式不可用');
      if (current) setPreview({ url: result.dataUrl });
    }).catch(() => {
      if (current) setPreview({ error: '暂时无法读取当前封面，请检查原图后重试。' });
    });
    return () => { current = false; };
  }, [source?.id, view, preview, retry]);

  return <section className="red-packet-result" aria-label="微信红包封面结果">
    <header className="red-packet-result-toolbar">
      <div className="red-packet-view" role="group" aria-label="红包封面预览方式">
        <button type="button" aria-pressed={view === 'original'} onClick={() => setView('original')}>原图</button>
        <button type="button" aria-pressed={view === 'mock'} disabled={!source} onClick={() => setView('mock')}>红包位置模拟</button>
      </div>
      <button type="button" className="btn btn-secondary" disabled={!source || !runner.exportRedPacketCover || disabled || exporting} onClick={onExport}>
        {exporting ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}{exporting ? '正在导出…' : '导出红包封面 JPEG'}
      </button>
    </header>
    {exportError && <p className="red-packet-result-error" role="alert">{exportError}</p>}
    {source && !runner.exportRedPacketCover && <p className="red-packet-result-note">当前桌面后台不支持红包封面 JPEG 导出。</p>}
    {view === 'original' ? original : <div className="red-packet-simulation">
      {preview && 'url' in preview ? <>
        <div className="red-packet-simulation-frame">
          <img alt="裁剪后的红包封面画面" src={preview.url} />
          <div className="red-packet-overlay" aria-hidden="true">
            <div className="red-packet-overlay-profile"><CircleUserRound size={25} /><span>发送者昵称</span></div>
            <span className="red-packet-overlay-greeting">祝福语显示区</span>
            <div className="red-packet-overlay-bottom"><span>开</span></div>
          </div>
        </div>
        <p className="red-packet-result-note">模拟居中裁剪及界面遮挡。导出的 JPEG 只包含封面图案。</p>
      </> : preview && 'error' in preview ? <p className="red-packet-result-error" role="alert">
        {preview.error} <button type="button" className="text-button" onClick={() => { setPreview(undefined); setRetry(value => value + 1); }}>重新读取</button>
      </p> : <p className="red-packet-result-note" role="status"><LoaderCircle size={16} className="spin" /> 正在读取本机封面原图…</p>}
    </div>}
    {!source && <p className="red-packet-result-note"><Gift size={14} />生成静态封面后可模拟位置并导出 957 × 1278 JPEG。</p>}
  </section>;
}
