import { useStudioMonthClock } from '../hooks/useStudioMonthClock';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, CircleDollarSign, Clock3, FileCheck2, FileSpreadsheet, FileText, FolderOpen, Image, Layers3, Plus, Presentation, Sparkles, WandSparkles } from 'lucide-react';
import { ProjectCard } from '../components/ProjectCard';
import { budgetLabel, budgetPercent } from '../data';
import { CostAmount, CostTotal } from '../components/CostAmount';
import { amountToQuoteCents, summarizeCosts } from '../lib/cost-display';
import type { PageProps, ProjectKind } from '../types';
import { monthlyEntries, projectTimeLabel, recentProjects } from '../lib/studio-time';
import { recentActivity } from '../lib/project-browser';
import './overview-ux.css';

export function Overview(props: PageProps) {
  const { projects, ledger, preferences, navigate, onCreateProject, onUpdateProject } = props;
  const [filter, setFilter] = useState('all');
  const recentSection = useRef<HTMLElement>(null);
  useEffect(() => { setFilter('all'); }, [props.workspaceId]);
  const realLedger = useMemo(() => ledger.filter(item => item.billingMode === 'live'), [ledger]);
  const monthlyLimit = preferences.monthlyBudget == null ? undefined : Math.round(preferences.monthlyBudget * 100);
  const liveCost = useMemo(() => summarizeCosts(realLedger), [realLedger]);
  const monthClock = useStudioMonthClock();
  const monthly = useMemo(() => monthlyEntries(realLedger, monthClock), [realLedger, monthClock]);
  const monthCost = useMemo(() => summarizeCosts(monthly.current), [monthly]);
  const monthCents = amountToQuoteCents(monthCost.cnyAmount);
  const total = monthCents ?? 0;
  const budgetIncomplete = monthCents === undefined || monthCost.pendingCount > 0 || monthCost.missingFxCount > 0 || monthly.unassigned.length > 0;
  const reviewing = projects.filter(item => item.status === 'review').length;
  const ordered = useMemo(() => recentProjects(projects), [projects]);
  const recent = ordered.filter(item => filter === 'all' || (filter === 'documents' ? item.kind !== 'image' : filter === 'images' ? item.kind === 'image' : item.status === filter)).slice(0, 6);
  const activity = useMemo(() => recentActivity(ledger), [ledger]);
  function showRecent(value: string) { setFilter(value); requestAnimationFrame(() => recentSection.current?.scrollIntoView({ block: 'start', behavior: 'auto' })); }
  function openRecentProject(id: string) { const project = projects.find(item => item.id === id); navigate(project ? project.kind === 'image' ? 'images' : 'documents' : 'projects', project?.id); }
  const starters: { kind: ProjectKind; icon: typeof Presentation; label: string; color: string }[] = [
    { kind: 'ppt', icon: Presentation, label: '演示文稿', color: 'orange' },
    { kind: 'word', icon: FileText, label: 'Word 文档', color: 'blue' },
    { kind: 'excel', icon: FileSpreadsheet, label: 'Excel 表格', color: 'green' },
    { kind: 'image', icon: Image, label: '图像创作', color: 'purple' },
  ];
  return <div className="overview-page page-enter">
    <div className="page-heading overview-heading"><div><div className="page-kicker"><span className="tiny-dot" /> 你的个人创作空间</div><h1 className="page-title">欢迎回来，开始一份好作品<span className="greeting-dot">。</span></h1><p className="page-description">从想法到交付，把每一步都安排得有条不紊。</p></div><div className="overview-heading-actions">{ordered[0] && <button className="btn btn-secondary" onClick={() => openRecentProject(ordered[0].id)}><ArrowRight size={15} />继续上次项目</button>}<div className="date-chip">{new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric' })} <span>{new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'long' })}</span></div></div></div>
    <div className="overview-hero-row">
      <section className="hero-create">
        <div className="hero-copy"><div className="hero-eyebrow"><Sparkles size={14} /> 让创作，更从容</div><h2>你的下一份作品，<br />从这里开始。</h2><p>写下需求，选择形式。让 AI 协助制作，<br />把判断与灵感留给你。</p></div>
        <div className="hero-art" aria-hidden="true"><div className="art-back-card"><span /><i /><i /><i /></div><div className="art-front-card"><div className="art-grid-dot">✦</div><span>CREATE<br />WITH CLARITY.</span><div className="art-columns"><i /><i /><i /><i /><i /></div></div><div className="art-check"><Check size={19} /></div><div className="art-float-star">✧</div><div className="art-orbit" /></div>
        <div className="quick-starts">{starters.map(item => <button key={item.kind} onClick={() => onCreateProject(item.kind)}><span className={`quick-icon icon-${item.color}`}><item.icon size={19} /></span><span>{item.label}</span><Plus size={14} /></button>)}</div>
      </section>
      <section className="panel flow-intro"><div className="section-eyebrow"><span className="icon-purple small-icon"><Layers3 size={15} /></span> 一条更清晰的工作流</div><h3>好交付，源于每一步的确定。</h3><div className="flow-step"><span className="flow-number">01</span><div><strong>把想法变成初稿</strong><p>需求、模板与素材，一处开始</p></div><WandSparkles size={16} /></div><div className="flow-step"><span className="flow-number">02</span><div><strong>预览、检查、再精修</strong><p>每次修改留下版本与成本</p></div><FileCheck2 size={16} /></div><div className="flow-step"><span className="flow-number">03</span><div><strong>核算清楚，从容交付</strong><p>制作成本与建议报价，看得见</p></div><CircleDollarSign size={16} /></div><button className="text-button" onClick={() => navigate('activity')}>查看任务中心 <ArrowRight size={14} /></button></section>
    </div>
    <div className="overview-metrics">
      {[{ icon: FolderOpen, action: 'projects', label: '全部项目', value: `${projects.length}`, note: '灵感与作品，各在其位', color: 'purple' }, { icon: FileCheck2, action: 'review', label: '待交付检查', value: `${reviewing}`, note: reviewing ? '确认细节，再向前一步' : '当前没有待检查项目', color: 'orange' }, { icon: CircleDollarSign, action: 'finance', label: '调用成本', value: <CostTotal summary={liveCost} />, note: '原币与人民币换算分别保留', color: 'green' }, { icon: Clock3, action: 'complete', label: '已完成项目', value: `${projects.filter(item => item.status === 'complete').length}`, note: '每一份完成，都值得记录', color: 'blue' }].map(item => <button className={`metric-card ${filter === item.action ? 'is-active' : ''}`} key={item.label} aria-pressed={['review', 'complete'].includes(item.action) ? filter === item.action : undefined} onClick={() => item.action === 'review' || item.action === 'complete' ? showRecent(item.action) : navigate(item.action === 'finance' ? 'finance' : 'projects')}><div><span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small></div><span className={`metric-icon icon-${item.color}`}><item.icon size={21} /></span></button>)}
    </div>
    <div className="overview-content-row"><section ref={recentSection} className="recent-projects" aria-label="最近项目列表"><div className="section-heading"><div><h2>最近项目 <span>{projects.length}</span></h2><p>继续打磨，或者开启一个新想法。</p></div><button className="text-button" onClick={() => navigate('projects')}>查看全部 <ArrowUpRight size={14} /></button></div><div className="recent-tabs"><div className="tabs">{[['all', '全部'], ['documents', '文档'], ['images', '图像'], ['review', '待交付检查'], ['complete', '已完成']].map(([value, label]) => <button className={filter === value ? 'active' : ''} key={value} onClick={() => setFilter(value)}>{label}</button>)}</div><span className="sort-note">按最近更新排序</span></div><div className="project-grid">{recent.map(project => <ProjectCard project={project} ledger={ledger} runner={props.workflowRunner} key={project.id} onOpen={() => navigate(project.kind === 'image' ? 'images' : 'documents', project.id)} onFavorite={() => onUpdateProject(project.id, { favorite: !project.favorite })} />)}</div>{!recent.length && <div className="overview-project-empty panel"><FolderOpen size={28} /><h3>{filter === 'review' ? '没有待交付检查的项目' : filter === 'complete' ? '还没有已完成项目' : filter === 'all' ? '从第一份作品开始' : '此类型暂时没有项目'}</h3><p>{filter === 'complete' ? '生成成品后完成检查并确认交付，就会记录在这里。' : filter === 'review' ? '有新成品需要验收时，会出现在这里。' : '可以切回全部项目，或创建一份新作品。'}</p><div>{filter !== 'all' && <button className="btn btn-secondary" onClick={() => setFilter('all')}>查看全部最近项目</button>}<button className="btn btn-primary" onClick={() => onCreateProject()}>新建项目</button></div></div>}</section>
      <aside className="overview-aside"><section className="panel budget-panel"><div className="section-heading compact"><h3>{monthly.label}调用成本</h3><span className="pill soft-purple">真实账本</span></div><p className="muted">本月已归集 · 北京时间</p><div className="budget-number"><CostTotal summary={monthCost} /> <span>/ {budgetLabel(monthlyLimit)}</span></div>{monthlyLimit != null && <div className="progress-track"><i style={{ width: `${budgetPercent(total, monthlyLimit)}%` }} /></div>}<div className="budget-line"><span>{monthly.unassigned.length ? `${monthly.unassigned.length} 条记录时间不明确，未归入月份` : '修改与重试按实际发生时间累计'}</span><strong>{monthlyLimit == null ? '未设上限' : budgetIncomplete ? '暂不能确认' : `${Math.round(budgetPercent(total, monthlyLimit) || 0)}%`}</strong></div><button className="btn btn-secondary full-width" onClick={() => navigate('finance')}>查看成本与报价 <ArrowRight size={14} /></button></section><section className="panel recent-activity-panel"><div className="section-heading compact"><h3>最近动态</h3><button className="btn-icon" aria-label="查看全部动态" onClick={() => navigate('activity')}><ArrowUpRight size={16} /></button></div><div className="activity-timeline">{activity.map((item, index) => <button className="timeline-item" key={item.id} onClick={() => openRecentProject(item.projectId)}><span className={`timeline-dot dot-${index === 0 ? 'purple' : index === 1 ? 'green' : 'orange'}`} /><div><strong>{item.projectName}</strong><p>{item.action} · <span>{item.billingMode === 'live' ? '真实 ' : '模拟 '}<CostAmount entry={item} /></span></p><small>{projectTimeLabel(item.time)}</small></div></button>)}{!activity.length && <p className="overview-activity-empty">还没有模型调用记录。生成或精修后，进度、结果和费用会出现在任务中心。</p>}</div></section><div className="gentle-note"><span>✦</span><div><strong>先预览，再交付。</strong><p>点击生成后自动检查并执行，调用花费按项目记录；演示数据单独标明。</p></div></div></aside></div>
  </div>;
}
