import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Palette } from 'lucide-react';
import type { PageProps, Project, PromptTemplate } from '../types';
import { BEAD_WORKSPACE_NOTICE } from '../lib/bead-intent';

const template: PromptTemplate = { id: 'builtin-bead-workspace', builtin: true, name: '拼豆制图', description: BEAD_WORKSPACE_NOTICE, category: 'image', imagePreset: '拼豆', mode: 'create', content: '', updatedAt: '2026-11-07T00:00:00Z' };

export function HomeBeadEntry({ props, projectId, request, prepareProject }: { props: PageProps; projectId?: string; request: string; prepareProject?: (project: Project) => Promise<void> }) {
  const [busy, setBusy] = useState(false), [issue, setIssue] = useState(''), mounted = useRef(true);
  const current = useRef(props); current.current = props;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function open() {
    if (busy) return;
    const workspaceId = props.workspaceId;
    async function launch(project: Project) {
      try {
        await prepareProject?.(project);
        if (mounted.current && current.current.workspaceId === workspaceId) current.current.onUsePrompt(template, request, project.id);
      } catch (cause) { if (mounted.current) setIssue(cause instanceof Error ? cause.message : '附件尚未准备好，请重试打开工作台。'); }
      finally { if (mounted.current) setBusy(false); }
    }
    setBusy(true); setIssue('');
    const project = props.projects.find(item => item.id === projectId && item.kind === 'image' && item.workspaceId === props.workspaceId && !item.trashedAt);
    if (project) { void launch(project); return; }
    props.onCreateProject('image', { quick: true, initial: { name: '拼豆图纸', description: request }, onCreated: created => {
      if (!mounted.current || current.current.workspaceId !== workspaceId || created.workspaceId !== workspaceId) return;
      void launch(created);
    }, onCancelled: message => { if (mounted.current) { setBusy(false); setIssue(message || '已取消，需求仍保留，尚未调用 AI。'); } } });
  }
  return <aside className="home-bead-entry" aria-label="拼豆制图入口"><Palette size={22} /><div><strong>用真实网格制作拼豆图纸</strong><p>{BEAD_WORKSPACE_NOTICE}</p>{issue && <p role="status">{issue}</p>}</div><button type="button" className="btn btn-primary" disabled={busy} onClick={open}>{busy ? '正在选择保存位置…' : '打开拼豆工作台'}<ArrowUpRight size={16} /></button></aside>;
}
