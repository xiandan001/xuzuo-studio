const { createContext, endpoint, failure, request, readLimited, raceSignal, normalizedUsage, safeId, ModelRuntimeError } = require('./provider-http.cjs');
const { reasoningRequestFields } = require('./reasoning-options.cjs');
const { createBillingRequestSnapshot } = require('./billing-request-shape.cjs');

const LIMIT = 2 * 1024 * 1024;
const INSTRUCTIONS = '你是序作工作台的对话助手。用清楚、自然的语言回答问题、讨论想法或帮助整理需求。根据上下文正常交流，不把每条消息强行变成自动化方案或JSON。你没有在此对话中执行制作、访问文件或联网搜索的工具，不声称已经执行这些操作。需要制作文件或图片时，可以建议用户点击“转为制作方案”。';

function prepareChat(input, messages) {
  const { connection, model, reasoningEffort } = input, protocol = connection.protocol;
  const instructions = input.mode === 'plan' ? require('./automation-planning.cjs').plannerPrompt(input.outputKind || 'image') : INSTRUCTIONS;
  const fields = reasoningRequestFields(connection, model, reasoningEffort), headers = { 'content-type': 'application/json' };
  let body, url;
  if (protocol === 'openai-responses') {
    url = endpoint(connection.baseUrl, 'responses');
    body = { model: model.modelId, instructions, input: messages, max_output_tokens: 8192, store: false, stream: true, ...fields };
  } else if (protocol === 'openai-chat') {
    url = endpoint(connection.baseUrl, 'chat/completions');
    body = { model: model.modelId, messages: [{ role: 'system', content: instructions }, ...messages], stream: true, stream_options: { include_usage: true }, [connection.providerId === 'openai' ? 'max_completion_tokens' : 'max_tokens']: 8192, ...fields };
    if (connection.providerId === 'openai') body.store = false;
    if (connection.providerId === 'minimax') body.reasoning_split = true;
  } else if (protocol === 'anthropic') {
    url = endpoint(connection.baseUrl, /\/v1\/?$/.test(connection.baseUrl) ? 'messages' : 'v1/messages');
    headers['anthropic-version'] = '2023-06-01';
    body = { model: model.modelId, system: instructions, messages, max_tokens: 8192, stream: true, ...fields };
  } else if (protocol === 'gemini') {
    const target = new URL(endpoint(connection.baseUrl, `models/${encodeURIComponent(model.modelId.replace(/^models\//, ''))}:streamGenerateContent`));
    target.searchParams.set('alt', 'sse'); url = target.toString();
    body = { systemInstruction: { parts: [{ text: instructions }] }, contents: messages.map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })), generationConfig: { maxOutputTokens: 8192, ...fields.generationConfig } };
  } else throw failure('UNSUPPORTED_PROTOCOL', '这个模型接口暂不支持普通聊天，请选择文字模型。');
  return { url, headers, body, billingRequestSnapshot: createBillingRequestSnapshot({ connection, model, kind: 'text' }, body) };
}

function createChatDecoder(protocol, context, onText) {
  let text = '', rawUsage = {}, stopReason, completed = false, refused = false;
  const clean = value => context.secret ? value.split(context.secret).join('[密钥已隐藏]') : value;
  function update(value, replace = false) {
    if (typeof value !== 'string' || !value) return;
    text = replace ? value : text + value;
    if (Buffer.byteLength(text, 'utf8') > LIMIT) throw failure('RESPONSE_TOO_LARGE', '回答超过读取上限，已保留可用片段。', context);
    onText?.(clean(text));
  }
  function usage() {
    const data = protocol === 'gemini' ? { usageMetadata: rawUsage } : protocol === 'anthropic' ? { type: 'message', usage: rawUsage } : { usage: rawUsage };
    return normalizedUsage(data, context);
  }
  function json(data) {
    if (!data || data.error) throw failure('PROVIDER_ERROR', '模型返回了错误，未自动重试。', context);
    context.providerRequestId ||= safeId(data.id || data.responseId, context.secret);
    rawUsage = data.usage || data.usageMetadata || rawUsage;
    if (protocol === 'openai-responses') {
      const messages = (data.output || []).filter(item => item.type === 'message');
      update(data.output_text || messages.flatMap(item => item.content || []).filter(part => part.type === 'output_text').map(part => part.text || '').join('\n'), true);
      refused ||= messages.some(item => (item.content || []).some(part => part.type === 'refusal'));
      completed = data.status === 'completed' && !(data.output || []).some(item => /_call$/.test(item.type || ''));
    } else if (protocol === 'openai-chat') {
      const choice = data.choices?.[0], message = choice?.message;
      update(typeof message?.content === 'string' ? message.content : (message?.content || []).filter(part => part.type === 'text').map(part => part.text || '').join('\n'), true);
      refused ||= Boolean(message?.refusal) || choice?.finish_reason === 'content_filter'; completed = choice?.finish_reason === 'stop';
    } else if (protocol === 'anthropic') {
      update((data.content || []).filter(part => part.type === 'text').map(part => part.text || '').join('\n'), true);
      refused ||= data.stop_reason === 'refusal'; completed = ['end_turn', 'stop_sequence'].includes(data.stop_reason);
    } else {
      const candidate = data.candidates?.[0];
      update((candidate?.content?.parts || []).filter(part => !part.thought).map(part => part.text || '').join(''), true);
      refused ||= Boolean(data.promptFeedback?.blockReason) || candidate?.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS'; completed = candidate?.finishReason === 'STOP';
    }
  }
  function event(data) {
    if (!data || data.error || data.type === 'error') throw failure('PROVIDER_ERROR', '模型流式返回中断，已保留返回片段与用量，未自动重试。', context);
    if (protocol === 'openai-responses') {
      context.providerRequestId ||= safeId(data.response?.id, context.secret);
      if (data.type === 'response.output_text.delta') update(data.delta);
      if (data.type === 'response.refusal.delta') refused = true;
      if (['response.completed', 'response.incomplete', 'response.failed'].includes(data.type)) {
        rawUsage = data.response?.usage || rawUsage;
        if (data.response) json(data.response);
        if (data.type !== 'response.completed') completed = false;
      }
    } else if (protocol === 'openai-chat') {
      const choice = data.choices?.[0]; context.providerRequestId ||= safeId(data.id, context.secret);
      if (data.usage) rawUsage = data.usage;
      if (choice?.delta?.refusal) refused = true;
      update(choice?.delta?.content);
      if (choice?.finish_reason) { stopReason = choice.finish_reason; completed = stopReason === 'stop'; refused ||= stopReason === 'content_filter'; }
    } else if (protocol === 'anthropic') {
      if (data.type === 'message_start') { context.providerRequestId ||= safeId(data.message?.id, context.secret); rawUsage = { ...rawUsage, ...data.message?.usage }; }
      if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') update(data.delta.text);
      if (data.type === 'message_delta') { rawUsage = { ...rawUsage, ...data.usage }; stopReason = data.delta?.stop_reason || stopReason; refused ||= stopReason === 'refusal'; }
      if (data.type === 'message_stop') completed = ['end_turn', 'stop_sequence'].includes(stopReason);
    } else {
      if (data.usageMetadata) rawUsage = data.usageMetadata;
      context.providerRequestId ||= safeId(data.responseId, context.secret);
      const candidate = data.candidates?.[0];
      update((candidate?.content?.parts || []).filter(part => !part.thought).map(part => part.text || '').join(''));
      refused ||= Boolean(data.promptFeedback?.blockReason) || candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason);
      if (candidate?.finishReason) completed = candidate.finishReason === 'STOP';
    }
  }
  function result() {
    const details = { usage: usage(), partialText: clean(text) };
    if (refused) throw failure('PROVIDER_REFUSAL', '模型拒绝了本次回答，已保留返回片段与用量。', context, details);
    if (!completed) throw failure('INCOMPLETE_OUTPUT', '回答未完整结束，已保留返回片段与用量；可重新发送，已有费用保留。', context, details);
    if (!text.trim()) throw failure('EMPTY_OUTPUT', '模型未返回可显示的回答，已有用量仍会记录。', context, details);
    return { text: clean(text), usage: usage(), providerRequestId: context.providerRequestId };
  }
  return { event, json, result, partial: () => ({ partialText: clean(text), usage: usage() }) };
}

async function consumeEvents(response, decoder, context) {
  const reader = response.body?.getReader?.();
  if (!reader) throw failure('INVALID_RESPONSE', '服务没有返回可读取的流式回答。', context);
  const utf8 = new TextDecoder(); let buffer = '', bytes = 0;
  const emit = value => {
    const raw = value.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!raw || raw.trim() === '[DONE]') return;
    let data; try { data = JSON.parse(raw); } catch { throw failure('INVALID_RESPONSE', '模型返回了无法识别的流式数据，已保留可用片段。', context); }
    decoder.event(data);
  };
  try {
    for (;;) {
      const item = await raceSignal(reader.read(), context);
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > LIMIT * 4) throw failure('RESPONSE_TOO_LARGE', '流式回答超过读取上限，已停止继续读取。', context);
      buffer += utf8.decode(item.value, { stream: true });
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) { emit(buffer.slice(0, boundary.index)); buffer = buffer.slice(boundary.index + boundary[0].length); }
      if (buffer.length > LIMIT) throw failure('RESPONSE_TOO_LARGE', '单个回答片段超过读取上限。', context);
    }
    buffer += utf8.decode(); if (buffer.trim()) emit(buffer);
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
}

async function executeChat(input, messages, { credentialStore, fetchImpl = fetch, signal, onText } = {}) {
  const prepared = prepareChat(input, messages), context = createContext(signal), decoder = createChatDecoder(input.connection.protocol, context, onText);
  try {
    return await credentialStore.withSecret(input.credentialId, input.connection.id, async secret => {
      if (typeof secret !== 'string' || !secret.trim()) throw failure('INVALID_CREDENTIAL', '所选账户没有可用 Key，请在模型设置中重新录入。', context);
      context.secret = secret;
      const headers = { ...prepared.headers };
      if (input.connection.protocol === 'anthropic') headers['x-api-key'] = secret;
      else if (input.connection.protocol === 'gemini') headers['x-goog-api-key'] = secret;
      else headers.authorization = `Bearer ${secret}`;
      try {
        const response = await request(fetchImpl, prepared.url, { method: 'POST', headers, body: JSON.stringify(prepared.body) }, context);
        if (/text\/event-stream/i.test(response.headers?.get('content-type') || '')) await consumeEvents(response, decoder, context);
        else { let data; try { data = JSON.parse((await readLimited(response, LIMIT, context)).toString('utf8')); } catch (error) { if (error instanceof ModelRuntimeError) throw error; throw failure('INVALID_RESPONSE', '模型没有返回有效的回答数据。', context); } decoder.json(data); }
        return { ...decoder.result(), billingRequestSnapshot: prepared.billingRequestSnapshot, requestStarted: context.requestStarted };
      } catch (cause) {
        const error = cause instanceof ModelRuntimeError ? cause : failure('NETWORK_ERROR', '回答读取中断，已保留返回片段，未自动重试。', context);
        const partial = decoder.partial(); error.partialText ??= partial.partialText; error.usage = { ...partial.usage, ...error.usage };
        error.billingRequestSnapshot = prepared.billingRequestSnapshot; error.requestStarted = context.requestStarted; error.providerRequestId ||= context.providerRequestId;
        throw error;
      }
    });
  } catch (cause) {
    if (cause instanceof ModelRuntimeError) throw cause;
    throw failure('INVALID_CREDENTIAL', '无法读取所选账户的本地Key，请在模型设置中检查账户。', context);
  } finally { context.cleanup(); }
}

module.exports = { executeChat, prepareChat, createChatDecoder, consumeEvents };
