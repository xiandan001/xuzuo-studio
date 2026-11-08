import type { AnimationEntry } from '../../animation-types';
import type { ArtifactMetadata } from '../../live-types';
import { RememberedDetails } from '../RememberedDetails';

export function AnimationInspection({ entry, artifact, changed }: { entry: AnimationEntry; artifact?: ArtifactMetadata; changed: boolean }) {
  const report = entry.inspection;
  if (!report || !artifact || artifact.trashedAt || artifact.unavailable) return null;
  return <section aria-label="当前动画合成结果"><p className="animation-hint">实际 {report.width} × {report.height} · {report.frames} 帧 · {(report.loopMs / 1000).toFixed(2)} 秒{report.transparent ? ' · 含透明像素' : ' · 不透明'}</p>{(changed || entry.status === 'stale') && <p className="animation-hint">这是上次合成文件的报告，当前修改需重新合成后核对。</p>}<RememberedDetails className="animation-advanced" rememberKey="animation:composition-checks"><summary>合成检查 <small>{report.warnings.length ? `${report.warnings.length} 项提示` : '技术检查记录'}</small></summary>{report.warnings.map((warning, index) => <p key={index}>{warning}</p>)}<p>技术检查不代表视觉、人物一致性或商用授权已经通过。</p></RememberedDetails></section>;
}
