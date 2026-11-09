const PDF = 'application/pdf';
function pdfInputIssue(connection, model, files) {
  const pdfs = files.filter(file => file.mimeType === PDF);
  if (!pdfs.length) return undefined;
  if (!model?.capabilities?.includes('vision')) return '参考资料包含PDF，请为此文字/资料步骤选择支持看图和PDF的模型。';
  if (!['openai-chat', 'openai-responses', 'anthropic', 'gemini'].includes(connection?.protocol)) return '当前接口尚未适配原生PDF输入，请选择OpenAI、Claude或Gemini文档模型。';
  if (connection.protocol === 'openai-chat' && connection.providerId !== 'openai') return '当前兼容聊天接口尚未适配PDF文件输入，请换用已支持的原生文档接口。';
  const total = pdfs.reduce((sum, file) => sum + (file.buffer?.byteLength ?? file.bytes ?? 0), 0);
  if (['openai-chat', 'openai-responses', 'gemini'].includes(connection.protocol) && total >= 50 * 1024 * 1024) return '本次PDF资料合计需小于50MB，请拆分后制作。';
  return undefined;
}
module.exports = { PDF, pdfInputIssue };
