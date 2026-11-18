import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import type { AnimationDocument, AnimationEntry } from '../../animation-types';
import type { ArtifactMetadata } from '../../live-types';
import type { WorkflowRunner } from '../../configuration-types';
import { replaceAnimationSource } from '../../lib/animation-source-replace';
import { animationTemplateSourceIds } from '../../lib/template-sources';
import { RememberedDetails } from '../RememberedDetails';
import { Select } from '../Select';
import { animationError } from './animation-ui';

export function AnimationSourceReplacement({ document, entry, frameId, artifacts, runner, disabled, onChange, onIssue, onBusyChange }: { document: AnimationDocument; entry: AnimationEntry; frameId?: string; artifacts: ArtifactMetadata[]; runner: WorkflowRunner; disabled: boolean; onChange: (document: AnimationDocument) => void; onIssue: (message: string) => void; onBusyChange: (value: boolean) => void }) {
  const [imported, setImported] = useState<ArtifactMetadata[]>([]), [newId, setNewId] = useState(''), [oldId, setOldId] = useState(''), [compatible, setCompatible] = useState(false), [busy, setBusy] = useState(false);
  const alive = useRef(true), working = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, [document.projectId]);
  const placeholders = useMemo(() => animationTemplateSourceIds(document), [document.entries]);
  const files = useMemo(() => [...new Map([...artifacts, ...imported].filter(file => file.projectId === document.projectId && ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType) && !file.trashedAt && !file.unavailable && !placeholders.has(file.id)).map(file => [file.id, file])).values()], [artifacts, imported, document.projectId, placeholders]);
  const sources = [...new Set(entry.frames.map(frame => frame.atlasArtifactId))], selectedOld = sources.includes(oldId) ? oldId : sources.find(id => placeholders.has(id)) || sources[0], placeholder = entry.frames.some(frame => frame.templatePlaceholder);
  const affected = document.entries.flatMap(entry => entry.frames).filter(frame => frame.atlasArtifactId === selectedOld), needsCompatibility = affected.length > 1 || affected.some(frame => frame.crop || frame.grid[0] * frame.grid[1] > 1);
  useEffect(() => setCompatible(false), [entry.id, selectedOld]);
  async function importSource() {
    if (disabled || working.current) return; working.current = true; setBusy(true); onBusyChange(true);
    try { const files = (await runner.importFiles(document.projectId)).filter(file => file.projectId === document.projectId && ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType) && !file.trashedAt && !file.unavailable); if (alive.current && files.length) { setImported(current => [...files, ...current]); setNewId(files[0].id); setCompatible(false); } }
    catch (cause) { if (alive.current) onIssue(animationError(cause)); }
    finally { working.current = false; if (alive.current) { setBusy(false); onBusyChange(false); } }
  }
  async function replace(single: boolean) {
    if (disabled || working.current || !newId || !selectedOld || !single && needsCompatibility && !compatible) return;
    const source = files.find(file => file.id === newId), frame = entry.frames.find(frame => frame.id === frameId); if (!source || single && !frame) return;
    working.current = true; setBusy(true); onBusyChange(true);
    try {
      const metadata = runner.thumbnailArtifact ? await runner.thumbnailArtifact(source.id) : await runner.previewArtifact(source.id), width = metadata.originalWidth || metadata.width, height = metadata.originalHeight || metadata.height;
      if (!width || !height) throw Error('未核实新图真实尺寸，请重新读取或导入原始图片。');
      const value = replaceAnimationSource(document, { projectId: source.projectId!, oldArtifactId: single ? frame!.atlasArtifactId : selectedOld, newArtifactId: source.id, width, height, ...(single ? { entryId: entry.id, frameId } : {}) });
      if (alive.current) { onChange(value); setCompatible(false); }
    } catch (cause) { if (alive.current) onIssue(animationError(cause)); }
    finally { working.current = false; if (alive.current) { setBusy(false); onBusyChange(false); } }
  }
  return <RememberedDetails className="animation-advanced animation-source-replacement" rememberKey={`animation:${document.projectId}:replace-source`} defaultOpen={placeholder}><summary>{placeholder ? '模板源图待替换' : '替换兼容图集或源帧'} <small>保留动作顺序与停顿 · 0 API</small></summary><p>更换现有画面不会自动补出新动作。新图需与原图集的网格、姿态顺序及裁切兼容；若只有静态人物照，请加入“角色参考”，再明确使用 AI 制作样片，不会自动收费。</p>{sources.length > 1 && <label>要替换的原图集<Select aria-label="待替换动画源图集" value={selectedOld} disabled={disabled || busy} options={sources.map((id, index) => ({ value: id, label: `源图集 ${index + 1}` }))} onValueChange={value => { setOldId(value); setCompatible(false); }} /></label>}<div className="animation-button-row"><button type="button" className="btn btn-secondary" disabled={disabled || busy} onClick={() => { void importSource(); }}><ImagePlus size={14} />上传替换图集／源帧</button></div><label>选择新画面<Select aria-label="新的动画图集或源帧" value={newId} disabled={disabled || busy} options={[{ value: '', label: '选择本项目的静态图片' }, ...files.map(file => ({ value: file.id, label: file.name }))]} onValueChange={value => { setNewId(value); setCompatible(false); }} /></label>{needsCompatibility && <label className="animation-source-confirm"><input type="checkbox" checked={compatible} disabled={disabled || busy || !newId} onChange={event => setCompatible(event.target.checked)} />我确认这是与原网格、裁切和姿态顺序兼容的图集</label>}<div className="animation-button-row"><button type="button" className="btn btn-secondary" disabled={disabled || busy || !newId || newId === selectedOld || needsCompatibility && !compatible} onClick={() => { void replace(false); }}>{needsCompatibility ? '替换所有使用此图集的帧' : '替换完整源画面'}</button>{frameId && <button type="button" className="btn btn-secondary" disabled={disabled || busy || !newId} onClick={() => { void replace(true); }}>只替换当前选帧为完整图片</button>}</div><p>只替换选帧会保留其他姿态，请检查角色一致性。替换后先更新本地预览，再导出；原图与历史费用保留。</p></RememberedDetails>;
}
