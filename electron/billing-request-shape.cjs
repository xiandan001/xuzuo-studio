const ADAPTER = 'xuzuo-openai-responses-v1';
const DEFAULT_CACHE_MODELS = new Set(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna']);
const count = value => Number.isSafeInteger(value) && value >= 0;

function officialResponses(context) {
  const connection = context.connection;
  if (!connection || connection.demo || connection.enabled === false || connection.providerId !== 'openai' || connection.protocol !== 'openai-responses' || !['text', 'vision'].includes(context.operation)) return false;
  try {
    const url = new URL(connection.baseUrl);
    return url.protocol === 'https:' && url.hostname === 'api.openai.com' && !url.port && !url.username && !url.password && !url.search && !url.hash && url.pathname.replace(/\/+$/, '') === '/v1';
  } catch { return false; }
}
function hasBreakpoint(value) {
  if (!value || typeof value !== 'object') return false;
  if (Object.hasOwn(value, 'prompt_cache_breakpoint')) return true;
  return Object.values(value).some(hasBreakpoint);
}
function createBillingRequestSnapshot(request, body) {
  const context = { connection: request.connection, modelId: request.model?.modelId, operation: request.kind };
  if (!officialResponses(context) || !body || body.model !== context.modelId) return undefined;
  const breakpoints = hasBreakpoint(body.input), options = body.prompt_cache_options;
  const defaultShape = options === undefined && !breakpoints;
  return { version: 1, adapter: ADAPTER, source: 'adapter-request', providerId: 'openai', protocol: 'openai-responses', modelId: context.modelId, operation: context.operation,
    cache: { ttl: defaultShape ? '30m' : ['30m', '12h'].includes(options?.ttl) ? options.ttl : 'unknown', source: defaultShape ? 'documented-default' : 'explicit-or-unverified', breakpoints } };
}
function recoverLegacyBillingRequest(record, entry, attempt, context, rule) {
  if (!rule || !entry.billingRuleSnapshot || !officialResponses(context) || !DEFAULT_CACHE_MODELS.has(context.modelId) || !attempt || record.run.mode !== 'live') return undefined;
  const step = record.run.snapshot.steps.find(item => item.id === entry.workflowStepId);
  if (entry.workflowAttemptId !== attempt.id || step?.id !== attempt.stepId || step?.kind !== context.operation || record.request.project?.id !== record.run.projectId || record.request.workflow?.id !== record.run.workflowId) return undefined;
  return { version: 1, adapter: ADAPTER, source: 'verified-legacy-adapter', providerId: 'openai', protocol: 'openai-responses', modelId: context.modelId, operation: context.operation,
    cache: { ttl: '30m', source: 'documented-default', breakpoints: false } };
}
function completeBillingUsage(usage, snapshot, context, rule) {
  const result = { ...usage };
  if (!snapshot || !rule || !officialResponses(context) || !DEFAULT_CACHE_MODELS.has(context.modelId)) return result;
  if (snapshot.version !== 1 || snapshot.adapter !== ADAPTER || !['adapter-request', 'verified-legacy-adapter'].includes(snapshot.source) || snapshot.providerId !== 'openai' || snapshot.protocol !== 'openai-responses' || snapshot.modelId !== context.modelId || snapshot.operation !== context.operation) return result;
  if (snapshot.cache?.ttl !== '30m' || snapshot.cache?.source !== 'documented-default' || snapshot.cache?.breakpoints !== false || rule.rule?.scheme !== 'tokens' || rule.rule?.modelId !== context.modelId || rule.rule?.rates?.cacheWrite30m === undefined || rule.rule?.rates?.cacheWrite12h === undefined) return result;
  const durations = ['cacheWrite5mTokens', 'cacheWrite1hTokens', 'cacheWrite30mTokens', 'cacheWrite12hTokens'];
  if (!count(result.cacheWriteInputTokens) || !result.cacheWriteInputTokens || durations.some(field => result[field] !== undefined)) return result;
  result.cacheWrite30mTokens = result.cacheWriteInputTokens; result.cacheWrite12hTokens = 0;
  result.usageSource = 'provider-reported+request-shape-default';
  return result;
}
module.exports = { createBillingRequestSnapshot, recoverLegacyBillingRequest, completeBillingUsage };
