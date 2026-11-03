const { validateUrl } = require('./live-validation.cjs');

async function probeConnection({ connection, credentialId }, credentials, fetchImpl = fetch) {
  const error = validateUrl(connection?.baseUrl);
  if (error || !connection.enabled || connection.demo) throw new Error(error || '请选择启用的真实连接。');
  if (!['openai-chat', 'openai-responses', 'anthropic', 'gemini', 'image', 'audio'].includes(connection.protocol)) return { ok: false, message: '这个专用协议还没有认证探测适配器，请先选择受支持协议。' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    return await credentials.withSecret(credentialId, connection.id, async secret => {
      const base = connection.baseUrl.replace(/\/+$/, '');
      const headers = connection.protocol === 'anthropic' ? { 'x-api-key': secret, 'anthropic-version': '2023-06-01' } : connection.protocol === 'gemini' ? { 'x-goog-api-key': secret } : { Authorization: `Bearer ${secret}` };
      const url = `${base}${connection.protocol === 'anthropic' && !base.endsWith('/v1') ? '/v1' : ''}/models`;
      let response;
      try { response = await fetchImpl(url, { headers, redirect: 'error', signal: controller.signal }); }
      catch { return { ok: false, message: '认证接口未能连接，请检查地址、本机网络或服务状态。未进行内容生成。' }; }
      if (!response.ok) return { ok: false, message: `认证接口返回 HTTP ${response.status}，请检查 Key、区域和服务地址；没有发起生成请求。` };
      return { ok: true, message: '认证接口可达且接受了本次凭证；具体模型与多模态权限仍需实际运行验证。' };
    });
  } finally { clearTimeout(timeout); }
}
module.exports = { probeConnection };
