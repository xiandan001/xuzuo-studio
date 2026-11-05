import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { PageProps, Project } from '../types';
import { Select } from './Select';

export function AutomationProjectField({ props, value, label, ariaLabel, onSelect, disabled = false, newProjectKind, projectKind, quickCreate = false, initialDescription }: { props: PageProps; value: string; label: string; ariaLabel: string; onSelect: (project: Project) => void; disabled?: boolean; newProjectKind?: Project['kind']; projectKind?: Project['kind']; quickCreate?: boolean; initialDescription?: string }) {
  const mounted = useRef(true), current = useRef({ workspaceId: props.workspaceId, onSelect });
  const pending = useRef(false), [creating, setCreating] = useState(false);
  current.current = { workspaceId: props.workspaceId, onSelect };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const choices = props.projects.filter(project => !projectKind || project.kind === projectKind);
  const selected = props.projects.find(project => project.id === value);
  function create() {
    if (quickCreate && pending.current) return;
    if (quickCreate) { pending.current = true; setCreating(true); }
    const workspaceId = props.workspaceId;
    const finish = () => { pending.current = false; if (mounted.current) setCreating(false); };
    props.onCreateProject(newProjectKind || selected?.kind || 'word', { ...(quickCreate ? { quick: true, initial: { description: initialDescription || '' }, onCancelled: finish } : {}), onCreated: project => {
      finish();
      if (mounted.current && current.current.workspaceId === workspaceId && project.workspaceId === workspaceId) current.current.onSelect(project);
    } });
  }
  return <div className="auto-project-field"><div className="auto-field-heading"><span>{label}</span><button className="text-button" type="button" disabled={disabled || creating} onClick={create}><Plus size={14} />{creating ? '正在选择位置…' : '新建项目'}</button></div><Select aria-label={ariaLabel} disabled={disabled || creating || !choices.length} value={value} placeholder="请选择或新建项目" options={choices.map(project => ({ value: project.id, label: project.name }))} onValueChange={id => { const project = props.projects.find(project => project.id === id); if (project) onSelect(project); }} /></div>;
}
