const { createHash } = require('node:crypto');
const { analyzeDeliveryArtifact, OFFICE } = require('./delivery-preflight-analysis.cjs');
const VERSION = 1, MAX_FILES = 20, MAX_TOTAL = 80 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const id = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
const aborted = signal => { if (signal.aborted) throw Error('已取消格式预检，文件和费用记录保持不变。'); };
const clone = value => JSON.parse(JSON.stringify(value));
function sourceMap(binding) {
  const document = binding?.document; let value;
  if (document?.kind === 'ppt') value = { pages: document.slides.slice(0, 200).map(page => ({ pageId: page.id, text: [page.title, page.body].filter(Boolean).join('\n').slice(0, 6000) })) };
  else if (document?.kind === 'word') value = { blocks: document.blocks.slice(0, 4000).filter(block => block.type !== 'image').map(block => ({ blockId: block.id, text: String(block.text || '').slice(0, 4000) })) };
  return value && JSON.stringify(value).length <= 256000 ? value : undefined;
}

function createDeliveryPreflight({ artifactStore, readDocumentArtifact, officePreview, runAnalysis, inspectPdf, loadModule = require } = {}) {
  if (!artifactStore?.read) throw Error('格式预检缺少文件读取能力。');
  let tail = Promise.resolve(), closed = false;
  const active = new Map(), cache = new Map(); let cacheBytes = 0;
  const preview = () => typeof officePreview === 'function' ? officePreview() : officePreview;
  function remember(key, value) {
    const bytes = Buffer.byteLength(JSON.stringify(value)); if (bytes > 512000) return;
    const old = cache.get(key); if (old) cacheBytes -= old.bytes;
    cache.delete(key); cache.set(key, { value: clone(value), bytes }); cacheBytes += bytes;
    while (cache.size > 8 || cacheBytes > 4 * 1024 * 1024) { const first = cache.keys().next().value; cacheBytes -= cache.get(first).bytes; cache.delete(first); }
  }
  async function currentFile(artifactId, projectId, signal) {
    aborted(signal); const file = await artifactStore.read(artifactId); aborted(signal);
    if (file.projectId !== projectId || file.trashedAt) throw Error('只能预检本项目当前可用的成品。');
    if (!Buffer.isBuffer(file.buffer)) file.buffer = Buffer.from(file.buffer || []);
    if (!file.buffer.length || file.buffer.length > 32 * 1024 * 1024) throw Error('单份成品为空或超过32MB，请拆分后预检。');
    const sha256 = digest(file.buffer); if (file.sha256 && file.sha256 !== sha256) throw Error('文件内容已改变，请重新导入或导出后预检。');
    return { ...file, sha256 };
  }
  async function execute(input, controller) {
    const signal = controller.signal, report = { version: VERSION, requestId: input.requestId, projectId: input.projectId, kind: input.kind, generatedAt: new Date().toISOString(), cached: true, files: [], checks: [], findings: [], rendered: { status: 'not-needed' } };
    let total = 0, rendered = false;
    for (const artifactId of input.artifactIds) {
      const file = await currentFile(artifactId, input.projectId, signal); total += file.buffer.length;
      if (total > MAX_TOTAL) throw Error('本次成品合计超过80MB，请分批预检。');
      if (!Object.values(OFFICE).includes(file.mimeType) && !file.mimeType.startsWith('image/')) throw Error('请选择Word、PPT、Excel或图片成品运行格式预检。');
      const metadata = { id: file.id, name: file.name, mimeType: file.mimeType, bytes: file.buffer.length, sha256: file.sha256 }; report.files.push(metadata);
      let binding;
      if (!file.mimeType.startsWith('image/') && readDocumentArtifact) { binding = await readDocumentArtifact(file); aborted(signal); }
      const expectedRevision = typeof input.sourceRevision === 'number' ? input.sourceRevision : /^\d+$/.test(input.sourceRevision || '') ? Number(input.sourceRevision) : undefined;
      if (expectedRevision !== undefined && binding?.sourceRevision !== undefined && binding.sourceRevision !== expectedRevision) throw Error('成品与所选编辑版本不一致，请导出当前版本后重新检查。');
      const location = { projectId: file.projectId, artifactId: file.id, sha256: file.sha256, ...(Number.isSafeInteger(binding?.sourceRevision) ? { sourceRevision: binding.sourceRevision } : {}) };
      const key = `${VERSION}|${file.sha256}|${digest(JSON.stringify(binding || {}))}`;
      let analysis = !input.refresh && cache.get(key)?.value;
      if (analysis) { remember(key, analysis); analysis = clone(analysis); }
      else {
        report.cached = false;
        try { analysis = runAnalysis ? await runAnalysis(file, binding, signal) : await analyzeDeliveryArtifact({ file, binding }, loadModule); aborted(signal); remember(key, analysis); }
        catch (error) { aborted(signal); analysis = { checks: [{ id: file.id + '-invalid', artifactId: file.id, label: '正式文件结构', status: 'issues', method: 'file', detail: error.message }], findings: [{ id: file.id + '-invalid', severity: 'error', label: '这份成品未通过文件检查', detail: error.message, method: 'file', target: location }] }; }
      }
      // Cached metadata is content based, but locations always belong to this exact artifact.
      analysis.checks = analysis.checks.map((check, index) => ({ ...check, id: file.id + '-check-' + index, artifactId: file.id }));
      analysis.findings = analysis.findings.map((finding, index) => ({ ...finding, id: file.id + '-finding-' + index, target: { ...finding.target, ...location } }));
      report.checks.push(...analysis.checks); report.findings.push(...analysis.findings);
      if ([OFFICE.word, OFFICE.ppt].includes(file.mimeType)) {
        const check = { id: file.id + '-actual-pagination', artifactId: file.id, label: '真实分页与可见文字', status: 'unverified', method: 'pdf', detail: '尚未获得实际分页，不能仅凭编辑画布认定排版正确。' };
        report.checks.push(check);
        const service = preview();
        let status; try { status = await service?.status(); } catch (error) { status = { available: false, reason: error.message }; }
        aborted(signal);
        if (!status?.available) { check.detail = status?.reason || '本机尚无可用的Office分页引擎；可继续使用交付功能，并在Word/WPS中检查。'; report.rendered = { status: 'unavailable', reason: check.detail }; }
        else if (rendered) { check.detail = '本轮已渲染一份Office文件；为控制内存，请单独选择此文件检查真实分页。'; report.rendered.status = 'partial'; }
        else if (!analysis.findings.some(finding => finding.severity === 'error' && finding.method === 'file')) {
          try {
            const pdf = await service.render({ artifactId: file.id, requestId: input.requestId, refresh: input.refresh }); aborted(signal);
            if (pdf.sourceSha256 !== file.sha256 || pdf.artifactId !== file.id || pdf.projectId !== file.projectId || typeof pdf.pdfBase64 !== 'string' || pdf.pdfBase64.length > 28 * 1024 * 1024) throw Error('分页预览与当前成品指纹不一致，未使用旧预览。');
            const buffer = Buffer.from(pdf.pdfBase64, 'base64'); if (!buffer.length || buffer.length > 20 * 1024 * 1024 || digest(buffer) !== pdf.pdfSha256 || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw Error('真实分页PDF未通过完整性检查。');
            const payload = { artifactId: file.id, name: file.name, sourceSha256: file.sha256, sourceRevision: binding?.sourceRevision, previewId: pdf.previewId, pdfSha256: pdf.pdfSha256, pdfBase64: pdf.pdfBase64, renderer: pdf.renderer, sourceMap: sourceMap(binding) };
            if (inspectPdf) { const inspected = await inspectPdf(payload, { signal, projectId: input.projectId }); aborted(signal); report.checks = report.checks.filter(item => item.id !== check.id).concat(inspected.checks); report.findings.push(...inspected.findings); }
            else report.pdfPreviews = [payload];
            rendered = true; report.rendered = { status: 'partial', engine: pdf.renderer, reason: '已生成真实分页PDF，正在等待客户端读取实际文字边界。' };
          } catch (error) { aborted(signal); check.detail = '真实分页未完成：' + error.message; report.rendered = { status: 'unavailable', reason: check.detail }; }
        }
      }
      const current = await currentFile(file.id, input.projectId, signal); if (current.sha256 !== file.sha256) throw Error('预检期间文件发生变化，请重新检查；原文件和费用记录未修改。');
    }
    aborted(signal); return report;
  }
  function preflight(input = {}) {
    if (closed) return Promise.reject(Error('应用正在退出，已停止新预检。'));
    if (!id(input.requestId) || !id(input.projectId) || !['word', 'ppt', 'excel', 'image'].includes(input.kind) || !Array.isArray(input.artifactIds) || !input.artifactIds.length || input.artifactIds.length > MAX_FILES || input.artifactIds.some(value => !id(value)) || new Set(input.artifactIds).size !== input.artifactIds.length) return Promise.reject(Error('请选择1–20份本项目成品后预检。'));
    if (active.has(input.requestId) || active.size >= 4) return Promise.reject(Error('已有格式预检在排队，请等待或取消后重试。'));
    const controller = new AbortController(); active.set(input.requestId, controller);
    const task = tail.then(() => execute({ ...input, artifactIds: [...input.artifactIds] }, controller));
    tail = task.catch(() => undefined); return task.finally(() => active.delete(input.requestId));
  }
  return { preflight, cancel({ requestId } = {}) { active.get(requestId)?.abort(); preview()?.cancel?.(requestId); }, async shutdown() { closed = true; for (const [requestId, controller] of active) { controller.abort(); preview()?.cancel?.(requestId); } await tail; cache.clear(); cacheBytes = 0; }, resume() { closed = false; }, drain: () => tail };
}
module.exports = { createDeliveryPreflight, VERSION };
