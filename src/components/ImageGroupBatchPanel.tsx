import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, LoaderCircle, Pause, Play, Plus, RefreshCw, RotateCcw, Square, Trash2 } from 'lucide-react';
import type { BatchAction, BatchRecord } from '../batch-types';
import type { PageProps, Project } from '../types';
import { CostTotal } from './CostAmount';
import { StudioDrawer } from './StudioDrawer';
import { Select } from './Select';
import { summarizeCosts } from '../lib/cost-display';
import { downloadFile } from '../lib/files';
import { createImageGroupBatch, imageGroupDraftKey, imageGroupImages, imageGroupRowIssue, imageGroupSettingsKey, imageGroupOutputIssue, imageGroupOutputSettings, initialImageGroupDraft, newImageGroup, readImageGroupDraft, IMAGE_GROUP_LIMIT, IMAGE_GROUP_PAGE_SIZE, IMAGE_GROUP_TOTAL_LIMIT } from '../lib/image-group-batch';
import type { ImageGroupDraft, ImageGroupRow, ImageGroupSettings } from '../lib/image-group-batch';
import './image-group-batch.css';

interface Props { props: PageProps; project: Project; settings: ImageGroupSettings; busy: boolean; onClose: () => void; }
const labels = { queued: '待开始', submitting: '正在提交', running: '生成中', paused: '后续已暂停', 'waiting-review': '等待检查', complete: '生成完成 · 待检查', cancelled: '已取消', interrupted: '已中断，待处理', failed: '失败' };
const publicError = (cause: unknown) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '分组操作未完成，已有图片和费用保留。';
export function ImageGroupBatchPanel({ props, project, settings, busy: projectBusy, onClose }: Props) {
  const scope = `${props.workspaceId}/${project.id}`, key = imageGroupDraftKey(props.workspaceId, project.id), bridge = window.desktop?.batches;
  const [initial] = useState(() => { const fallback = initialImageGroupDraft(project); try { return { draft: readImageGroupDraft(localStorage.getItem(key), fallback), error: '' }; } catch { return { draft: fallback, error: '原分组草稿暂时无法读取，未覆盖原记录。可使用当前输入重新保存。' }; } });
  const [draft, setDraft] = useState(initial.draft), [readBlocked, setReadBlocked] = useState(!!initial.error), [draftError, setDraftError] = useState(initial.error);
  const [batches, setBatches] = useState<BatchRecord[]>([]), [selectedId, setSelectedId] = useState(initial.draft.submitted?.batchId || ''), [editPage, setEditPage] = useState(0), [resultPage, setResultPage] = useState(0);
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const alive = useRef(true), starting = useRef(false), polling = useRef(false), latest = useRef({ draft, readBlocked, selectedId, props, scope }); latest.current = { draft, readBlocked, selectedId, props, scope };
  const validation = useRef(new WeakMap<ImageGroupRow, string>());
  const issues = useMemo(() => draft.groups.map(row => { const cached = validation.current.get(row); if (cached !== undefined) return cached; const issue = imageGroupRowIssue(row); validation.current.set(row, issue); return issue; }), [draft.groups]);
  const firstIssue = issues.findIndex(Boolean), total = draft.groups.reduce((sum, row) => sum + (Number(row.count) || 0), 0), settingsKey = imageGroupSettingsKey(settings);
  const selected = batches.find(batch => batch.id === selectedId) || batches[0], activeBatch = batches.some(batch => batch.status === 'running' || batch.status === 'waiting-review' || batch.items.some(item => ['running', 'submitting', 'waiting-review'].includes(item.status)));
  const locked = draft.submitted?.revision === draft.revision && draft.submitted.settings === settingsKey;
  const common = imageGroupOutputSettings(settings), outputIssue = imageGroupOutputIssue(settings), format = common.imageOptions.imageOutputFormat || 'png';
  const issue = !props.workspace.directory ? '请先为工作区绑定本地文件夹。' : !bridge ? '请在桌面应用中执行真实分组生成。' : !settings.model || !settings.credentialId ? '请先在图片生成设置选择本次生成模型和Key。' : outputIssue ? outputIssue : !draft.name.trim() ? '请填写批次名称。' : !draft.groups.length ? '请至少添加一组。' : firstIssue >= 0 ? `第${firstIssue + 1}组：${issues[firstIssue]}` : total > IMAGE_GROUP_TOTAL_LIMIT ? '本批总计最多500张图片。' : projectBusy ? '当前项目仍在制作，完成后再开始新的分组批次。' : activeBatch ? '有批次正在处理，请先暂停并等待当前组结束。' : locked ? '此批已创建；请使用下方队列控制，或明确新建一批。' : '';
  function save(value = latest.current.draft) { if (latest.current.readBlocked) return false; try { localStorage.setItem(key, JSON.stringify(value)); if (alive.current) setDraftError(''); return true; } catch { if (alive.current) setDraftError('分组草稿未能保存，当前输入仍保留；未开始新的模型调用。'); return false; } }
  useEffect(() => { if (readBlocked) return; const timer = window.setTimeout(() => save(), 600); return () => window.clearTimeout(timer); }, [draft, readBlocked]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; save(); }; }, []);
  function edit(change: (value: ImageGroupDraft) => ImageGroupDraft) { setDraft(value => ({ ...change(value), revision: value.revision + 1 })); setError(''); }
  function accept(rows: BatchRecord[], replace = false) {
    const scoped = rows.filter(row => row.workspaceId === props.workspaceId && row.kind === 'image-groups');
    setBatches(previous => replace ? scoped : [...scoped, ...previous.filter(row => !scoped.some(next => next.id === row.id))]);
    const known = new Set(latest.current.props.projects.map(item => item.id)), missing = scoped.flatMap(row => row.items.map(item => item.project)).filter(item => !known.has(item.id));
    if (missing.length) latest.current.props.onBatchProjectsCreated?.(missing);
    if (!latest.current.selectedId && scoped.length) setSelectedId(scoped[0].id);
  }
  async function refresh(all = false) {
    if (!bridge || polling.current) return; polling.current = true;
    try { const id = latest.current.selectedId, rows = all || !id ? await bridge.list() : [await bridge.get({ id })]; if (alive.current && latest.current.scope === scope) accept(rows, all || !id); }
    catch (cause) { if (alive.current) setError(publicError(cause)); } finally { polling.current = false; }
  }
  useEffect(() => { void refresh(true); const timer = window.setInterval(() => { void refresh(); }, 1200); return () => window.clearInterval(timer); }, [bridge, scope]);
  async function start() {
    if (!bridge || busy || starting.current || issue || readBlocked) return; starting.current = true; setBusy('start'); setError('');
    try {
      const snapshot = latest.current.draft, request = createImageGroupBatch(snapshot, settings, props); if (!save(snapshot)) return;
      const batch = await bridge.create(request); props.onBatchProjectsCreated?.(batch.items.map(item => item.project));
      if (!alive.current || latest.current.scope !== scope) return;
      const submitted = { ...snapshot, submitted: { batchId: batch.id, revision: snapshot.revision, settings: settingsKey } }; latest.current.draft = submitted; setDraft(submitted); setSelectedId(batch.id); accept([batch]);
      if (!save(submitted)) return;
      const started = await bridge.control({ id: batch.id, action: 'start' }); if (alive.current && latest.current.scope === scope) { accept([started]); props.notify('分组已进入顺序队列；每组是独立项目，图片与费用按实际调用保存。'); }
    } catch (cause) { if (alive.current) setError(publicError(cause)); }
    finally { starting.current = false; if (alive.current) setBusy(''); }
  }
  async function control(action: BatchAction, itemId?: string) {
    if (!bridge || !selected || busy || starting.current) return; starting.current = true; setBusy(action); setError('');
    try { const result = await bridge.control({ id: selected.id, action, itemId }); if (alive.current && latest.current.scope === scope) accept([result]); }
    catch (cause) { if (alive.current) setError(publicError(cause)); }
    finally { starting.current = false; if (alive.current) setBusy(''); }
  }
  const editPages = Math.max(1, Math.ceil(draft.groups.length / IMAGE_GROUP_PAGE_SIZE)), page = Math.min(editPage, editPages - 1), shown = draft.groups.slice(page * IMAGE_GROUP_PAGE_SIZE, (page + 1) * IMAGE_GROUP_PAGE_SIZE);
  const resultPages = Math.max(1, Math.ceil((selected?.items.length || 0) / IMAGE_GROUP_PAGE_SIZE)), results = selected?.items.slice(Math.min(resultPage, resultPages - 1) * IMAGE_GROUP_PAGE_SIZE, (Math.min(resultPage, resultPages - 1) + 1) * IMAGE_GROUP_PAGE_SIZE) || [];
  const credentialName = props.configuration.credentials.find(key => key.id === settings.credentialId)?.name || '未选择Key';
  return <StudioDrawer title="分组批量生成" description="每组独立描述与数量，使用同一个生成模型和输出规格。关闭面板不会取消已开始的队列。" onClose={onClose}><div className="ig-group-panel">
    <section className="ig-group-settings" aria-label="分组共用生成设置"><strong>新批次共用设置</strong><p>{settings.model?.name || '未选择生成模型'} · {credentialName}</p><p>{common.size} · {common.background === 'transparent' ? '透明背景' : common.background === 'opaque' ? '不透明背景' : '自动背景'}</p><p>输出：{({ png: 'PNG图片', jpeg: 'JPEG图片', webp: 'WebP图片', svg: 'SVG矢量图', gif: 'GIF动画' })[format]}{format === 'gif' && ` · ${common.imageOptions.imageFrameCount ?? 9}帧 · 每帧${common.imageOptions.imageFrameDurationMs ?? 200}ms`}</p><small>返回图片工作台可调整共用设置。不带入当前参考图、圈画标注或精修基底；各组是独立需求，不承诺人物或商品跨组一致。</small></section>
    {error && <p className="form-error" role="alert">{error}</p>}{draftError && <div className="form-error" role="alert"><p>{draftError}</p>{readBlocked ? <button type="button" className="btn btn-secondary" onClick={() => { setReadBlocked(false); latest.current.readBlocked = false; save(); }}>使用当前输入重新保存</button> : <button type="button" className="btn btn-secondary" onClick={() => save()}>重试保存草稿</button>}<button type="button" className="btn btn-ghost" onClick={() => { void downloadFile(project.name + '-分组草稿.json', JSON.stringify(draft), 'application/json'); }}>另存当前草稿</button></div>}
    <label>批次名称<input className="field" aria-label="图片分组批次名称" value={draft.name} maxLength={100} onChange={event => edit(value => ({ ...value, name: event.target.value }))} /></label>
    <div className="ig-group-heading"><strong>{draft.groups.length} 组 · 共 {total} 张</strong><button type="button" className="btn btn-secondary" disabled={draft.groups.length >= IMAGE_GROUP_LIMIT} onClick={() => { const index = draft.groups.length; edit(value => ({ ...value, groups: [...value.groups, newImageGroup(index)] })); setEditPage(Math.floor(index / IMAGE_GROUP_PAGE_SIZE)); }}><Plus size={15} />添加分组</button></div>
    <p className="ig-group-note">每组1–20张，总计最多500张；每张单独请求，按组依次生成。草稿在停止输入后保存。</p>
    <div className="ig-group-rows">{shown.map((row, offset) => { const index = page * IMAGE_GROUP_PAGE_SIZE + offset; const patch = (changes: Partial<ImageGroupRow>) => edit(value => ({ ...value, groups: value.groups.map(item => item.id === row.id ? { ...item, ...changes } : item) })); return <section className="ig-group-row" key={row.id} aria-label={`第${index + 1}组图片需求`}><div><label>组名<input className="field" aria-label={`第${index + 1}组名称`} value={row.name} maxLength={100} placeholder={`第${index + 1}组`} onChange={event => patch({ name: event.target.value })} /></label><label>数量<input className="field" aria-label={`第${index + 1}组数量`} type="number" min="1" max="20" step="1" value={row.count} onChange={event => patch({ count: event.target.value })} /></label><button type="button" className="btn-icon" aria-label={`移除第${index + 1}组草稿`} onClick={() => edit(value => ({ ...value, groups: value.groups.filter(item => item.id !== row.id) }))}><Trash2 size={16} /></button></div><label>独立画面描述<textarea className="field" rows={3} aria-label={`第${index + 1}组描述`} value={row.brief} maxLength={10000} onChange={event => patch({ brief: event.target.value })} placeholder="描述这一组的主体、用途、风格和明确要求" /></label>{issues[index] && <small>{issues[index]}</small>}</section>; })}</div>
    {editPages > 1 && <div className="ig-group-pagination"><button type="button" className="btn btn-ghost" disabled={page === 0} onClick={() => setEditPage(value => value - 1)}>上一页分组</button><span>{page + 1}/{editPages} · 每页20组</span><button type="button" className="btn btn-ghost" disabled={page >= editPages - 1} onClick={() => setEditPage(value => value + 1)}>下一页分组</button></div>}
    <section className="ig-group-start"><p>开始后，每组自动建立独立图片项目和文件夹，无需逐组选择目录。预计 {total} 次图片请求，调用费用按实际发生累计；失败重试费用保留。</p>{issue && <p role="status">{issue}{firstIssue >= 0 && Math.floor(firstIssue / IMAGE_GROUP_PAGE_SIZE) !== page && <button type="button" className="text-button" onClick={() => setEditPage(Math.floor(firstIssue / IMAGE_GROUP_PAGE_SIZE))}>定位问题组</button>}</p>}<button type="button" className="btn btn-primary" disabled={!!busy || !!issue || readBlocked} onClick={() => { void start(); }}>{busy === 'start' ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}开始分组生成</button>{locked && <button type="button" className="btn btn-ghost" disabled={!!busy || activeBatch} onClick={() => edit(value => ({ ...value, submitted: undefined }))}>按相同分组新建一批</button>}</section>
    <section className="ig-group-results" aria-label="分组生成队列"><header><h3>已保存的分组批次</h3><button type="button" className="btn btn-ghost" onClick={() => { void refresh(true); }}><RefreshCw size={15} />刷新批次</button></header>{batches.length > 0 && <Select aria-label="查看图片分组批次" value={selected?.id || ''} onValueChange={id => { setSelectedId(id); setResultPage(0); }} options={batches.map(batch => ({ value: batch.id, label: batch.name + ' · ' + labels[batch.status] }))} />}{selected ? <><div className="ig-group-heading"><strong>{selected.name} · {labels[selected.status]}</strong><CostTotal summary={summarizeCosts(selected.items.flatMap(item => item.ledger || []))} /></div><div className="ig-group-controls"><button type="button" className="btn btn-secondary" disabled={!!busy || ['running', 'complete', 'cancelled', 'waiting-review'].includes(selected.status)} onClick={() => { void control('start'); }}><Play size={15} />{selected.status === 'queued' ? '开始此批' : '继续后续组'}</button><button type="button" className="btn btn-secondary" disabled={!!busy || selected.status !== 'running'} onClick={() => { void control('pause'); }}><Pause size={15} />暂停后续组</button><button type="button" className="btn btn-ghost" disabled={!!busy || ['complete', 'cancelled'].includes(selected.status)} onClick={() => { void control('cancel'); }}><Square size={15} />取消未完成组</button></div><p className="ig-group-note">暂停后当前组会继续完成；取消、重试和移除草稿不删除已有图片或费用。中断后不会自动重发，需明确继续或重试。</p>{selected.error && <p className="form-error" role="alert">{selected.error}</p>}{results.map(item => <article className="ig-group-result" key={item.id}><div><strong>{item.row}. {item.project.name}</strong><span>{labels[item.status]} · 已保存 {imageGroupImages(item).length}/{item.imageCount} 张</span><CostTotal summary={summarizeCosts(item.ledger || [])} />{item.error && <p className="form-error">{item.error}</p>}</div><div><button type="button" className="btn btn-secondary" onClick={() => { onClose(); props.navigate('images', item.project.id); }}><FolderOpen size={15} />查看本组结果</button>{['failed', 'interrupted', 'cancelled'].includes(item.status) && <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => { void control('retry-item', item.id); }}><RotateCcw size={15} />重试此组</button>}{item.status === 'waiting-review' && <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => { void control('resume-review', item.id); }}>检查后继续</button>}{!['complete', 'cancelled'].includes(item.status) && <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => { void control('cancel-item', item.id); }}>取消此组</button>}</div></article>)}{resultPages > 1 && <div className="ig-group-pagination"><button type="button" className="btn btn-ghost" disabled={resultPage === 0} onClick={() => setResultPage(value => value - 1)}>上一页结果</button><span>{Math.min(resultPage, resultPages - 1) + 1}/{resultPages}</span><button type="button" className="btn btn-ghost" disabled={resultPage >= resultPages - 1} onClick={() => setResultPage(value => value + 1)}>下一页结果</button></div>}</> : <p>填写分组并开始后，这里显示实际进度、产物数量和费用。生成完成仍需检查图片后再确认交付。</p>}</section>
  </div></StudioDrawer>;
}
