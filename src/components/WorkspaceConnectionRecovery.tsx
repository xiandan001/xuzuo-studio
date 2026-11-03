import { useEffect, useRef, useState } from 'react';
import { FolderSync, LoaderCircle } from 'lucide-react';

export const isWorkspaceConnectionError = (message: string) => /工作区连接标记|本地工作区目录已不可用|本地工作区目录身份不匹配/.test(message);

export function WorkspaceConnectionRecovery({ workspaceId, disabled, onRecovered }: { workspaceId: string; disabled?: boolean; onRecovered: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const currentWorkspace = useRef(workspaceId); currentWorkspace.current = workspaceId;
  useEffect(() => { setBusy(false); setFeedback(''); }, [workspaceId]);
  const bridge = window.desktop?.workspaceFiles;
  if (!bridge?.repair) return null;
  async function repair() {
    if (busy || disabled) return;
    const id = workspaceId; setBusy(true); setFeedback('');
    try {
      const result = await bridge!.repair({ workspaceId: id });
      if (currentWorkspace.current !== id) return;
      setFeedback(result.repaired ? '工作区连接已恢复，正在重新读取文稿。' : '工作区已连接，正在重新读取文稿。');
      await onRecovered();
    } catch (error) {
      if (currentWorkspace.current === id) setFeedback(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '工作区连接未能恢复，请保留原目录并稍后重试。');
    } finally { if (currentWorkspace.current === id) setBusy(false); }
  }
  return <div className="workspace-connection-recovery"><p>先核验现有项目身份，再恢复丢失的工作区连接标记；不会重新生成文档或调用模型。</p><button className="btn btn-secondary" disabled={busy || disabled} onClick={() => { void repair(); }}>{busy ? <LoaderCircle size={15} className="spin" /> : <FolderSync size={15} />}{busy ? '正在检查工作区' : '检查并恢复工作区'}</button>{feedback && <p role="status">{feedback}</p>}</div>;
}
