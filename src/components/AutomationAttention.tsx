import { ListTodo } from 'lucide-react';
import { useAutomationCenter } from '../hooks/useAutomationCenter';
export function AutomationAttention({ workspaceId, onOpen, representedReviewRunIds = [] }: { workspaceId: string; onOpen: () => void; representedReviewRunIds?: string[] }) {
  const { snapshot } = useAutomationCenter(workspaceId), count = snapshot.decisions.filter(item => !item.resolvedAt && !(item.kind === 'review' && item.runId && representedReviewRunIds.includes(item.runId))).length;
  return count || snapshot.issue ? <button className="btn btn-ghost" onClick={onOpen} aria-label={snapshot.issue ? '自动化需要检查' : `${count} 项自动化待办`}><ListTodo size={16} />{snapshot.issue ? '自动化需检查' : `待处理 ${count}`}</button> : null;
}
