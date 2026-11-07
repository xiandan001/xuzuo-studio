const { ModelRuntimeError, failure, checkedUrl, createContext, ensureActive, progress } = require('./provider-http.cjs');
const { executeText } = require('./provider-text.cjs');
const { executeImages, executeAudio } = require('./provider-media.cjs');
const { executeVideo, VIDEO_TIMEOUT_MS } = require('./provider-video.cjs');
const { createModelReceipts } = require('./model-receipts.cjs');
const { imageOptionsError } = require('./image-output-options.cjs');
const { imageType, rasterDimensions, validateMarkup } = require('./image-output-formats.cjs');

const TEXT_PROTOCOLS = new Set(['openai-chat', 'openai-responses', 'anthropic', 'gemini']);
const IMAGE_PROTOCOLS = new Set(['image', 'openai-chat', 'openai-responses']);
const AUDIO_PROTOCOLS = new Set(['audio', 'openai-chat', 'openai-responses']);
const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;

function supports(connection, kind) {
  if (!connection || connection.demo || connection.protocol === 'demo') return false;
  if (kind === 'text' || kind === 'vision') return TEXT_PROTOCOLS.has(connection.protocol);
  if (kind === 'image-generation' || kind === 'image-editing') return IMAGE_PROTOCOLS.has(connection.protocol);
  if (kind === 'speech' || kind === 'transcription') return AUDIO_PROTOCOLS.has(connection.protocol);
  if (kind === 'video-understanding') return connection.protocol === 'gemini';
  if (kind === 'video-generation') return connection.protocol === 'video' && connection.providerId === 'siliconflow';
  return false;
}

function validateRequest(request) {
  if (!request || !request.connection || !request.model || !request.credentialId || !request.runId || !request.projectId) throw failure('INVALID_REQUEST', '模型执行缺少连接、模型、凭证、流程或项目。');
  if (!supports(request.connection, request.kind)) throw failure('UNSUPPORTED_PROTOCOL', '当前协议或步骤还没有真实调用适配器，不能作为成功任务运行。');
  if (!request.connection.enabled || !request.model.enabled || request.model.connectionId !== request.connection.id) throw failure('DISABLED_CONFIGURATION', '连接或模型已停用，或模型不属于所选连接。');
  if (!Array.isArray(request.model.capabilities) || !request.model.capabilities.includes(request.kind)) throw failure('CAPABILITY_MISMATCH', '所选模型未声明此步骤需要的能力。');
  if (typeof request.model.modelId !== 'string' || !request.model.modelId.trim() || request.model.modelId.length > 240) throw failure('INVALID_MODEL', '请填写有效的真实模型 ID。');
  const url = checkedUrl(request.connection.baseUrl);
  if (url.search) throw failure('INVALID_ENDPOINT', 'Base URL 不能包含查询参数或 API Key。');
  for (const value of [request.prompt, request.input]) if (value !== undefined && (typeof value !== 'string' || value.length > 200_000)) throw failure('INVALID_INPUT', '模型输入需要是长度不超过 200000 字符的文字。');
  if (request.attachments !== undefined && (!Array.isArray(request.attachments) || request.attachments.length > 16)) throw failure('INVALID_ATTACHMENTS', '一次模型步骤最多使用 16 份附件。');
  const options = request.options || {};
  if (options.maxOutputTokens !== undefined && (!Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens < 1 || options.maxOutputTokens > 128_000)) throw failure('INVALID_OPTIONS', '输出 Token 上限必须是 1 到 128000 的整数。');
  if (options.count !== undefined && (!Number.isInteger(options.count) || options.count < 1 || options.count > 4)) throw failure('INVALID_OPTIONS', '单次图片生成数量需要是 1 到 4 的整数。');
  if (options.count > 1 && !['image-generation', 'image-editing'].includes(request.kind)) throw failure('INVALID_OPTIONS', '多份输出仅用于图片步骤，其他步骤请分别执行。');
  if (options.size !== undefined && (typeof options.size !== 'string' || !/^(auto|\d{2,5}x\d{2,5})$/.test(options.size))) throw failure('INVALID_OPTIONS', '图片尺寸需要为 auto 或 宽x高。');
  if (options.background !== undefined && !['auto', 'opaque', 'transparent'].includes(options.background)) throw failure('INVALID_OPTIONS', '图片背景配置无效。');
  const imageError = imageOptionsError(request.model.modelId, request.kind, options);
  if (imageError) throw failure('INVALID_OPTIONS', imageError);
  if (options.voice !== undefined && (typeof options.voice !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(options.voice))) throw failure('INVALID_OPTIONS', '语音名称格式无效。');
  if (options.existingTaskId !== undefined && (request.kind !== 'video-generation' || request.connection.protocol !== 'video' || request.connection.providerId !== 'siliconflow' || typeof options.existingTaskId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(options.existingTaskId))) throw failure('INVALID_OPTIONS', '恢复任务编号仅用于硅基流动视频状态查询。');
  return { ...request, prompt: request.prompt || '', input: request.input || '', attachments: request.attachments || [], options };
}

async function loadAttachments(request, artifactStore, context) {
  const files = [];
  let total = 0;
  for (const metadata of request.attachments) {
    ensureActive(context);
    if (!metadata || typeof metadata.id !== 'string' || !metadata.id) throw failure('INVALID_ATTACHMENTS', '附件引用无效，请重新选择本机文件。', context);
    if (metadata.id === request.options.markupArtifactId) continue;
    const file = await artifactStore.read(metadata.id);
    const buffer = Buffer.from(file.buffer);
    total += buffer.length;
    if (!buffer.length || buffer.length > MAX_ATTACHMENT_BYTES || total > 80 * 1024 * 1024) throw failure('ATTACHMENT_TOO_LARGE', '附件为空、单份超过 32 MB 或总大小超过 80 MB。', context);
    if (typeof file.mimeType !== 'string') throw failure('INVALID_ATTACHMENTS', '附件缺少可识别的文件类型。', context);
    files.push({ ...file, buffer, mimeType: file.mimeType.split(';')[0].toLowerCase(), name: typeof file.name === 'string' ? file.name : 'attachment' });
  }
  return files;
}

function referenceInputError(file, detail, context) {
  const name = typeof file?.name === 'string' ? file.name.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 160) : '未命名图片';
  return failure('INVALID_IMAGE_INPUT', `参考图“${name}”${detail} 请重新导入或在工作台重新准备该参考图；本次未向模型服务发送请求。`, context);
}
async function loadImageMarkup(request, files, artifactStore, context, normalizeRasterReference) {
  if (request.kind !== 'image-editing') return undefined;
  const blocked = files.find(file => ['image/gif', 'image/svg+xml'].includes(file.mimeType));
  if (blocked) throw referenceInputError(blocked, '不是静态 PNG/JPEG/WebP 原图。请先将 SVG 转为 PNG 参考；本应用生成的 GIF 请使用“继续修改动画”准备参考帧。', context);
  let total = files.reduce((sum, file) => sum + file.buffer.length, 0);
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    if (!file.mimeType.startsWith('image/')) continue;
    let actual;
    try { actual = imageType(file.buffer); } catch { /* A known raster with a wrong extension or harmless trailer can be prepared locally below. */ }
    if (actual && !['image/png', 'image/jpeg', 'image/webp'].includes(actual.mimeType)) throw referenceInputError(file, '实际为 SVG/GIF 或其他非静态格式，不能直接作为图片编辑输入。', context);
    if (actual?.mimeType === file.mimeType) continue;
    if (typeof normalizeRasterReference !== 'function') throw referenceInputError(file, '真实格式与文件名或登记类型不一致，或图片不完整。请使用新版应用本地准备为规范 PNG。', context);
    progress(context, 'preparing', `正在本地免费准备参考图“${file.name}”，此步骤不调用模型。`);
    let prepared;
    try { prepared = await normalizeRasterReference({ buffer: file.buffer, mimeType: file.mimeType }); }
    catch (cause) { throw referenceInputError(file, cause?.code === 'INVALID_IMAGE_INPUT' && typeof cause.message === 'string' ? cause.message : '无法完整解码为静态图片。', context); }
    ensureActive(context);
    const buffer = prepared?.buffer instanceof Uint8Array ? Buffer.from(prepared.buffer) : undefined;
    let dimensions;
    try {
      if (!buffer?.length || buffer.length > MAX_ATTACHMENT_BYTES || prepared.mimeType !== 'image/png' || imageType(buffer).mimeType !== 'image/png') throw Error('png');
      dimensions = rasterDimensions(buffer);
      if (dimensions.width !== prepared.width || dimensions.height !== prepared.height || dimensions.width * dimensions.height > 8000000) throw Error('dimensions');
    } catch { throw referenceInputError(file, '本地准备未返回完整且尺寸有效的 PNG。', context); }
    total += buffer.length - file.buffer.length;
    if (total > 80 * 1024 * 1024) throw referenceInputError(file, '准备后的参考图总量超过80MB，请减少参考数量或缩小图片。', context);
    files[index] = { ...file, buffer, bytes: buffer.length, mimeType: 'image/png', name: `${file.name.replace(/\.[^.]+$/, '')}.png` };
  }
  if (!request.options.markupArtifactId) return undefined;
  const source = files.find(file => ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType));
  if (!source || source.projectId !== request.projectId) throw failure('INVALID_MARKUP', '标注精修需要本项目的第一张PNG、JPEG或WebP原图。', context);
  let markup;
  try { markup = await artifactStore.read(request.options.markupArtifactId); } catch { throw failure('INVALID_MARKUP', '找不到所选标注图，请重新选择本项目的PNG标注图。', context); }
  ensureActive(context);
  if (markup.projectId !== request.projectId) throw failure('INVALID_MARKUP', '标注图必须属于当前项目，不能使用其他项目文件。', context);
  const buffer = Buffer.from(markup.buffer);
  if (!buffer.length || buffer.length > MAX_ATTACHMENT_BYTES) throw failure('INVALID_MARKUP', 'PNG标注图为空或超过32MB。', context);
  markup = { ...markup, buffer, mimeType: typeof markup.mimeType === 'string' ? markup.mimeType.split(';')[0].toLowerCase() : '', name: typeof markup.name === 'string' ? markup.name : 'markup.png' };
  try { await validateMarkup(markup, source); } catch (error) { throw failure('INVALID_MARKUP', error.message, context); }
  return markup;
}

function createModelRuntime({ credentialStore, artifactStore, fetchImpl = fetch, directory, getAvailableRuns, normalizeRasterReference }) {
  if (typeof credentialStore?.withSecret !== 'function' || typeof artifactStore?.read !== 'function' || typeof artifactStore?.write !== 'function' || typeof fetchImpl !== 'function') throw new TypeError('模型执行器缺少凭证库、文件库或网络接口。');

  async function execute(input, { signal, onProgress } = {}) {
    const request = validateRequest(input);
    const context = createContext(signal, onProgress, request.kind === 'video-generation' ? VIDEO_TIMEOUT_MS : undefined);
    try {
      ensureActive(context);
      const files = request.kind === 'video-generation' && request.options.existingTaskId ? [] : await loadAttachments(request, artifactStore, context);
      const markup = await loadImageMarkup(request, files, artifactStore, context, normalizeRasterReference);
      const saveArtifact = async value => { ensureActive(context); return artifactStore.write({ runId: request.runId, projectId: request.projectId, ...value }); };
      return await credentialStore.withSecret(request.credentialId, request.connection.id, async secret => {
        context.secret = secret;
        if (typeof secret !== 'string' || !secret.trim()) throw failure('INVALID_CREDENTIAL', '凭证不可用，请重新录入自己的 API Key。', context);
        let result;
        try {
          progress(context, 'requesting', '正在向所选模型服务发送真实请求。');
          if (['text', 'vision', 'video-understanding'].includes(request.kind)) {
            result = await executeText(request, files, context, fetchImpl);
            result.text = result.text.split(secret).join('[密钥已隐藏]');
            progress(context, 'saving', '正在保存真实模型文字结果。');
            result.artifacts = [await saveArtifact({ name: 'result.txt', mimeType: 'text/plain', text: result.text })];
          } else if (request.kind === 'video-generation') result = await executeVideo(request, files, context, fetchImpl, saveArtifact);
          else if (['image-generation', 'image-editing'].includes(request.kind)) result = await executeImages(request, files, context, fetchImpl, saveArtifact, markup);
          else result = await executeAudio(request, files, context, fetchImpl, saveArtifact);
          return { ...result, providerRequestId: context.providerRequestId };
        } catch (error) {
          const retained = error instanceof ModelRuntimeError ? error : context.signal.aborted ? failure(context.timedOut ? 'TIMEOUT' : 'CANCELLED', context.timedOut ? '模型请求超时，未自动重试；请核对供应商账单。' : '模型请求已取消，已经发生的供应商费用需核对。', context) : failure('EXECUTION_FAILED', '模型执行或结果保存失败，未自动重试；请检查本机文件与供应商账单。', context);
          retained.requestStarted = context.requestStarted;
          retained.providerRequestId ||= context.providerRequestId;
          if (result?.usage) retained.usage = { ...result.usage, ...retained.usage };
          if (result?.billingRequestSnapshot) retained.billingRequestSnapshot = result.billingRequestSnapshot;
          if (typeof result?.text === 'string') retained.partialText = result.text;
          if (result?.artifacts?.length && !retained.artifacts?.length) retained.artifacts = [...result.artifacts];
          if (typeof retained.partialText === 'string' && retained.partialText.trim() && !retained.artifacts?.length) {
            retained.partialText = retained.partialText.split(secret).join('[密钥已隐藏]');
            try { retained.artifacts = [await artifactStore.write({ name: '未完成结果.txt', mimeType: 'text/plain', text: retained.partialText, runId: request.runId, projectId: request.projectId })]; }
            catch { /* The error and available text remain in the workflow record when local storage fails. */ }
          }
          throw retained;
        } finally { context.secret = ''; }
      });
    } catch (error) {
      if (error instanceof ModelRuntimeError) throw error;
      throw failure('EXECUTION_FAILED', '无法读取本机附件、凭证或保存结果，请检查当前配置后重试。', context);
    } finally { context.cleanup(); }
  }

  const receipts = directory ? createModelReceipts({ directory, artifactStore }) : undefined;
  return {
    execute: receipts ? (input, options) => { const request = validateRequest(input); return receipts.execute(request, () => execute(input, options)); } : execute,
    recoverReceipt: receipts?.recoverReceipt,
    backupEntries: receipts ? async scope => receipts.backupEntries({ ...scope, availableRuns: scope?.availableRuns || await getAvailableRuns?.(scope.projectIds) }) : undefined,
    importEntries: receipts ? input => receipts.importEntries(input) : undefined,
    supports,
  };
}

module.exports = { createModelRuntime };
