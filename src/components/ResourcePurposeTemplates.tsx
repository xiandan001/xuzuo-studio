import { lazy, Suspense, useState } from 'react';
import { LayoutTemplate, LoaderCircle } from 'lucide-react';
import type { PageProps } from '../types';

const PurposeTemplates = lazy(() => import('./PurposeTemplates').then(module => ({ default: module.PurposeTemplates })));
export function ResourcePurposeTemplates({ props }: { props: PageProps }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="btn btn-secondary resource-purpose-entry" onClick={() => setOpen(true)}><LayoutTemplate size={16} />用途模板<small>图片</small></button>{open && <Suspense fallback={<p role="status" className="resource-template-loading"><LoaderCircle size={16} className="spin" />正在打开用途模板…</p>}><PurposeTemplates key={props.workspaceId} templates={props.configuration.useTemplates || []} workspaceId={props.workspaceId} workspaceName={props.workspace.name} initialMode="manage" onSave={props.configuration.saveUseTemplate} onDelete={props.configuration.deleteUseTemplate} onClose={() => setOpen(false)} /></Suspense>}</>;
}
