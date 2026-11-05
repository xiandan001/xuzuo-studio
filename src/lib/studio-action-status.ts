export type StudioActionTarget = 'request' | 'model' | 'models' | 'task' | 'reload' | 'references' | 'quantity';
export interface StudioActionIssue { message: string; action?: string; target?: StudioActionTarget; }
export function studioActionIssue({ ready, busy, taskStatus, input, inputLabel, modelId, modelCount }: { ready: boolean; busy: string; taskStatus?: string; input: string; inputLabel: string; modelId?: string; modelCount: number }): StudioActionIssue | undefined {
  if (busy) {
    const messages: Record<string, string> = { load: '正在读取项目内容，请稍候。', save: '正在保存当前版本，保存完成后即可生成。', export: '正在导出本地文件，完成后即可生成。', source: '正在载入生成内容，请稍候。', version: '正在载入历史版本，请稍候。', image: '正在导入插图，请稍候。', importing: '正在导入参考图片，请稍候。', references: '正在核对参考图片，请稍候。' };
    return { message: messages[busy] || '正在处理当前项目文件，完成后即可生成。' };
  }
  if (!ready) return { message: '项目内容尚未载入，请先重新读取项目。', action: '重新读取', target: 'reload' };
  if (taskStatus === 'running') return { message: '当前项目正在生成，请等待本轮结束后再开始新任务。', action: '查看当前任务', target: 'task' };
  if (taskStatus === 'paused') return { message: '当前任务已暂停，请先继续或取消该任务，再开始新任务。', action: '处理暂停任务', target: 'task' };
  if (!input.trim()) return { message: `请先填写${inputLabel}。`, action: `填写${inputLabel}`, target: 'request' };
  if (!modelCount) return { message: '尚未配置支持本次操作的模型，已填写内容会保留。', action: '配置模型与 Key', target: 'models' };
  if (!modelId) return { message: '请先选择本次使用的模型。', action: '选择模型', target: 'model' };
  return undefined;
}
export const REVIEW_REPLACEMENT_NOTE = '新一轮生成或精修会保留原结果，并创建新版本。';
