import type { WorkflowRun } from '../configuration-types';
import { scopedTaskRuns } from '../lib/task-visibility';
import type { TaskScope } from '../lib/task-visibility';
export function TaskScopeFilter({ runs, value, onChange }: { runs: WorkflowRun[]; value: TaskScope; onChange: (scope: TaskScope) => void }) {
  return <div className="task-scope-filter" role="group" aria-label="任务记录范围">{([{ value: 'visible', label: '当前任务' }, { value: 'hidden', label: '已隐藏' }, { value: 'trash', label: '任务回收站' }] as const).map(item => <button type="button" key={item.value} className={value === item.value ? 'active' : ''} aria-pressed={value === item.value} onClick={() => onChange(item.value)}>{item.label}<span>{scopedTaskRuns(runs, item.value).length}</span></button>)}<small>整理记录保留费用和生成文件</small></div>;
}
