import { useState } from 'react';

function imageAddress(value: string): string | undefined {
  try { const url = new URL(value); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return value; } catch { /* Unsupported image addresses remain readable text. */ }
}

export function ChatMarkdownImage({ url, alt, title }: { url: string; alt: string; title?: string }) {
  const [requested, setRequested] = useState<string>(), [loaded, setLoaded] = useState<string>(), [failed, setFailed] = useState<string>();
  const source = imageAddress(url), active = !!source && requested === source, error = active && failed === source;
  if (!source) return <span className="chat-reply-image-note">{alt}</span>;
  return <span className="chat-reply-image" title={title}>
    <span className="chat-reply-image-caption">{alt}</span>
    {active && !error && <img className="chat-reply-image-preview" src={source} alt={alt} title={title} loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setLoaded(source)} onError={() => setFailed(source)} />}
    <span className="chat-reply-image-controls">
      {active && !error ? <>
        {loaded !== source && <span role="status">正在加载图片…</span>}
        <a href={source} target="_blank" rel="noopener noreferrer">打开原图</a>
        <button type="button" className="text-button" onClick={event => { event.preventDefault(); event.stopPropagation(); setRequested(undefined); }}>收起图片</button>
      </> : <>
        {error && <span className="chat-reply-image-error" role="status">图片未能加载</span>}
        <button type="button" className="text-button chat-reply-image-load" onClick={event => { event.preventDefault(); event.stopPropagation(); setFailed(undefined); setLoaded(undefined); setRequested(source); }}>{error ? '重新加载' : '加载图片'}</button>
        {error && <a href={source} target="_blank" rel="noopener noreferrer">打开图片</a>}
      </>}
    </span>
  </span>;
}
