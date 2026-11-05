import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { RememberedDetails } from './RememberedDetails';
import './compact-ai-panel.css';

export function CompactAiPanel({ mode, children, footer }: { mode: ReactNode; children: ReactNode; footer: ReactNode }) {
  return <section className="studio-ai-composer">
    <div className="studio-ai-modebar">{mode}</div>
    <div className="studio-ai-scroll">{children}</div>
    <footer className="studio-ai-footer">{footer}</footer>
  </section>;
}

export function AiSettingsSection({ rememberKey, title, summary, defaultOpen, children }: { rememberKey: string; title: string; summary?: string; defaultOpen?: boolean; children: ReactNode }) {
  return <RememberedDetails rememberKey={rememberKey} defaultOpen={defaultOpen} className="studio-ai-settings">
    <summary><span>{title}</span>{summary && <small title={summary}>{summary}</small>}<ChevronDown size={15} /></summary>
    <div className="studio-ai-settings-body">{children}</div>
  </RememberedDetails>;
}
