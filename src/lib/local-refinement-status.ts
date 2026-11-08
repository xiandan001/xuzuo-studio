export interface LocalRefinementIssue { message: string; action?: 'models' | 'credential'; }
export function localRefinementIssue({ available, disabled, running, instruction, model, credential, credentialCount, targetCount }: { available: boolean; disabled: boolean; running: boolean; instruction: string; model: boolean; credential: boolean; credentialCount: number; targetCount: number }): LocalRefinementIssue | undefined {
  if (!available) return { message: '真实 AI 精修需要桌面执行引擎；请在新版桌面应用中打开此项目。' };
  if (running) return { message: '正在生成修改建议。完成后先预览差异，原稿不会自动替换。' };
  if (disabled) return { message: '当前项目正在读取、保存或执行任务，请等待完成后再精修。' };
  if (!model) return { message: '尚未选择可用的文本模型，已填写的修改要求会保留。', action: 'models' };
  if (!credential) return credentialCount > 0 ? { message: '请选择上方的调用凭证，再生成修改建议。', action: 'credential' } : { message: '此模型没有启用的 API Key，请先在模型中心配置。', action: 'models' };
  if (!instruction.trim()) return { message: '请先填写修改指令，说明需要保留和调整的内容。' };
  if (!targetCount) return { message: '当前范围没有可精修文字，请重新选择段落、页面或已用单元格；图片不改动，公式默认保留。' };
  return undefined;
}
