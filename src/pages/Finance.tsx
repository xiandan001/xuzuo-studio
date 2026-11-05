import { RememberedDetails } from '../components/RememberedDetails';
import { useRememberedString } from '../hooks/useRememberedString';
import { downloadFile } from '../lib/files';
import { ModalPortal } from '../components/ModalPortal';
import { hasManagedDialog } from '../lib/dialog-stack';
import { useStudioMonthClock } from '../hooks/useStudioMonthClock';
import { Select } from '../components/Select';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowDownToLine, ArrowRight, BadgeCheck, Calculator, Check, CircleDollarSign, Coins, Copy, Download, FolderOpen, Info, Layers3, LoaderCircle, Pencil, RotateCcw, Save, Search, ShieldCheck, Wallet, X } from 'lucide-react';
import { money, budgetPercent } from '../data';
import { CostAmount, CostTotal } from '../components/CostAmount';
import { CostBreakdown } from '../components/CostBreakdown';
import { amountToQuoteCents, costPrimary, displayCost, summarizeCosts } from '../lib/cost-display';
import type { LedgerEntry, PageProps } from '../types';
import type { BreakEvenResult, QuoteResult } from '../lib/pricing';
import { calculateProjectQuote, customerQuoteText } from '../lib/quote-calculator';
import { financeMonth, financeProjection } from '../lib/finance-projection';
import { unassignedQuotes } from '../lib/project-quotes';
import type { ProjectQuote, QuoteFields } from '../lib/project-quotes';
import { useProjectQuote } from '../hooks/useProjectQuote';
import { UnassignedQuoteDrafts } from '../components/UnassignedQuoteDrafts';
import { CustomerQuotePanel } from '../components/CustomerQuotePanel';
import './finance.css';

interface Calculation {
  error: string;
  laborCents?: number;
  otherCents?: number;
  reserveCents?: number;
  remainingCents?: number;
  feeBasisPoints?: number;
  costCents?: number;
  quote?: QuoteResult;
  repeat?: BreakEvenResult;
}
const initialFields = (props: PageProps): QuoteFields => ({ minutes: '0', rate: String(props.preferences.hourlyRate), remaining: '0', other: '0', reserve: '0', fee: String(props.preferences.channelFeePercent), profit: String(props.preferences.targetProfit), price: '19.90', variable: '0' });

function decimalToHundredths(value: string, label: string): number {
  if (!/^\d+(?:\.\d{0,2})?$/.test(value.trim())) throw new Error(`请填写有效的${label}，最多保留两位小数`);
  const [whole, fraction = ''] = value.trim().split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > 1_000_000_000) throw new Error(`${label}超出可计算范围`);
  return result;
}

function csvCell(value: string): string {
  const safeValue = /^\s*[=+@-]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

function AmountField({ label, value, unit, hint, onChange }: { label: string; value: string; unit: string; hint?: string; onChange: (value: string) => void }) {
  return <label className="fin-input-label"><span>{label}</span><span className="fin-number-wrap"><input inputMode="decimal" maxLength={64} value={value} onChange={event => onChange(event.target.value)} aria-label={label} /><span>{unit}</span></span>{hint && <small>{hint}</small>}</label>;
}

function EntryIcon({ entry }: { entry: LedgerEntry }) {
  return <span className={`fin-entry-icon ${entry.action === '初次生成' ? 'fin-entry-first' : 'fin-entry-edit'}`}>
    {entry.action === '重新生成' ? <RotateCcw size={17} /> : entry.action === 'AI 复核' ? <ShieldCheck size={17} /> : entry.action === 'AI 精修' ? <Layers3 size={17} /> : <Coins size={17} />}
  </span>;
}

type BillingScope = 'live' | 'simulation' | 'all';
const STATUS_LABELS: Record<LedgerEntry['status'], string> = { complete: '已完成', processing: '处理中', cancelled: '已取消', failed: '失败' };
const isLive = (entry: LedgerEntry) => entry.billingMode === 'live';
const pendingCost = (entry: LedgerEntry) => isLive(entry) && displayCost(entry).pending;
const unavailableCny = (entry: LedgerEntry) => isLive(entry) && (displayCost(entry).pending || displayCost(entry).missingFx);
const costLabel = (entry: LedgerEntry) => !isLive(entry) ? '模拟费用' : entry.queryOnly ? '仅恢复原任务查询' : entry.costState === 'manual' ? '人工账单校正' : entry.costState === 'not-incurred' ? '未发请求' : pendingCost(entry) ? entry.status === 'processing' ? '等待服务商返回用量' : '计费依据待补齐' : displayCost(entry).legacy ? '历史分值记录' : displayCost(entry).missingFx ? '原币已自动计算' : '已按用量自动计算';
const amountLabel = (entry: LedgerEntry) => costPrimary(entry);
function usageLabel(entry: LedgerEntry) {
  const usage = entry.usage;
  if (!usage) return '';
  return [usage.inputTokens !== undefined ? `输入 ${usage.inputTokens.toLocaleString('zh-CN')} Tokens` : '', usage.outputTokens !== undefined ? `输出 ${usage.outputTokens.toLocaleString('zh-CN')} Tokens` : '', usage.images !== undefined ? `${usage.images} 张` : '', usage.seconds !== undefined ? `${usage.seconds} 秒` : ''].filter(Boolean).join(' · ');
}

function ReconcileDialog({ entry, available, onClose, onSave }: { entry: LedgerEntry; available: boolean; onClose: () => void; onSave: (cents: number) => Promise<void> }) {
  const [amount, setAmount] = useState(entry.costState === 'manual' ? money(entry.costCents) : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(saving); busy.current = saving;
  const close = useRef(onClose); close.current = onClose;
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLInputElement>('input')?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (hasManagedDialog()) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy.current) close.current(); return; }
      if (event.key !== 'Tab') return;
      const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') || [])].filter(element => element.getClientRects().length > 0);
      const first = elements[0]; const last = elements[elements.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', keydown, true); previous?.focus(); };
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || !available) return;
    let cents;
    try { cents = decimalToHundredths(amount, '人民币费用'); if (cents > 100_000_000) throw new Error('单条核对费用最多为 ¥1,000,000.00。'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '请填写有效金额。'); return; }
    setSaving(true); setError('');
    try { await onSave(cents); }
    catch { setError('费用核对未保存。请确认本次调用已结束，并检查桌面运行状态后重试。'); }
    finally { setSaving(false); }
  }
  return <ModalPortal onClose={onClose} busy={saving}><div className="fin-reconcile-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}><section ref={panel} className="fin-reconcile-dialog" role="dialog" aria-modal="true" aria-label="人工账单校正"><header><span><Pencil size={21} /></span><div><h2>人工账单校正</h2><p>可选的高级操作，用于按最终账单校正金额。</p></div><button className="btn-icon" disabled={saving} aria-label="关闭费用核对" onClick={onClose}><X size={19} /></button></header><form id="fin-reconcile-form" onSubmit={event => { void save(event); }}><div className="fin-reconcile-context"><strong>{entry.projectName}</strong><span>{entry.action} · {entry.model}</span><small>当前费用：{amountLabel(entry)} · {costLabel(entry)}</small>{entry.usage?.providerRequestId && <code title={entry.usage.providerRequestId}>请求 ID：{entry.usage.providerRequestId}</code>}</div><label className="fin-input-label"><span>最终账单金额（CNY）</span><span className="fin-number-wrap"><input aria-label="账单校正金额（元）" inputMode="decimal" maxLength={16} placeholder="例如 1.28，可填写 0" value={amount} onChange={event => { setAmount(event.target.value); setError(''); }} disabled={saving || !available} /><span>元</span></span><small>最多两位小数；这是本次调用费用，不是售价、账户余额或项目预算。</small></label><div className="fin-reconcile-note"><ShieldCheck size={16} /><p>自动费用明细通常已足够查看成本。只有最终结算、优惠或人工调整与自动结果不同时才使用此项；美元金额按你的实际结算汇率折算。保存会保留原自动计算凭据和修订记录。</p></div>{!available && <div className="fin-error" role="alert"><Info size={15} />请在新版 Windows 桌面应用中核对真实费用。</div>}{error && <div className="fin-error" role="alert"><Info size={15} />{error}</div>}</form><footer><button className="btn btn-secondary" disabled={saving} onClick={onClose}>取消</button><button className="btn btn-primary" type="submit" form="fin-reconcile-form" disabled={saving || !available}>{saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}{saving ? '正在保存…' : '保存校正金额'}</button></footer></section></div></ModalPortal>;
}

export function Finance(props: PageProps) {
  const { projects, ledger, preferences, activeProject, notify, workspaceId, workflowRunner } = props;
  const [tab, setTab] = useState<'ledger' | 'quote'>('ledger');
  const [billingScope, setBillingScope] = useState<BillingScope>('live');
  const [query, setQuery] = useState('');
  const [action, setAction] = useState('all');
  const [ledgerProject, setLedgerProject] = useState('all');
  const [ledgerPage, setLedgerPage] = useState(0);
  const [selectedId, setSelectedId] = useState(activeProject.id);
  const [expandedEntry, setExpandedEntry] = useRememberedString(`workspace:${workspaceId}:finance-entry`, '');
  const [reconcileId, setReconcileId] = useState<string | null>(null);
  const [legacyQuotes] = useState(() => typeof window === 'undefined' ? [] : unassignedQuotes(() => localStorage, workspaceId));

  useEffect(() => { setSelectedId(activeProject.id); }, [activeProject.id]);
  useEffect(() => { setLedgerPage(0); }, [billingScope, query, action, ledgerProject]);
  useEffect(() => { setLedgerProject('all'); setQuery(''); setAction('all'); setLedgerPage(0); setReconcileId(null); }, [workspaceId]);

  const projection = financeProjection(ledger);
  const realEntries = projection.real;
  const simulationEntries = projection.simulation;
  const summaryEntries = billingScope === 'simulation' ? simulationEntries : realEntries;
  const summary = billingScope === 'simulation' ? projection.simulationSummary : projection.realSummary;
  const monthClock = useStudioMonthClock();
  const monthView = financeMonth(ledger, monthClock);
  const monthly = monthView.entries;
  const monthSummary = monthView.summary;
  const monthCents = amountToQuoteCents(monthSummary.cnyAmount);
  const total = monthCents ?? 0;
  const editSummary = billingScope === 'simulation' ? projection.simulationEdits : projection.realEdits;
  const simulationSummary = projection.simulationSummary;
  const budget = preferences.monthlyBudget == null ? undefined : Math.max(0, Math.round(preferences.monthlyBudget * 100));
  const budgetIncomplete = monthCents === undefined || monthSummary.pendingCount > 0 || monthSummary.missingFxCount > 0 || monthly.unassigned.length > 0;
  const remainingBudget = budget == null ? undefined : Math.max(0, budget - total);
  const selectedProject = projects.find(project => project.id === selectedId) ?? projects[0];
  const quoteDraft = useProjectQuote(workspaceId, selectedProject?.id || '', initialFields(props));
  const quoteScope = quoteDraft.scope;
  const shownScope = tab === 'quote' ? quoteScope : billingScope;
  const { fields, mode: quoteMode, saved, updateField, setMode: setQuoteMode } = quoteDraft;
  const projectEntries = useMemo(() => (quoteScope === 'live' ? realEntries : simulationEntries).filter(entry => entry.projectId === selectedProject?.id), [quoteScope, realEntries, simulationEntries, selectedProject?.id]);
  const projectSummary = useMemo(() => summarizeCosts(projectEntries), [projectEntries]);
  const projectApiCost = projectSummary.quoteCents ?? 0;
  const projectPendingCount = projectEntries.filter(unavailableCny).length;
  const filtered = useMemo(() => !query.trim() && ledgerProject === 'all' && action === 'all' ? billingScope === 'all' ? ledger : billingScope === 'live' ? realEntries : simulationEntries : ledger.filter(entry => (billingScope === 'all' || (billingScope === 'live' ? isLive(entry) : !isLive(entry))) && (ledgerProject === 'all' || entry.projectId === ledgerProject) && (action === 'all' || entry.action === action) && `${entry.projectName} ${entry.model} ${entry.action}`.toLowerCase().includes(query.trim().toLowerCase())), [ledger, realEntries, simulationEntries, billingScope, action, query, ledgerProject]);
  const ledgerPages = Math.max(1, Math.ceil(filtered.length / 50));
  const currentLedgerPage = Math.min(ledgerPage, ledgerPages - 1);
  const pageEntries = filtered.slice(currentLedgerPage * 50, (currentLedgerPage + 1) * 50);
  const filteredRealSummary = useMemo(() => filtered === realEntries || filtered === ledger ? projection.realSummary : summarizeCosts(filtered.filter(isLive)), [filtered, realEntries, ledger, projection]);
  const filteredSimulationSummary = useMemo(() => filtered === simulationEntries || filtered === ledger ? projection.simulationSummary : summarizeCosts(filtered.filter(entry => !isLive(entry))), [filtered, simulationEntries, ledger, projection]);
  const reconcileEntry = ledger.find(entry => entry.id === reconcileId && isLive(entry));

  useEffect(() => { quoteDraft.markDirty(); }, [projectApiCost, projectSummary.cnyAmount, projectPendingCount, quoteMode, quoteScope, selectedId]);

  const calculation = useMemo<Calculation>(() => {
    try {
      if (!selectedProject) throw new Error('当前工作区没有可报价项目，请先新建项目。');
      if (projectSummary.pendingCount) throw new Error(`此项目有 ${projectSummary.pendingCount} 笔费用缺少完整计费用量或适用规则，暂不能生成完整报价。可先查看费用明细。`);
      if (projectSummary.missingFxCount) throw new Error('美元费用已经计算，暂缺人民币参考汇率；汇率换算完成后即可计算人民币报价。');
      if (projectSummary.quoteCents === undefined) throw new Error('费用金额超出当前报价计算范围。');
      return { error: '', ...calculateProjectQuote(fields, projectApiCost, quoteMode) };
    } catch (error) { return { error: error instanceof Error ? error.message : '请检查成本输入' }; }
  }, [fields, projectApiCost, projectPendingCount, projectSummary.pendingCount, projectSummary.missingFxCount, projectSummary.quoteCents, quoteMode, selectedProject]);

  function snapshot(): ProjectQuote {
    return { type: 'xuzuo-project-quote', version: 1, simulated: quoteScope === 'simulation', scope: quoteScope, workspaceId, projectId: selectedProject?.id || '', project: selectedProject?.name, mode: quoteMode,
      apiCostCents: projectPendingCount ? null : projectApiCost, apiCostCnyAmount: projectSummary.cnyAmount, nativeApiCosts: { USD: projectSummary.usdAmount, CNY: projectSummary.nativeCnyAmount },
      quoteRounding: 'API 费用精确相加后，仅为人民币报价一次向上取整到分。', hasPendingCosts: projectPendingCount > 0, pendingCostEntryIds: projectEntries.filter(unavailableCny).map(entry => entry.id), legacyCostEntryIds: projectEntries.filter(entry => displayCost(entry).legacy).map(entry => entry.id),
      inputs: fields, customer: quoteDraft.customer, calculation, disclaimer: quoteScope === 'simulation' ? '此报价仅使用模拟费用，不作为真实业务报价或盈利依据。' : 'API费用按实际计费用量和保存费率计算，人民币采用参考汇率，人工校正及旧版历史分值记录会明确标识。最终结算可能不同。报价基于输入假设，不保证成交或不亏损。', savedAt: new Date().toISOString() };
  }
  function restoreQuote() {
    try {
      const draft = quoteDraft.restore();
      if (!draft) { notify('当前项目还没有已保存报价，其他项目的草稿保持独立。', 'info'); return; }
      setBillingScope(draft.scope);
      notify(`已读取“${selectedProject?.name}”的报价参数，费用按当前台账重新计算。`);
    } catch (error) { notify(error instanceof Error ? error.message : '当前项目报价未能读取，原记录保留。', 'error'); }
  }
  function saveQuote() {
    if (calculation.error) { notify(calculation.error, 'error'); return; }
    try { quoteDraft.save(snapshot()); notify(`已保存“${selectedProject?.name}”的独立报价，不覆盖其他项目。`); }
    catch (error) { notify(`保存未完成：${error instanceof Error ? error.message : '本机存储不可用'}；当前参数保留，可导出。`, 'error'); }
  }
  async function exportQuote() {
    if (calculation.error) { notify(calculation.error, 'error'); return; }
    try { const saved = await downloadFile(`序作-${selectedProject?.name ?? '项目'}-${quoteScope === 'simulation' ? '模拟' : '真实费用'}报价.json`, JSON.stringify(snapshot(), null, 2), 'application/json;charset=utf-8');
    if (saved) notify('已导出当前费用范围的报价草稿 JSON'); } catch (error) { notify(error instanceof Error ? error.message : '报价未能导出。', 'error'); }
  }
  async function copyQuote() {
    if (calculation.error || !selectedProject || quoteScope !== 'live' || quoteMode !== 'single') return;
    try { await navigator.clipboard.writeText(customerQuoteText(selectedProject.name, calculation.quote!.recommendedCents)); notify('已复制项目与售价，不包含内部成本和利润。'); }
    catch { notify('暂未复制成功，请重试或导出报价。', 'error'); }
  }
  async function exportLedger() {
    const rows = [['调用编号', '项目', '操作', '模型', '时间', '费用范围', '费用状态', '原币', '原币金额', '人民币金额', '汇率', '汇率日期', '汇率来源', '费率规则', '任务状态', '输入Tokens', '输出Tokens', '图片张数', '供应商请求ID'], ...filtered.map(entry => {
      const value = displayCost(entry), receipt = value.calculation;
      return [entry.id, entry.projectName, entry.action, entry.model, entry.time, isLive(entry) ? '真实' : '模拟', costLabel(entry), value.nativeCurrency || '', value.nativeAmount || '', value.cnyAmount || '', receipt?.fx?.rate || '', receipt?.fx?.date || '', receipt?.fx?.source || '', receipt ? `${receipt.ruleId}@${receipt.ruleVersion}` : '', STATUS_LABELS[entry.status], entry.usage?.inputTokens === undefined ? '' : String(entry.usage.inputTokens), entry.usage?.outputTokens === undefined ? '' : String(entry.usage.outputTokens), entry.usage?.images === undefined ? '' : String(entry.usage.images), entry.usage?.providerRequestId || ''];
    })];
    try { const saved = await downloadFile(`序作-${billingScope === 'all' ? '真实与模拟' : billingScope === 'live' ? '真实' : '模拟'}调用账本.csv`, `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\n')}`, 'text/csv;charset=utf-8');
    if (saved) notify('已导出费用明细；原币与人民币分别保存，缺少费用留空，参考汇率标明来源。'); } catch (error) { notify(error instanceof Error ? error.message : '账本未能导出。', 'error'); }
  }
  function reconcileButton(entry: LedgerEntry) {
    if (!isLive(entry)) return null;
    return <RememberedDetails rememberKey={`ledger:${entry.id}:advanced-billing`} className="fin-advanced-billing"><summary>高级：人工账单校正（可选）</summary><p>正常查看费用无需填写金额。最终结算、优惠或特殊调整与自动计算不同时，可保存人工校正并保留原始记录。</p><button className="btn btn-secondary" disabled={entry.status === 'processing' || !workflowRunner.runtimeStatus.available} onClick={() => setReconcileId(entry.id)}><Pencil size={14} />校正账单金额</button>{!workflowRunner.runtimeStatus.available && <p>请在 Windows 桌面应用中保存账单校正。</p>}</RememberedDetails>;
  }

  return <div className="fin-page">
    <div className="page-heading fin-page-heading"><div><h1 className="page-title">成本与报价</h1><p className="page-description">花了多少，卖多少钱，分开看清楚。</p></div>{tab === 'ledger' && <button className="btn btn-secondary" onClick={exportLedger}><ArrowDownToLine size={16} />导出账本</button>}</div>
    <div className="fin-tabline"><div className="tabs" role="group" aria-label="费用与报价页面"><button aria-pressed={tab === 'ledger'} className={tab === 'ledger' ? 'active' : ''} onClick={() => setTab('ledger')}><Coins size={17} />调用花费</button><button aria-pressed={tab === 'quote'} className={tab === 'quote' ? 'active' : ''} onClick={() => setTab('quote')}><Calculator size={17} />计算售价</button></div><span className="fin-tab-hint">{tab === 'ledger' ? '每次生成、精修和重试自动记账' : '选项目 → 填成本 → 得到售价'}</span></div>
    <div className="fin-billing-scope"><div className="segmented" role="group" aria-label="费用记录范围">{([{ id: 'live', label: '真实费用', count: realEntries.length }, { id: 'simulation', label: '模拟费用', count: simulationEntries.length }, ...(tab === 'ledger' ? [{ id: 'all', label: '全部记录', count: ledger.length }] : [])] as { id: BillingScope; label: string; count: number }[]).map(item => <button key={item.id} aria-pressed={shownScope === item.id} className={shownScope === item.id ? 'active' : ''} onClick={() => { setBillingScope(item.id); if (tab === 'quote' && item.id !== 'all') quoteDraft.setScope(item.id); }}>{item.label}<span>{item.count}</span></button>)}</div><small>{shownScope === 'simulation' ? '仅演示金额，不计入真实报价' : '真实与模拟分别统计'}</small></div>
    {tab === 'ledger' ? <>
      <div className="fin-summary-grid">
        <section className="panel fin-stat-card"><span className="fin-stat-icon"><Wallet size={20} /></span><span className="fin-stat-label">{billingScope === 'simulation' ? '累计模拟费用' : '累计真实调用费用'}</span><strong><CostTotal summary={summary} /></strong><small>{summaryEntries.length} 条记录 · 精确累计</small></section>
        <section className="panel fin-stat-card"><span className="fin-stat-icon"><RotateCcw size={20} /></span><span className="fin-stat-label">精修与重做 · {billingScope === 'simulation' ? '模拟' : '真实'}</span><strong><CostTotal summary={editSummary} /></strong><small>已包含在累计费用中，无需另加</small></section>
        <section className="panel fin-stat-card fin-budget-card"><span className="fin-stat-icon"><CircleDollarSign size={20} /></span><span className="fin-stat-label">{monthly.label}预算参考余额 · 真实</span><strong>{budget == null ? '未设上限' : budgetIncomplete ? '暂不能确认' : `¥ ${money(remainingBudget!)}`}</strong>{budget != null && <div className="fin-budget-track"><i style={{ width: `${budgetPercent(total, budget)}%` }} /></div>}<div className="fin-monthly-budget-detail"><p><span>本月已归集</span><CostTotal summary={monthSummary} /></p>{monthly.unassigned.length > 0 ? <p>{monthly.unassigned.length} 条记录时间不明确，未归入月份</p> : budgetIncomplete && <p>部分费用或人民币换算尚未完成</p>}</div></section>
      </div>
      {billingScope === 'all' && <div className="fin-separated-totals"><span>真实费用 <b><CostTotal summary={summary} /></b></span><span>模拟费用 <b><CostTotal summary={simulationSummary} /></b><small>金额分别统计</small></span></div>}
      <p className="fin-auto-note"><ShieldCheck size={15} />软件按实际用量自动计算，并自动复算历史记录，无需手工填写调用费用。</p>
      <section className="panel fin-ledger-panel">
        <div className="fin-ledger-toolbar"><label className="fin-search"><Search size={17} /><input aria-label="搜索调用账本" placeholder="搜索项目、操作或模型" value={query} onChange={event => setQuery(event.target.value)} /></label><Select aria-label="筛选账本项目" value={ledgerProject} onValueChange={setLedgerProject} options={[{ value: 'all', label: '所有项目' }, ...projects.map(project => ({ value: project.id, label: project.name }))]} /><Select aria-label="筛选操作类型" value={action} onValueChange={setAction} options={[{ value: 'all', label: '全部操作' }, ...['初次生成', 'AI 精修', '重新生成', 'AI 复核'].map(value => ({ value, label: value }))]} /><span className="fin-ledger-count">{filtered.length} 条</span></div>
        <div className="table-wrap"><table className="data-table fin-table"><thead><tr><th>项目与操作</th><th>模型 / 用量</th><th>时间</th><th>状态</th><th className="fin-align-right">调用费用</th><th /></tr></thead><tbody>{pageEntries.map(entry => <Fragment key={entry.id}><tr className={expandedEntry === entry.id ? 'fin-row-selected' : ''}><td><div className="fin-entry-cell"><EntryIcon entry={entry} /><div><strong>{entry.projectName}</strong><span>{entry.action}<em className={`fin-mode-tag ${isLive(entry) ? 'live' : ''}`}>{isLive(entry) ? '真实' : '模拟'}</em></span></div></div></td><td><span className="fin-model-name">{entry.model}</span>{usageLabel(entry) && <small className="fin-usage">{usageLabel(entry)}</small>}</td><td className="muted">{entry.time}</td><td><span className={`fin-status ${entry.status}`}><span />{STATUS_LABELS[entry.status]}</span><small className={`fin-cost-state ${pendingCost(entry) ? 'pending' : ''}`}>{costLabel(entry)}</small></td><td className="fin-align-right"><strong className={`fin-row-amount ${pendingCost(entry) ? 'fin-pending-amount' : ''}`}><CostAmount entry={entry} /></strong><button className="fin-cost-detail-button" aria-expanded={expandedEntry === entry.id} aria-label={`查看费用明细 ${entry.id}`} onClick={() => setExpandedEntry(expandedEntry === entry.id ? '' : entry.id)}>{expandedEntry === entry.id ? '收起费用明细' : '查看费用明细'}</button></td><td><button className="btn-icon" aria-label={`查看项目 ${entry.id}`} onClick={() => props.navigate('projects', entry.projectId)}><ArrowRight size={15} /></button></td></tr>{expandedEntry === entry.id && <tr className="fin-inline-detail"><td colSpan={6}><div className="fin-receipt-detail"><div className="fin-receipt-toolbar"><strong>{entry.projectName} · {entry.action}</strong><button className="btn btn-ghost" onClick={() => props.navigate('projects', entry.projectId)}>打开项目<ArrowRight size={13} /></button></div><CostBreakdown entry={entry} />{reconcileButton(entry)}</div></td></tr>}</Fragment>)}</tbody></table></div>
        {filtered.length === 0 && <div className="empty-state fin-empty"><Search size={28} /><strong>{billingScope === 'live' && realEntries.length === 0 ? '当前工作区还没有真实调用记录' : '没有找到相关记录'}</strong><span>{billingScope === 'live' && realEntries.length === 0 ? '完成一次生成或精修后，这里会自动记账。' : '更换关键词或清除筛选后重试。'}</span><button className="btn btn-secondary" onClick={() => { setQuery(''); setAction('all'); setLedgerProject('all'); if (billingScope === 'live' && realEntries.length === 0) setBillingScope('simulation'); }}>{billingScope === 'live' && realEntries.length === 0 ? '查看模拟记录' : '清除筛选'}</button></div>}
        {ledgerPages > 1 && <nav className="fin-pagination" aria-label="调用账本分页"><button className="btn btn-secondary" disabled={!currentLedgerPage} onClick={() => { setLedgerPage(currentLedgerPage - 1); }}>上一页</button><span>{currentLedgerPage + 1} / {ledgerPages} · 每页 50 条</span><button className="btn btn-secondary" disabled={currentLedgerPage >= ledgerPages - 1} onClick={() => { setLedgerPage(currentLedgerPage + 1); }}>下一页</button></nav>}
        <div className="fin-precise-footer"><span>原币保留精度，人民币按参考汇率换算</span><span>{billingScope !== 'simulation' && <>真实 <strong><CostTotal summary={filteredRealSummary} /></strong></>}{billingScope !== 'live' && <>模拟 <strong><CostTotal summary={filteredSimulationSummary} /></strong></>}</span></div>
      </section>
    </> : !selectedProject ? <section className="panel fin-no-project"><Calculator size={30} /><h2>先有项目，再计算售价</h2><p>报价会自动带入项目的真实调用成本，并独立保存。</p><button className="btn btn-primary" onClick={() => props.onCreateProject()}>新建项目<ArrowRight size={15} /></button></section> : <div className="fin-quote-grid">
      <section className="panel fin-quote-form">
        <div className="fin-quote-step"><span>1</span><div><h2>选择报价项目</h2><p>自动带入已发生的费用，包括精修和重试。</p></div></div>
        <label className="fin-input-label fin-project-select"><span>关联项目</span><Select className="field" aria-label="报价项目" value={selectedProject.id} onValueChange={setSelectedId} options={projects.map(project => ({ value: project.id, label: project.name }))} /></label>
        <div className={`fin-api-cost ${projectPendingCount ? 'is-pending' : ''}`}><div><Coins size={18} /><span>{quoteScope === 'simulation' ? 'API 模拟成本' : '已发生的 API 费用'}<small>{projectEntries.length} 次调用 · 自动带入</small></span></div><strong><CostTotal summary={projectSummary} /></strong></div>
        {projectPendingCount > 0 && <div className="fin-pending-callout"><Info size={17} /><div><strong>{projectSummary.pendingCount ? '部分计费依据待补齐，暂不生成完整报价' : '美元费用已知，暂缺人民币汇率'}</strong><p>软件会自动复算；可查看已知金额和具体缺项，无需手工计算费用。</p><button onClick={() => { setTab('ledger'); setQuery(''); setAction('all'); setLedgerProject(selectedProject.id); }}>查看此项目费用明细<ArrowRight size={13} /></button></div></div>}
        <div className="fin-quote-step"><span>2</span><div><h2>补上你的制作成本</h2><p>填写实际或预计投入。没有的项目可填 0 或留空。</p></div></div>
        <div className="fin-fields-grid fin-essential-fields"><AmountField label="制作时长" value={fields.minutes} unit="分钟" hint="填写实际或预计投入，API费用已经自动带入" onChange={value => updateField('minutes', value)} /><p className="fin-current-assumptions">按人工时薪 <strong>¥{fields.rate || '0'}</strong> 计算。返工预留 ¥{fields.reserve || '0'}，渠道费 {fields.fee || '0'}%。<span>可在下方展开调整，报价会实时更新。</span></p></div>
        <RememberedDetails rememberKey={`workspace:${workspaceId}:quote-additional-costs`} className="fin-additional-costs"><summary>人工单价、返工与其他费用</summary><div className="fin-fields-grid"><AmountField label="人工时薪" value={fields.rate} unit="元 / 小时" hint="自动按：分钟 ÷ 60 × 时薪" onChange={value => updateField('rate', value)} /><AmountField label="返工预留" value={fields.reserve} unit="元" hint="只填尚未发生的修改成本，已发生调用已自动计入" onChange={value => updateField('reserve', value)} /><AmountField label="其他制作成本" value={fields.other} unit="元" hint="例如购买素材、字体授权等额外费用" onChange={value => updateField('other', value)} /><AmountField label="预计后续生成费" value={fields.remaining} unit="元" hint="尚未发生的模型调用预留" onChange={value => updateField('remaining', value)} /><AmountField label="渠道费用比例" value={fields.fee} unit="%" hint="按售价计算；使用你实际渠道的费率" onChange={value => updateField('fee', value)} /></div></RememberedDetails>
        <div className="fin-quote-step"><span>3</span><div><h2>确定销售方式与目标</h2><p>单次交付看建议售价，重复销售看回本份数。</p></div></div>
        <div className="segmented fin-mode-switch" role="group" aria-label="报价方式"><button aria-pressed={quoteMode === 'single'} className={quoteMode === 'single' ? 'active' : ''} onClick={() => setQuoteMode('single')}>为客户做一单</button><button aria-pressed={quoteMode === 'repeat'} className={quoteMode === 'repeat' ? 'active' : ''} onClick={() => setQuoteMode('repeat')}>同一成品卖多份</button></div>
        <div className="fin-fields-grid">{quoteMode === 'single' ? <AmountField label="目标利润" value={fields.profit} unit="元" hint="扣除上述制作成本与渠道费后希望留下的金额" onChange={value => updateField('profit', value)} /> : <><AmountField label="假设单份售价" value={fields.price} unit="元" onChange={value => updateField('price', value)} /><AmountField label="每单交付成本" value={fields.variable} unit="元" hint="每多卖一份新增的成本，不含一次性制作成本" onChange={value => updateField('variable', value)} /></>}</div>
        {calculation.error && <div className="fin-error" role="alert"><Info size={15} />{calculation.error}</div>}
        {quoteDraft.error && <div className="fin-error" role="alert"><Info size={15} />{quoteDraft.error}</div>}
        <div className={`quote-working-status ${quoteDraft.recoveryError ? 'is-error' : ''}`} role={quoteDraft.recoveryError ? 'alert' : 'status'}><span>{quoteDraft.recoveryError || (quoteDraft.workingRaw ? quoteDraft.recovered ? '已恢复上次临时输入，正式报价仍单独保留。' : '临时输入已自动保存，切页或重启后可继续。' : '修改会自动保留；“保存本项目报价”单独记录正式版本。')}</span>{quoteDraft.recoveryError && <><button type="button" className="btn btn-ghost" onClick={() => { void quoteDraft.downloadRecovery(); }}>导出输入恢复稿</button><button type="button" className="btn btn-ghost" onClick={quoteDraft.reloadWorking}>读取最新临时草稿</button></>}</div>
        <div className="fin-draft-toolbar"><span>{quoteDraft.draft ? '已读取此项目草稿，费用按当前账本重算' : '每个项目独立保存报价参数'}</span><button className="btn btn-ghost" onClick={restoreQuote}><FolderOpen size={14} />读取草稿</button><button className="btn btn-ghost" onClick={() => { quoteDraft.reset(); notify('已恢复默认报价参数'); }}><RotateCcw size={14} />重置参数</button></div>
        <UnassignedQuoteDrafts quotes={legacyQuotes} projectName={selectedProject.name} onApply={(inputs, mode, scope) => { quoteDraft.loadFields(inputs, mode); quoteDraft.setScope(scope); setBillingScope(scope); notify('旧版参数已载入当前项目，保存后另存，原记录保留。', 'info'); }} onExport={async raw => { try { await downloadFile('旧版工作区报价-原始记录.json', raw, 'application/json;charset=utf-8'); } catch { notify('旧版报价未能导出。', 'error'); } }} />
        <CustomerQuotePanel workspaceId={workspaceId} projectId={selectedProject.id} title={selectedProject.name} priceCents={calculation.quote?.recommendedCents} enabled={quoteScope === 'live' && quoteMode === 'single' && !calculation.error} info={quoteDraft.customer} onChange={quoteDraft.updateCustomer} notify={notify} />
      </section>
      <aside className="fin-quote-aside">
        <section className="fin-recommendation" aria-live="polite"><span className="fin-recommend-kicker">{quoteMode === 'single' ? quoteScope === 'simulation' ? '模拟建议售价' : '建议对客售价' : '覆盖制作成本至少需售出'}</span><div className="fin-recommend-amount">{calculation.error ? <span>—</span> : quoteMode === 'single' ? <><small>¥</small>{money(calculation.quote!.recommendedCents)}</> : calculation.repeat?.unitsNeeded === null ? <span className="fin-cannot-recover">当前售价无法回本</span> : <>{calculation.repeat?.unitsNeeded ?? 0}<small>份</small></>}</div><p>{projectPendingCount ? '计费依据完整后自动更新' : quoteMode === 'single' ? '已计入制作成本、渠道费用和目标利润' : '回本份数是计算结果，不是销量预测'}</p><div className="fin-recommend-divider" /><div className="fin-recommend-bottom"><span>{quoteMode === 'single' ? '不含目标利润的保本售价' : '每份售出后可回收'}</span><strong>{calculation.error ? '—' : `¥ ${money(quoteMode === 'single' ? calculation.quote!.breakEvenCents : calculation.repeat?.contributionCents ?? 0)}`}</strong></div></section>
        <section className="panel fin-breakdown"><h3>钱怎么分</h3><div><span>API {quoteScope === 'simulation' ? '模拟' : '真实'}费用</span><b><CostTotal summary={projectSummary} /></b></div><div><span>人工成本</span><b>{calculation.error ? '—' : `¥ ${money(calculation.laborCents!)}`}</b></div><div><span>其他成本及后续调用</span><b>{calculation.error ? '—' : `¥ ${money(calculation.otherCents! + calculation.remainingCents!)}`}</b></div><div><span>返工预留</span><b>{calculation.error ? '—' : `¥ ${money(calculation.reserveCents!)}`}</b></div><div className="fin-breakdown-total"><span>合计制作成本</span><b>{calculation.error ? '—' : `¥ ${money(calculation.costCents!)}`}</b></div><div><span>渠道费用（{fields.fee.trim() || '0'}%）</span><b>{calculation.error ? '—' : `¥ ${money(quoteMode === 'single' ? calculation.quote!.feeCents : calculation.repeat!.feeCents)}`}</b></div>{quoteMode === 'single' && <div className="fin-profit-line"><span>扣除全部成本后利润</span><b>{calculation.error ? '—' : `¥ ${money(calculation.quote!.profitCents)}`}</b></div>}</section>
        <section className="panel fin-formula"><h3>怎么算出来的</h3><p>{quoteMode === 'single' ? '建议售价 =（制作成本 + 目标利润）÷（1 − 渠道费率）' : '回本份数 = 制作成本 ÷（单份售价 − 渠道费 − 每单交付成本）'}</p>{!calculation.error && <strong>{quoteMode === 'single' ? `（¥${money(calculation.costCents!)} + ¥${money(Math.round(Number(fields.profit || 0) * 100))}）÷（1 − ${fields.fee.trim() || '0'}%）` : `¥${money(calculation.costCents!)} ÷ ¥${money(calculation.repeat!.contributionCents)}`}</strong>}<small>人民币成本合计与售价向上取整到分；回本份数向上取整。人工与返工预算按你的输入计算。</small></section>
        <button className="btn btn-primary fin-save-button" onClick={saveQuote} disabled={Boolean(calculation.error || quoteDraft.error)}>{saved ? <Check size={17} /> : <Save size={17} />}{saved ? '报价草稿已保存' : '保存本项目报价'}</button>{quoteMode === 'single' && quoteScope === 'live' && <button className="btn btn-secondary fin-export-button" onClick={copyQuote} disabled={Boolean(calculation.error)}><Copy size={16} />复制价格摘要</button>}
        <RememberedDetails rememberKey={`workspace:${workspaceId}:quote-explanation`} className="fin-quote-more"><summary>更多：导出与计算说明</summary><p>人民币使用参考汇率，最终结算、额外修改或遗漏费用会影响利润。当前报价不保证成交。{quoteScope === 'simulation' && '当前是模拟报价，不应作为真实交付价格。'}</p><p>API 金额精确相加后，合计一次向上取整到分。{projectSummary.legacyCount > 0 && `含 ${projectSummary.legacyCount} 笔旧版分值估算。`}</p><button className="btn btn-secondary" onClick={exportQuote} disabled={Boolean(calculation.error)}><Download size={15} />导出内部报价 JSON</button></RememberedDetails><div className="fin-safe-caption"><BadgeCheck size={13} />{quoteScope === 'simulation' ? '模拟报价' : '真实费用范围'} · 参数按项目独立保存</div>
      </aside>
    </div>}
    {reconcileEntry && <ReconcileDialog key={reconcileEntry.id} entry={reconcileEntry} available={workflowRunner.runtimeStatus.available && reconcileEntry.status !== 'processing'} onClose={() => setReconcileId(null)} onSave={async cents => { if (!workflowRunner.runtimeStatus.available) throw new Error('desktop unavailable'); await workflowRunner.reconcileCost(reconcileEntry.id, cents); setReconcileId(null); quoteDraft.markDirty(); notify('已保存人工账单校正，原始自动明细保留，报价按当前账本重新计算。'); }} />}
  </div>;
}
