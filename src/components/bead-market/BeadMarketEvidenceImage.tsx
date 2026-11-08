import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { WorkflowRunner } from '../../configuration-types';
import { ModalPortal } from '../ModalPortal';
import { marketError } from './market-ui';
export function BeadMarketEvidenceImage({ artifactId, runner }: { artifactId: string; runner: WorkflowRunner }) {
  const [preview, setPreview] = useState<{ id: string; url: string }>(), [full, setFull] = useState<{ id: string; url: string }>(), [opening, setOpening] = useState(false), [issue, setIssue] = useState('');
  const owner = useRef(artifactId); owner.current = artifactId;
  useEffect(() => { let active = true; setPreview(undefined); setFull(undefined); setIssue(''); if (runner.thumbnailArtifact) void Promise.resolve().then(() => runner.thumbnailArtifact!(artifactId)).then(value => { if (active && value.dataUrl) setPreview({ id: artifactId, url: value.dataUrl }); }).catch(() => undefined); return () => { active = false; }; }, [artifactId, runner.thumbnailArtifact]);
  const current = preview?.id === artifactId ? preview.url : undefined;
  async function open() { const target = artifactId; setOpening(true); setIssue(''); try { const value = await runner.previewArtifact(target); if (owner.current !== target) return; if (!value.dataUrl) throw Error('截图暂时无法读取，请保留原文件并重新导入。'); setFull({ id: target, url: value.dataUrl }); } catch (cause) { if (owner.current === target) setIssue(marketError(cause)); } finally { if (owner.current === target) setOpening(false); } }
  return <div className="bm-evidence-image"><button type="button" disabled={opening} onClick={() => { void open(); }}>{current ? <img src={current} alt="导入的材料报价截图" decoding="async" /> : <span>查看导入的报价截图</span>}<small>{opening ? '正在读取…' : '点击查看原尺寸'}</small></button>{issue && <p className="bm-error" role="alert">{issue}</p>}{full?.id === artifactId && <ModalPortal onClose={() => setFull(undefined)}><div className="bm-modal-overlay"><section className="bm-offer-dialog bm-image-dialog" role="dialog" aria-modal="true" aria-label="材料报价原始截图"><header><h2>材料报价原始截图</h2><button type="button" className="btn-icon" aria-label="关闭报价截图" onClick={() => setFull(undefined)}><X size={20} /></button></header><div className="bm-original-image"><img src={full.url} alt="导入的材料报价原始截图" /></div></section></div></ModalPortal>}</div>;
}
