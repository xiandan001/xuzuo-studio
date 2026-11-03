import appIcon from '../../assets/app-icon.svg';
import './brand.css';

export function AppMark() {
  return <span className="app-mark" aria-hidden="true"><img src={appIcon} alt="" draggable={false} /></span>;
}
export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}>
    <div className="brand-mark brand-emblem" aria-hidden="true">
      <img src={appIcon} alt="" draggable={false} />
    </div>
    {!compact && <div><strong>序作工作台</strong><small>XUZUO STUDIO</small></div>}
  </div>;
}
