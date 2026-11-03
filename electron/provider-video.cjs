const { ModelRuntimeError, endpoint, failure, checkedUrl, safeId, ensureActive, progress, readLimited, request: httpRequest, jsonRequest } = require('./provider-http.cjs');
const { combinedText, IMAGE_TYPES } = require('./provider-text.cjs');

const VIDEO_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const POLL_INTERVAL_MS = 5000;
const VIDEO_SIZES = new Set(['1280x720', '720x1280', '960x960']);

function boxes(bytes, start = 0, end = bytes.length) {
  const result = [];
  let offset = start;
  while (offset < end) {
    if (offset + 8 > end || result.length >= 4096) return null;
    let size = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return null;
      const extended = bytes.readBigUInt64BE(offset + 8);
      if (extended > BigInt(end - offset)) return null;
      size = Number(extended); header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) return null;
    result.push({ type, start: offset + header, end: offset + size });
    offset += size;
  }
  return result;
}

function inspectMp4(bytes, context) {
  const top = boxes(bytes);
  const ftyp = top?.find(box => box.type === 'ftyp');
  const moov = top?.find(box => box.type === 'moov');
  if (!top || !ftyp || ftyp.end - ftyp.start < 8 || !moov || !top.some(box => box.type === 'mdat' && box.end > box.start)) throw failure('INVALID_VIDEO', '供应商没有返回完整的 MP4 文件，未将本次视频生成标记为成功。', context);
  const movie = boxes(bytes, moov.start, moov.end)?.find(box => box.type === 'mvhd');
  if (!movie) return {};
  const size = movie.end - movie.start;
  const version = bytes[movie.start];
  let scale; let duration;
  if (version === 0 && size >= 20) { scale = bytes.readUInt32BE(movie.start + 12); const value = bytes.readUInt32BE(movie.start + 16); if (value !== 0xffffffff) duration = value; }
  if (version === 1 && size >= 32) { scale = bytes.readUInt32BE(movie.start + 20); const value = bytes.readBigUInt64BE(movie.start + 24); if (value <= BigInt(Number.MAX_SAFE_INTEGER)) duration = Number(value); }
  const seconds = scale > 0 && duration > 0 ? duration / scale : undefined;
  return typeof seconds === 'number' && Number.isFinite(seconds) ? { seconds } : {};
}

function waitForPoll(context) {
  ensureActive(context);
  return new Promise((resolve, reject) => {
    const cancelled = () => {
      clearTimeout(timer); context.signal.removeEventListener('abort', cancelled);
      try { ensureActive(context); } catch (error) { reject(error); }
    };
    const timer = setTimeout(() => { context.signal.removeEventListener('abort', cancelled); resolve(); }, POLL_INTERVAL_MS);
    context.signal.addEventListener('abort', cancelled, { once: true });
    if (context.signal.aborted) cancelled();
  });
}

function videoFields(request, files, context) {
  const prompt = combinedText(request, files);
  if (!prompt || prompt.length > 200_000) throw failure('INVALID_INPUT', '视频生成需要有效的文字描述，合并输入不能超过 200000 字符。', context);
  const size = request.options.size || '1280x720';
  if (!VIDEO_SIZES.has(size)) throw failure('INVALID_VIDEO_SIZE', '硅基流动视频尺寸需要为 1280x720、720x1280 或 960x960。', context);
  const images = files.filter(file => IMAGE_TYPES.has(file.mimeType));
  if (images.length > 1) throw failure('INVALID_VIDEO_REFERENCE', '本次视频步骤最多使用一张参考图，请先选择需要的一张。', context);
  if (/(?:^|[-/_])I2V(?:[-/_]|$)/i.test(request.model.modelId) && !images.length) throw failure('MISSING_IMAGE', '所选图生视频模型需要一张本机参考图。', context);
  const body = { model: request.model.modelId, prompt, image_size: size };
  if (images.length) body.image = `data:${images[0].mimeType};base64,${images[0].buffer.toString('base64')}`;
  return body;
}

async function executeVideo(request, files, context, fetchImpl, saveArtifact) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${context.secret}` };
  const resumedTask = Boolean(request.options.existingTaskId);
  const rawId = resumedTask ? request.options.existingTaskId : (await jsonRequest(fetchImpl, endpoint(request.connection.baseUrl, 'video/submit'), { method: 'POST', headers, body: JSON.stringify(videoFields(request, files, context)) }, context)).requestId;
  const jobId = safeId(rawId, context.secret);
  if (!jobId || jobId !== rawId) throw failure('INVALID_VIDEO_JOB', '视频提交没有返回有效任务编号；可能已经计费，请在供应商控制台核对。', context);
  context.providerRequestId = jobId;
  const usage = { providerRequestId: jobId };
  try {
    progress(context, 'receiving', `视频任务${resumedTask ? '恢复查询' : '已提交'}，请求 ID：${jobId}。正在查询状态，不会重复提交生成。`, { providerRequestId: jobId });
    for (;;) {
      ensureActive(context);
      const status = await jsonRequest(fetchImpl, endpoint(request.connection.baseUrl, 'video/status'), { method: 'POST', headers, body: JSON.stringify({ requestId: jobId }) }, context);
      context.providerRequestId = jobId;
      if (status.status === 'Failed') throw failure('VIDEO_GENERATION_FAILED', '供应商视频任务失败，请按任务编号核对原因与账单；未自动重新生成。', context, { usage });
      if (status.status === 'Succeed') {
        const videos = status.results?.videos;
        if (!Array.isArray(videos) || videos.length !== 1 || typeof videos[0]?.url !== 'string') throw failure('INVALID_VIDEO_RESULT', '视频任务完成，但没有返回一份有效的视频下载结果。', context, { usage });
        progress(context, 'receiving', `视频任务 ${jobId} 已完成，正在下载真实 MP4。`);
        const url = checkedUrl(videos[0].url);
        const response = await httpRequest(fetchImpl, url.toString(), { method: 'GET', headers: { accept: 'video/mp4,application/octet-stream' } }, context, false);
        const bytes = await readLimited(response, MAX_VIDEO_BYTES, context);
        Object.assign(usage, inspectMp4(bytes, context));
        progress(context, 'saving', '正在把真实 MP4 保存到本机文件库。');
        const artifact = await saveArtifact({ name: 'video.mp4', mimeType: 'video/mp4', buffer: bytes });
        return { text: '视频已生成并保存为本机 MP4 文件。', artifacts: [artifact], usage, resumedTask };
      }
      if (!['InQueue', 'InProgress'].includes(status.status)) throw failure('INVALID_VIDEO_STATUS', '供应商返回未知视频状态，已停止本地查询，请按任务编号核对。', context, { usage });
      progress(context, 'receiving', `视频任务 ${jobId} ${status.status === 'InQueue' ? '排队中' : '生成中'}；本地取消不会保证供应商停止计费。`);
      await waitForPoll(context);
    }
  } catch (error) {
    context.providerRequestId = jobId;
    if (error instanceof ModelRuntimeError) {
      error.providerRequestId = jobId; error.requestStarted = context.requestStarted; error.usage = { ...usage, ...error.usage, providerRequestId: jobId }; error.resumedTask = resumedTask;
      if (['CANCELLED', 'TIMEOUT'].includes(error.code)) error.message = `已停止本地视频查询${error.code === 'TIMEOUT' ? '（达到十分钟上限）' : ''}；供应商任务可能仍继续并计费，请按任务编号核对。`;
      throw error;
    }
    const errorResult = failure('VIDEO_EXECUTION_FAILED', '视频查询、下载或保存失败；任务可能已计费，请按任务编号核对，未自动重新提交。', context, { usage });
    errorResult.resumedTask = resumedTask; throw errorResult;
  }
}

module.exports = { executeVideo, inspectMp4, VIDEO_TIMEOUT_MS };
