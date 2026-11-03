const MAX_JSON_BYTES = 128 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 180_000;

class ModelRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ModelRuntimeError';
    this.code = code;
    this.requestStarted = Boolean(details.requestStarted);
    if (Number.isInteger(details.httpStatus)) this.httpStatus = details.httpStatus;
    if (details.providerRequestId) this.providerRequestId = details.providerRequestId;
    if (details.usage) this.usage = details.usage;
    if (typeof details.partialText === 'string') this.partialText = details.partialText;
  }
}

function failure(code, message, context = {}, extra = {}) {
  return new ModelRuntimeError(code, message, { requestStarted: context.requestStarted, providerRequestId: context.providerRequestId, ...extra });
}

function checkedUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw failure('INVALID_ENDPOINT', '服务地址无效，请填写 HTTPS Base URL。'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw failure('INVALID_ENDPOINT', '模型连接仅允许 HTTPS，或本机 localhost HTTP。');
  if (url.username || url.password || url.hash) throw failure('INVALID_ENDPOINT', '服务地址不能包含认证信息或片段。');
  return url;
}

function endpoint(baseUrl, route) {
  const base = checkedUrl(baseUrl);
  if (base.search) throw failure('INVALID_ENDPOINT', 'Base URL 不能包含查询参数或 API Key。');
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/${route.replace(/^\/+/, '')}`;
  return base.toString();
}

function safeId(value, secret = '') {
  if (typeof value !== 'string') return undefined;
  const redacted = secret ? value.split(secret).join('[redacted]') : value;
  const result = redacted.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 160);
  return result || undefined;
}

function abortFailure(context) {
  return failure(context.timedOut ? 'TIMEOUT' : 'CANCELLED', context.timedOut ? '模型请求超时，未自动重试；请核对供应商账单。' : '模型请求已取消；已发送的请求可能仍由供应商计费，请核对账单。', context);
}

function ensureActive(context) {
  if (context.signal?.aborted) throw abortFailure(context);
}

function raceSignal(promise, context) {
  return new Promise((resolve, reject) => {
    const cleanup = () => context.signal?.removeEventListener('abort', cancel);
    const cancel = () => { cleanup(); reject(abortFailure(context)); };
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (context.signal?.aborted) cancel(); else context.signal?.addEventListener('abort', cancel, { once: true });
  });
}

function createContext(signal, onProgress, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const context = { signal: controller.signal, onProgress, requestStarted: false, timedOut: false, providerRequestId: undefined, secret: '' };
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => { context.timedOut = true; controller.abort(); }, timeoutMs);
  timeout.unref?.();
  context.cleanup = () => { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); context.secret = ''; };
  return context;
}

function progress(context, phase, message, details = {}) {
  ensureActive(context);
  if (typeof context.onProgress === 'function') context.onProgress({ phase, message, ...details });
}

async function readLimited(response, limit, context) {
  ensureActive(context);
  const length = Number(response.headers?.get('content-length'));
  if (Number.isFinite(length) && length > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw failure('RESPONSE_TOO_LARGE', '供应商返回内容超过本次安全读取上限。', context);
  }
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await raceSignal(response.arrayBuffer(), context));
    if (bytes.length > limit) throw failure('RESPONSE_TOO_LARGE', '供应商返回内容超过本次安全读取上限。', context);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await raceSignal(reader.read(), context);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw failure('RESPONSE_TOO_LARGE', '供应商返回内容超过本次安全读取上限。', context);
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}

async function request(fetchImpl, url, options, context, authenticated = true) {
  ensureActive(context);
  checkedUrl(url);
  if (authenticated) context.requestStarted = true;
  let response;
  try { response = await raceSignal(fetchImpl(url, { ...options, redirect: 'manual', signal: context.signal }), context); }
  catch (error) { if (error instanceof ModelRuntimeError) throw error; if (context.signal.aborted) throw abortFailure(context); throw failure('NETWORK_ERROR', '模型请求未能完成，请检查网络、服务地址与账户状态；未自动重试。', context); }
  if (authenticated) context.providerRequestId = safeId(response.headers?.get('x-request-id') || response.headers?.get('request-id') || response.headers?.get('x-siliconcloud-trace-id'), context.secret) || context.providerRequestId;
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw failure('REDIRECT_BLOCKED', '服务返回重定向，已阻止转发认证凭证。请填写最终服务地址。', context, { httpStatus: response.status });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    const description = { 400: '请求参数或模型能力不被该接口接受', 401: '凭证无效或与服务地址不匹配', 402: '账户额度不足或模型服务尚未开通', 403: '账户没有该模型或地域的访问权限', 404: '接口路径或模型 ID 不存在', 413: '输入文件或请求内容过大', 429: '账户触发限流或额度限制' }[response.status] || '供应商接口返回错误';
    throw failure('HTTP_ERROR', `模型服务 HTTP ${response.status}：${description}。未自动重试，请核对账户与账单。`, context, { httpStatus: response.status });
  }
  return response;
}

async function jsonRequest(fetchImpl, url, options, context) {
  const response = await request(fetchImpl, url, options, context);
  progress(context, 'receiving', '正在读取模型返回内容。');
  let data;
  try { data = JSON.parse((await readLimited(response, MAX_JSON_BYTES, context)).toString('utf8')); }
  catch (error) { if (error instanceof ModelRuntimeError) throw error; throw failure('INVALID_RESPONSE', '供应商没有返回有效 JSON，未将本次调用标记为成功。', context); }
  if (!data || typeof data !== 'object' || data.error) throw failure('PROVIDER_ERROR', '供应商返回业务错误，未将本次调用标记为成功，请核对服务控制台。', context);
  return data;
}

function tokenCount(value) { return Number.isSafeInteger(value) && value >= 0 ? value : undefined; }
function firstCount(...values) { return values.map(tokenCount).find(value => value !== undefined); }
function sumCounts(...values) {
  return values.every(value => tokenCount(value) !== undefined) ? tokenCount(values.reduce((sum, value) => sum + value, 0)) : undefined;
}
function modalityCount(details, modality) {
  if (!Array.isArray(details)) return undefined;
  const matching = details.filter(detail => detail?.modality === modality);
  return matching.length ? sumCounts(...matching.map(detail => detail.tokenCount)) : undefined;
}

function cacheUsage(raw, input) {
  const creation = raw.cache_creation || {};
  const write = input.cache_write_tokens_details || {};
  const cacheWrite5mTokens = tokenCount(creation.ephemeral_5m_input_tokens);
  const cacheWrite1hTokens = tokenCount(creation.ephemeral_1h_input_tokens);
  const cacheWrite30mTokens = tokenCount(write.ttl_30m_tokens);
  const cacheWrite12hTokens = tokenCount(write.ttl_12h_tokens);
  return {
    cachedInputTokens: firstCount(raw.cache_read_input_tokens, raw.prompt_cache_hit_tokens, input.cached_tokens, raw.cachedContentTokenCount),
    cachedInputTextTokens: firstCount(input.cached_tokens_details?.text_tokens, modalityCount(raw.cacheTokensDetails, 'TEXT')),
    cachedInputImageTokens: firstCount(input.cached_tokens_details?.image_tokens, modalityCount(raw.cacheTokensDetails, 'IMAGE')),
    cacheWriteInputTokens: firstCount(raw.cache_creation_input_tokens, input.cache_write_tokens, sumCounts(cacheWrite5mTokens, cacheWrite1hTokens), sumCounts(cacheWrite30mTokens, cacheWrite12hTokens)),
    cacheWrite5mTokens, cacheWrite1hTokens, cacheWrite30mTokens, cacheWrite12hTokens,
  };
}

function tokenUsage(data, raw) {
  const input = raw.input_tokens_details || raw.prompt_tokens_details || {};
  const output = raw.output_tokens_details || raw.completion_tokens_details || {};
  const cache = cacheUsage(raw, input);
  const ordinaryInput = firstCount(raw.input_tokens, raw.prompt_tokens, raw.promptTokenCount);
  const anthropic = raw.cache_read_input_tokens !== undefined || raw.cache_creation_input_tokens !== undefined || raw.cache_creation !== undefined || data?.type === 'message' || typeof data?.stop_reason === 'string';
  const reads = raw.cache_read_input_tokens === undefined ? 0 : cache.cachedInputTokens;
  const writes = raw.cache_creation_input_tokens === undefined && raw.cache_creation === undefined ? 0 : cache.cacheWriteInputTokens;
  // Anthropic excludes cache reads/writes from input_tokens; other providers include them.
  const inputTokens = anthropic ? sumCounts(ordinaryInput, reads, writes) : ordinaryInput;
  const geminiOutput = sumCounts(tokenCount(raw.candidatesTokenCount), raw.thoughtsTokenCount === undefined ? 0 : tokenCount(raw.thoughtsTokenCount));
  const knownCacheWrite = data?.usageMetadata ? 0 : cache.cacheWriteInputTokens;
  const uncachedInput = sumCounts(cache.cachedInputTokens, knownCacheWrite);
  return {
    inputTokens,
    outputTokens: firstCount(raw.output_tokens, raw.completion_tokens, geminiOutput),
    totalTokens: firstCount(raw.total_tokens, raw.totalTokenCount),
    inputTextTokens: firstCount(input.text_tokens, modalityCount(raw.promptTokensDetails, 'TEXT')),
    inputImageTokens: firstCount(input.image_tokens, modalityCount(raw.promptTokensDetails, 'IMAGE')),
    outputTextTokens: firstCount(output.text_tokens, modalityCount(raw.candidatesTokensDetails, 'TEXT')),
    outputImageTokens: firstCount(output.image_tokens, modalityCount(raw.candidatesTokensDetails, 'IMAGE')),
    reasoningTokens: firstCount(output.reasoning_tokens, raw.thoughtsTokenCount),
    uncachedInputTokens: firstCount(raw.prompt_cache_miss_tokens, anthropic ? ordinaryInput : undefined, inputTokens !== undefined && uncachedInput !== undefined ? inputTokens - uncachedInput : undefined),
    ...cache,
  };
}

function normalizedUsage(data, context) {
  const raw = data?.usage || data?.usageMetadata || {};
  const usage = {};
  for (const [key, value] of Object.entries(tokenUsage(data, raw))) if (tokenCount(value) !== undefined) usage[key] = value;
  const seconds = raw.seconds ?? data?.duration;
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) usage.seconds = seconds;
  if (Object.keys(usage).length) usage.usageSource = 'provider-reported';
  const id = context.providerRequestId || safeId(data?.id || data?.responseId, context.secret);
  if (id) { context.providerRequestId = id; usage.providerRequestId = id; }
  return usage;
}

module.exports = { ModelRuntimeError, REQUEST_TIMEOUT_MS, failure, checkedUrl, endpoint, safeId, ensureActive, raceSignal, createContext, progress, readLimited, request, jsonRequest, normalizedUsage };
