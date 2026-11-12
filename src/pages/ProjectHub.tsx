import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, FileCheck2, FileText, FolderOpen, History, Pencil, RefreshCw } from 'lucide-react';
import type { PageProps } from '../types';
import type { ArtifactMetadata } from '../live-types';
import { KIND_LABEL, money } from '../data';
import { useBusinessWorkspace } from '../hooks/useBusinessWorkspace';
import { businessReceivables } from '../lib/business-receivables';
import { projectCurrentFiles, isProjectDeliverable } from '../lib/project-file-roles';
import { projectCardStatusLabel } from '../lib/project-status';
import { projectImageContent } from '../lib/image-studio';
import { readProjectQuote } from '../lib/project-quotes';
import { focusBusinessView } from '../lib/business-view';
import { CostTotal } from '../components/CostAmount';
import { summarizeCosts } from '../lib/cost-display';
import { CustomerOrderLink } from '../components/CustomerOrderLink';
import { ClientProofingDialog } from '../components/ClientProofingDialog';
import { RememberedDetails } from '../components/RememberedDetails';
import { ProjectTemplateActions } from '../components/ProjectTemplateActions';
import { Select } from '../components/Select';
import './project-hub.css';

export function ProjectHub(props: PageProps) {
  const project = props.activeProject, business = useBusinessWorkspace(props.workspaceId);
  const [files, setFiles] = useState<ArtifactMetadata[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0), [orderId, setOrderId] = useState(''), [proofing, setProofing] = useState(false);
  const runner = useRef(props.workflowRunner); runner.current = props.workflowRunner;
  const orders = useMemo(() => (business.state?.orders || []).filter(order => order.sourceProjectId === project.id || order.projectIds.includes(project.id)), [business.state, project.id]);
  const order = orders.find(item => item.id === orderId) || orders[0];
  useEffect(() => { setOrderId(''); setProofing(false); }, [props.workspaceId, project.id]);
  useEffect(() => {
    let alive = true; setLoading(true); setError(''); setFiles([]);
    const list = runner.current.listProjectArtifacts;
    if (!list) { setLoading(false); setError('当前后台不支持读取项目文件，请更新桌面应用。'); return; }
    void list(project.id).then(result => { if (alive) setFiles(result.filter(file => file.projectId === project.id)); }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : '项目文件暂未读取，原文件保留。'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [project.id, props.workspaceId, props.workflowRunner.inventoryRevision, reload]);
  const generatedImageIds = useMemo(() => {
    if (project.kind !== 'image') return [];
    const images = projectImageContent(props.workflowRunner.runs, project.id, props.workflowRunner.trashedArtifacts).images, runId = images[0]?.runId;
    return (runId ? images.filter(file => file.runId === runId) : images.slice(0, 1)).map(file => file.id);
  }, [project.kind, project.id, props.workflowRunner.runs, props.workflowRunner.trashedArtifacts]);
  const adoptedIds = order?.outputIds || [], currentFiles = useMemo(() => projectCurrentFiles(files, project.kind, adoptedIds, project.localOutputArtifactIds?.length ? project.localOutputArtifactIds : generatedImageIds), [files, project.kind, adoptedIds, project.localOutputArtifactIds, generatedImageIds]);
  const currentIds = new Set(currentFiles.map(file => file.id)), historical = files.filter(file => isProjectDeliverable(file, project.kind) && !currentIds.has(file.id));
  const entries = props.ledger.filter(entry => entry.projectId === project.id && entry.billingMode === 'live'), activeRun = props.workflowRunner.runs.find(run => run.projectId === project.id && ['running', 'paused', 'waiting-review'].includes(run.status));
  const openFeedback = business.state?.feedback.filter(item => item.orderId === order?.id && item.status !== 'confirmed') || [];
  const receivables = business.state && order ? businessReceivables(business.state, order.id) : undefined;
  const brand = business.state?.brands.find(item => item.id === order?.brandId), quote = readProjectQuote(localStorage, props.workspaceId, project.id);
  const openEditor = () => props.navigate(project.kind === 'image' ? 'images' : 'documents', project.id);
  function openOrder(tab?: 'feedback' | 'finance') { if (order && props.onOpenBusiness) { if (tab) focusBusinessView(props.workspaceId, order.id, tab); props.onOpenBusiness(order.recipe, order.id); } }
  if (project.workspaceId !== props.workspaceId || project.trashedAt || project.purgedAt) return <section className="project-hub"><h1>项目暂不可用</h1><button type="button" className="btn btn-secondary" onClick={() => props.navigate('projects')}>返回项目列表</button></section>;
  return <div className="project-hub"><button type="button" className="text-button" onClick={() => props.navigate('projects')}><ArrowLeft size={16} />全部项目</button><header className="project-hub-heading"><div><span className="project-hub-eyebrow">{KIND_LABEL[project.kind]} · {projectCardStatusLabel(project, props.workflowRunner.runs)}</span><h1>{project.name}</h1><p>{project.description || '作品、客户反馈和交付文件，集中在这里。'}</p></div><button type="button" className="btn btn-primary" onClick={openEditor}><Pencil size={17} />{currentFiles.length ? '继续编辑' : '打开工作台'}</button></header>
    <section className="project-hub-next" aria-label="下一步"><div><strong>{activeRun?.status === 'running' ? '正在制作，进度和费用会自动保存' : openFeedback.length ? `有 ${openFeedback.length} 轮客户反馈待处理` : !currentFiles.length ? '先完成制作，正式成品会显示在这里' : project.status === 'complete' ? '当前版本已完成交付' : '成品已就绪，下一步核对和交付'}</strong><p>{openFeedback.length ? '从制作单打开对应位置，修改、导出后可直接完成本轮。' : currentFiles.length ? '编辑稿、当前采用成品和历史版本分别保留，避免交错版本。' : '在工作台描述需求、选择素材并生成，也可直接编辑内容。'}</p></div><button type="button" className="btn btn-secondary" onClick={() => { if (openFeedback.length && order) openOrder('feedback'); else openEditor(); }}>{openFeedback.length && order ? '处理客户反馈' : activeRun ? '查看进度' : currentFiles.length ? '核对与交付' : '开始制作'}<ArrowRight size={16} /></button></section>
    <div className="project-hub-grid"><section className="project-hub-card"><header><div><h2>{order ? '当前采用成品' : '最新导出成品'}</h2><p>{order ? '此制作单实际采用的文件' : '关联制作单后，可明确客户采用的版本'}</p></div><button type="button" className="btn-icon" aria-label="刷新项目文件" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={17} /></button></header>{loading ? <p role="status">正在读取项目文件…</p> : error ? <p role="alert" className="project-hub-error">{error}</p> : currentFiles.length ? <ul className="project-hub-files">{currentFiles.slice(0, 12).map(file => <li key={file.id}><FileText size={20} /><div><strong>{file.name}</strong><span>{Math.ceil(file.bytes / 1024)} KB · {order ? '当前采用成品' : '已导出，尚未指定客户采用'}</span></div><button type="button" className="btn-icon" aria-label={`另存 ${file.name}`} onClick={() => { void props.workflowRunner.saveArtifact(file.id); }}><Download size={17} /></button></li>)}</ul> : <p className="project-hub-empty">暂无当前成品。导出正式文件后会显示在这里；原始素材不会当作成品。</p>}<footer><button type="button" className="btn btn-secondary" onClick={openEditor}><FolderOpen size={16} />打开编辑器</button>{currentFiles.length > 0 && <button type="button" className="btn btn-secondary" onClick={() => setProofing(true)}><FileCheck2 size={16} />发客户校样</button>}</footer></section>
    <section className="project-hub-card"><header><div><h2>制作与客户</h2><p>{brand?.name || (order ? '独立制作单' : '尚未关联客户制作单')}</p></div></header>{orders.length > 1 && <Select aria-label="项目关联制作单" value={order?.id || ''} onValueChange={setOrderId} options={orders.map(item => ({ value: item.id, label: item.name }))} />}{order ? <><strong className="project-hub-order-name">{order.name}</strong><dl className="project-hub-facts"><div><dt>客户反馈</dt><dd>{openFeedback.length ? `${openFeedback.length} 轮待处理` : '暂无待处理反馈'}</dd></div><div><dt>交付记录</dt><dd>{order.deliveries?.length || 0} 次</dd></div><div><dt>约定交期</dt><dd>{order.deadline || '未设置'}</dd></div></dl><button type="button" className="btn btn-secondary" onClick={() => openOrder()}>打开制作单<ArrowRight size={15} /></button></> : <><p>关联后集中处理采用版本、校样、返修和交付。</p><CustomerOrderLink props={props} project={project} artifactIds={currentFiles.map(file => file.id)} label="关联或新建制作单" onLinked={() => { void business.refresh(); }} /></>}</section>
    <section className="project-hub-card"><header><div><h2>费用与报价</h2><p>调用费用保留；编辑、撤销不会退回已发生金额。</p></div></header><div className="project-hub-cost"><span>本项目真实调用费用</span>{entries.length ? <CostTotal summary={summarizeCosts(entries)} /> : <strong>暂无真实调用记录</strong>}</div>{receivables?.hasPlan && <dl className="project-hub-facts"><div><dt>约定收款</dt><dd>¥{money(receivables.agreedCents)}</dd></div><div><dt>尚未收回</dt><dd>¥{money(receivables.remainingCents)}</dd></div>{receivables.dueCents > 0 && <div><dt>已到期应收</dt><dd>¥{money(receivables.dueCents)}</dd></div>}</dl>}<footer><button type="button" className="btn btn-secondary" onClick={() => props.navigate('finance', project.id)}>{quote.draft ? '继续报价草稿' : '制作客户报价'}<ArrowRight size={15} /></button>{order && <button type="button" className="text-button" onClick={() => openOrder('finance')}>查看收款与交付</button>}</footer>{quote.error && <p className="project-hub-error">{quote.error}</p>}</section></div>
    <RememberedDetails className="project-hub-details" rememberKey={`project-hub:${props.workspaceId}:${project.id}:history`}><summary><History size={17} />历史版本与更多操作<span>{historical.length} 份历史成品</span></summary><p>编辑器里的“正在编辑”是当前稿件；采用新成品不会删除这些旧文件。</p>{historical.length > 0 && <ul className="project-hub-files">{historical.slice(0, 24).map(file => <li key={file.id}><FileText size={18} /><div><strong>{file.name}</strong><span>历史版本 · {new Date(file.createdAt).toLocaleString('zh-CN')}</span></div><button type="button" className="text-button" onClick={() => { void props.workflowRunner.saveArtifact(file.id); }}>另存</button></li>)}</ul>}<ProjectTemplateActions props={props} project={project} artifactId={currentFiles[0]?.id} /><button type="button" className="text-button" onClick={openEditor}>在编辑器查看所有项目文件</button></RememberedDetails>
    {business.error && <p className="project-hub-error" role="alert">{business.error}<button type="button" className="text-button" onClick={() => { void business.refresh(); }}>重新读取制作单</button></p>}{proofing && <ClientProofingDialog workspaceId={props.workspaceId} projectId={project.id} orderId={order?.id} files={currentFiles} title={`${project.name}校样`.slice(0, 120)} onClose={() => setProofing(false)} onImported={() => { void business.refresh(); props.notify('客户意见已导入，可从本项目处理返修。'); }} />}
  </div>;
}
