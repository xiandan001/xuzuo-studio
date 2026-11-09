import { Pause, Play, RefreshCw } from 'lucide-react';
import type { AnimationEntry, AnimationMode } from '../../animation-types';
import { RememberedDetails } from '../RememberedDetails';
import './animation-preview-header.css';

interface Props {
  entry?: AnimationEntry;
  index: number;
  mode: AnimationMode;
  status: string;
  metadata: string;
  canPlay: boolean;
  playing: boolean;
  disabled: boolean;
  composeDisabled?: boolean;
  onTogglePlaying: () => void;
  onCompose: () => void;
}

export function AnimationPreviewHeader({ entry, index, mode, status, metadata, canPlay, playing, disabled, composeDisabled = false, onTogglePlaying, onCompose }: Props) {
  return <>
    <div className="animation-preview-heading">
      <div className="animation-preview-copy">
        <strong className="animation-preview-title">第 {Math.max(0, index) + 1} 份 · {mode === 'gif' ? '动画预览' : '角色预览'}</strong>
        {entry?.caption && <p className="animation-preview-caption" title={entry.caption}>{entry.caption}</p>}
        <small>{status} · {metadata}</small>
      </div>
      <div className="animation-preview-actions">
        {canPlay && <button type="button" className="btn btn-secondary" disabled={disabled} onClick={onTogglePlaying}>
          {playing ? <Pause size={15} /> : <Play size={15} />}{playing ? '暂停预览' : '播放 GIF'}
        </button>}
        <button type="button" className="btn btn-secondary" disabled={disabled || composeDisabled || !entry?.frames.length} onClick={onCompose} title="仅使用已有源图更新预览，不调用模型、不新增费用。">
          <RefreshCw size={15} />更新预览
        </button>
      </div>
    </div>
    {entry?.description && <RememberedDetails className="animation-advanced animation-preview-requirements" rememberKey="animation:preview-requirements">
      <summary>查看画面要求</summary>
      <p>{entry.description}</p>
    </RememberedDetails>}
  </>;
}
