import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardCheck } from 'lucide-react';
import type { DeliveryCheck } from '../lib/delivery-quality';
import { deliveryFingerprint } from '../lib/delivery-quality';
interface Review { fingerprint: string; checked: string[]; }
export function DeliveryChecklist({ projectId, kind, sourceRevision, artifactId, checks, controlledReview, onCheckedChange }: { projectId: string; kind: string; sourceRevision: number | string; artifactId?: string; checks: DeliveryCheck[]; controlledReview?: { checkedIds: string[]; persisted: boolean; busy?: boolean; error?: string }; onCheckedChange?: (ids: string[]) => void }) {
  const key = `xuzuo.delivery-review.${projectId}.${kind}`;
  const fingerprint = useMemo(() => deliveryFingerprint(`${sourceRevision}|${artifactId || ''}`), [sourceRevision, artifactId]);
  const read = (): Review => { try { const stored = JSON.parse(localStorage.getItem(key) || 'null'); if (stored?.version === 1 && stored.fingerprint === fingerprint && Array.isArray(stored.checked)) return { fingerprint, checked: stored.checked.filter((id: unknown): id is string => typeof id === 'string') }; } catch { /* An unreadable old review does not approve a new result. */ } return { fingerprint, checked: [] }; };
  const [review, setReview] = useState<Review>(read);
  const [saveError, setSaveError] = useState('');
  useEffect(() => { setReview(read()); setSaveError(''); }, [key, fingerprint]);
  const checked = controlledReview ? controlledReview.checkedIds : review.fingerprint === fingerprint ? review.checked : [];
  const error = controlledReview?.error || saveError;
  const technical = checks.filter(check => check.status !== 'manual'), manual = checks.filter(check => check.status === 'manual');
  const technicalReady = technical.length > 0 && technical.every(check => check.status === 'passed');
  const ready = !error && (controlledReview?.persisted ?? true) && technicalReady && manual.length > 0 && manual.every(check => checked.includes(check.id));
  const passed = checks.filter(check => check.status === 'passed' || check.status === 'manual' && checked.includes(check.id)).length;
  const toggle = (id: string) => {
    const next = { fingerprint, checked: checked.includes(id) ? checked.filter(value => value !== id) : [...checked, id] };
    if (controlledReview) { onCheckedChange?.(next.checked); return; }
    try { localStorage.setItem(key, JSON.stringify({ version: 1, ...next })); setReview(next); setSaveError(''); } catch { setSaveError('验收记录未能保存，未标记为可交付。请检查本机存储后重新勾选。'); }
  };
  return <details className="delivery-checklist panel" aria-label="交付检查"><summary><ClipboardCheck size={18} /><strong>交付检查</strong><span>{passed} / {checks.length}</span><b className={`delivery-review-status ${ready ? 'ready' : ''}`} role="status">{error ? '验收未保存' : ready ? '人工验收：可交付' : technicalReady ? '待人工验收' : '待完善'}</b></summary><div className="delivery-check-body">{error && <p className="form-error" role="alert">{error}</p>}{checks.map(check => check.status === 'manual' ? <label className="delivery-manual-check" key={check.id}><input type="checkbox" disabled={controlledReview?.busy} checked={checked.includes(check.id)} onChange={() => toggle(check.id)} /><span><strong>{check.label}</strong><small>{check.detail}</small></span></label> : <div className={`delivery-check-row status-${check.status}`} key={check.id}>{check.status === 'passed' ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}<span><strong className="delivery-check-title">{check.label}</strong><small className="delivery-check-detail">{check.detail}</small></span><b>{check.status === 'passed' ? '已检查' : check.status === 'unknown' ? '尚未确认' : '需处理'}</b></div>)}<p className="delivery-check-caption">验收记录只对应当前成品。修改内容或更换图片后需重新检查；事实、视觉效果及素材使用范围由你核对。</p></div></details>;
}
