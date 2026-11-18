const { createHash } = require('node:crypto');
const { ModelRuntimeError } = require('./provider-http.cjs');
const changed = () => new ModelRuntimeError('QUEUED_BINDING_CHANGED', '排队后的连接、型号或账户定义已更新。请带回输入框重新选择后明确发送；本次尚未请求模型。', { requestStarted: false });
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const signature = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function routing(input) {
  return { connection: { id: input.connection.id, providerId: input.connection.providerId, protocol: input.connection.protocol, baseUrl: input.connection.baseUrl?.trim().replace(/\/+$/, ''), enabled: input.connection.enabled }, model: { id: input.model.id, connectionId: input.model.connectionId, modelId: input.model.modelId, enabled: input.model.enabled, capabilities: [...input.model.capabilities].sort(), pricing: input.model.pricing } };
}
function queuedBindingFingerprint(input, context, checkedStart) {
  const connection = context?.connections?.find(item => item.id === input.connection.id), model = context?.models?.find(item => item.id === input.model.id), credential = context?.credentials?.find(item => item.id === input.credentialId);
  if (!connection || !model || !credential || !credential.enabled || credential.connectionId !== input.connection.id || typeof (credential.revision || credential.updatedAt) !== 'string' || !(credential.revision || credential.updatedAt)) throw changed();
  let current; try { current = checkedStart({ ...input, connection, model }); } catch { throw changed(); }
  if (signature(routing(current)) !== signature(routing(input))) throw changed();
  return signature({ routing: routing(current), credential: { id: credential.id, connectionId: credential.connectionId, enabled: credential.enabled, revision: credential.revision || credential.updatedAt, lastFour: credential.lastFour } });
}
module.exports = { changedQueuedBinding: changed, queuedBindingFingerprint };
