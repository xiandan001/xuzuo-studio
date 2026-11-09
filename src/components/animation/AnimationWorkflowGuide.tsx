import { Check, Clapperboard, FolderOpen, ImagePlus, Sparkles } from 'lucide-react';
import type { AnimationMode } from '../../animation-types';
import './animation-workflow-guide.css';

interface WorkflowGuideProps {
  mode: AnimationMode;
  hasFrames: boolean;
  ready: boolean;
  multiple: boolean;
  accepted: boolean;
}

function guideHint({ mode, hasFrames, ready, multiple, accepted }: WorkflowGuideProps): string {
  if (!hasFrames) return mode === 'atlas'
    ? '描述角色外观和想要的表情，先做一张 PNG；参考图可选。'
    : '描述角色外观和动作，先做一份 GIF；姿态生成后会自动在本地合成。';
  if (!ready) return '已有源图，可免费更新预览；需要改变角色画面时，再使用 AI 重新制作。';
  const output = mode === 'atlas' ? 'PNG' : 'GIF';
  if (multiple && !accepted) return `可直接导出当前 ${output}；要继续批量制作时，先认可这份样片。`;
  if (multiple) return `样片已认可，可以扩展其余作品，也可先导出当前 ${output}。`;
  return `当前 ${output} 已就绪，可以导出；本地修改后可免费更新预览。`;
}

export function AnimationWorkflowGuide(props: WorkflowGuideProps) {
  const current = !props.hasFrames ? 0 : props.ready ? 2 : 1;
  return <section className="animation-workflow-guide" aria-label="制作步骤">
    <ol aria-label="当前制作进度">
      {['描述需求', '制作与检查', '导出作品'].map((label, index) => <li key={label} className={index === current ? 'is-current' : index < current ? 'is-complete' : undefined} aria-current={index === current ? 'step' : undefined}>
        <span className="animation-workflow-guide-number" aria-hidden="true">{index < current ? <Check size={14} /> : index + 1}</span>
        <span>{label}</span>
      </li>)}
    </ol>
    <p>{guideHint(props)}</p>
  </section>;
}

interface EmptyPreviewProps {
  mode: AnimationMode;
  onExample: () => void;
  onImport?: () => void;
  disabled: boolean;
  canFillExample: boolean;
}

export function AnimationEmptyPreview({ mode, onExample, onImport, disabled, canFillExample }: EmptyPreviewProps) {
  const atlas = mode === 'atlas';
  return <section className="animation-empty-preview" aria-label={atlas ? '开始制作角色图集' : '开始制作 GIF 动画'}>
    <span className="animation-empty-preview-icon" aria-hidden="true">{atlas ? <ImagePlus size={25} /> : <Clapperboard size={25} />}</span>
    <h3>{atlas ? '先做一张角色图' : '先做一份 GIF 样片'}</h3>
    <p>{atlas ? '填写角色外观与表情，制作后在这里查看 PNG。' : '填写角色外观与动作，制作后在这里播放 GIF。'}参考图片可选。</p>
    <div className="animation-empty-preview-actions">
      {canFillExample && <button type="button" className="btn btn-primary" disabled={disabled} onClick={onExample}><Sparkles size={15} />填入示例</button>}
      {onImport && <button type="button" className="btn btn-secondary" disabled={disabled} onClick={onImport}><FolderOpen size={15} />导入已有工程</button>}
    </div>
    <small>填入示例和导入工程不调用模型。</small>
  </section>;
}
