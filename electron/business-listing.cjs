const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { validateBusinessFormalArtifact, boundedEntry } = require('./business-formal.cjs');
const { imageType, rasterDimensions } = require('./image-output-formats.cjs');
const { validId } = require('./commerce-image-document.cjs');
const MAX_BYTES = 100 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const active = signal => { if (signal?.aborted) throw Object.assign(Error('上架包已取消，已有成品与费用保留。'), { name: 'AbortError' }); };
function publicName(value) {
  const extension = path.extname(value).slice(0, 12), stem = Array.from(path.basename(value, path.extname(value)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+|[. ]+$/g, '')).slice(0, 70).join('') || '作品';
  return `${stem}${extension}`;
}
async function createListingZip(input, loadModule = require) {
  if (!Array.isArray(input?.files) || !input.files.length || input.files.length > 128) throw Error('上架包文件数量无效。');
  const seen = new Set(); let size = 0; const JSZip = loadModule('jszip'), zip = new JSZip();
  for (const file of input.files) {
    if (typeof file.name !== 'string' || !/^(?:files|previews)\//.test(file.name) && !/^(?:README|LICENSE)[^/\\]*\.(?:txt|md)$/.test(file.name) || file.name.includes('\\') || file.name.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')) || seen.has(file.name.toLowerCase()) || !(file.buffer instanceof Uint8Array) || !file.buffer.length) throw Error('上架包文件名、路径或内容无效。');
    size += file.buffer.length; if (size > MAX_BYTES) throw Error('上架包超过100MB，请拆分素材后导出。'); seen.add(file.name.toLowerCase()); zip.file(file.name, file.buffer);
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE', streamFiles: true }); if (buffer.length > MAX_BYTES) throw Error('上架包超过100MB。'); return buffer;
}
function textLayer(text, name, x, y, width, height, maximum = 48, opacity = 1, color = '#17212B') {
  let fontSize = maximum;
  const lines = size => String(text).split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(Array.from(line).reduce((sum, char) => sum + (char.codePointAt(0) >= 0x2e80 ? 1.05 : .68), 0) * size / (width * .94))), 0);
  while (fontSize > 6 && lines(fontSize) * fontSize * 1.25 > height * .94) fontSize--;
  return { id: randomUUID(), type: 'text', name, text: String(text), x, y, width, height, fontSize, opacity, color, fontFamily: 'Microsoft YaHei', fontWeight: 'bold', align: 'center', visible: true, locked: false };
}
function pictureLayer(file, x, y, width, height) { return { id: randomUUID(), type: 'image', role: 'logo', artifactId: file.id, name: file.name, x, y, width, height, opacity: 1, visible: true, locked: false }; }
function fit(file, x, y, width, height) { const scale = Math.min(width / file.width, height / file.height); return pictureLayer(file, x + (width - file.width * scale) / 2, y + (height - file.height * scale) / 2, file.width * scale, file.height * scale); }
function createBusinessListing({ businessStore, workspaceStorage, artifactStore, commerceImages, cpuTasks, loadModule = require }) {
  let closing = false, quiescing = false, tail = Promise.resolve(); const jobs = new Set();
  async function generate(input, signal) {
    if (!input || ![input.workspaceId, input.orderId, input.projectId].every(validId) || !Array.isArray(input.artifactIds) || !input.artifactIds.length || input.artifactIds.length > 64 || new Set(input.artifactIds).size !== input.artifactIds.length || input.artifactIds.some(id => !validId(id))) throw Error('请选择当前制作单1–64份正式作品。');
    for (const key of ['title', 'description', 'licence', 'instructions', 'watermark']) if (typeof input[key] !== 'string' || input[key].length > (key === 'title' ? 120 : 12000)) throw Error('上架标题或说明过长，请简化后再导出。');
    if (!input.title.trim() || !input.licence.trim() || !input.instructions.trim()) throw Error('请填写上架标题、使用说明和真实授权范围。');
    const state = await businessStore.snapshot(input.workspaceId), order = state.orders.find(row => row.id === input.orderId);
    if (!order || order.sourceProjectId !== input.projectId || order.status === 'archived') throw Error('上架包不属于当前有效制作单或根项目。');
    await workspaceStorage.assertProject(input.projectId, input.workspaceId);
    const related = new Set([order.sourceProjectId, ...order.projectIds]), internal = new Set([...(order.referenceArtifactIds || []), ...state.products.filter(product => order.productIds.includes(product.id)).flatMap(product => product.referenceArtifactIds), ...order.tasks.filter(task => ['cutout', 'background'].includes(task.operation)).flatMap(task => task.artifactIds)]), formal = [], artifacts = [], previews = []; let bytes = 0;
    for (const id of input.artifactIds) {
      if (internal.has(id)) throw Error('原始参考图或内部蒙版／背景不能直接当作正式商品打包。');
      const file = await artifactStore.read(id); active(signal);
      if (!related.has(file.projectId)) throw Error('正式作品必须来自本制作单关联项目。');
      await workspaceStorage.assertProject(file.projectId, input.workspaceId); await validateBusinessFormalArtifact(file, { loadModule }); bytes += file.buffer.length; if (bytes > MAX_BYTES * .85) throw Error('正式作品合计超过85MB，请拆分后为样张与说明留出空间。'); formal.push(file);
    }
    const originalHashes = new Map(formal.map(file => [file.id, hash(file.buffer)])), runId = randomUUID();
    async function unchanged() { active(signal); const latest = await businessStore.snapshot(input.workspaceId), current = latest.orders.find(row => row.id === input.orderId); if (!current || current.factsRevision !== order.factsRevision || current.sourceProjectId !== order.sourceProjectId) throw Error('制作期间资料已变化，已生成样张保留，请按当前版本重新导出。'); for (const file of formal) { const actual = await artifactStore.read(file.id); if (hash(actual.buffer) !== originalHashes.get(file.id)) throw Error('正式文件已变化，未使用旧内容完成上架包。'); } }
    async function write(name, mimeType, buffer) { await unchanged(); const file = await artifactStore.write({ projectId: input.projectId, runId, name, mimeType, buffer, signal }); artifacts.push(file); return file; }
    const facts = [], archiveFiles = [], imageCandidates = [];
    for (const [index, file] of formal.entries()) {
      const filename = `${String(index + 1).padStart(3, '0')}-${publicName(file.name)}`; archiveFiles.push({ name: `files/${filename}`, buffer: file.buffer });
      if (file.kind === 'image') { const size = rasterDimensions(file.buffer); facts.push(`${filename}：${file.mimeType === 'image/svg+xml' ? '矢量画布' : '像素'} ${size.width}×${size.height}${file.mimeType === 'image/gif' ? '（正式文件保留动画，预览为静态样张）' : ''}`); if (imageCandidates.length < 6) imageCandidates.push(file); }
      else if (file.mimeType === 'application/json') { const value = JSON.parse(file.buffer.toString('utf8')); if (value.type === 'xuzuo-bead-document') facts.push(`${filename}：拼豆 ${value.pattern.columns}列×${value.pattern.rows}行，${require('./bead-pattern.runtime.cjs').beadTotals(value.pattern).beads}颗`); else if (value.type === 'xuzuo-bead-pattern') facts.push(`${filename}：拼豆 ${value.columns}列×${value.rows}行`); }
      else {
        facts.push(`${filename}：${file.mimeType}，${file.buffer.length}字节`);
        if (file.mimeType === 'application/zip') {
          const zip = await loadModule('jszip').loadAsync(file.buffer), entries = Object.values(zip.files).filter(entry => !entry.dir);
          for (const entry of entries) {
            const extension = path.posix.extname(entry.name).toLowerCase();
            if (imageCandidates.length < 6 && ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(extension)) { const buffer = await boundedEntry(entry, 32 * 1024 * 1024), type = imageType(buffer), size = rasterDimensions(buffer); facts.push(`${filename} / ${entry.name}：${type.mimeType === 'image/svg+xml' ? '矢量画布' : '像素'} ${size.width}×${size.height}`); imageCandidates.push({ buffer, mimeType: type.mimeType, name: entry.name, projectId: input.projectId }); }
            if (extension === '.json') { const value = JSON.parse((await boundedEntry(entry, 8 * 1024 * 1024)).toString('utf8')); if (value.type === 'xuzuo-bead-document') facts.push(`${filename} / ${entry.name}：拼豆 ${value.pattern.columns}列×${value.pattern.rows}行，${require('./bead-pattern.runtime.cjs').beadTotals(value.pattern).beads}颗`); }
          }
        }
      }
    }
    try {
      const images = [];
      for (const [index, candidate] of imageCandidates.entries()) {
        await unchanged(); if (!commerceImages?.rasterPreview || !commerceImages.compose) throw Error('当前后台不能制作实际上架样张，请更新应用。');
        const file = candidate.id ? candidate : await artifactStore.write({ projectId: input.projectId, runId, name: `上架内部套件预览-${index + 1}${path.posix.extname(candidate.name)}`, mimeType: candidate.mimeType, buffer: candidate.buffer, signal });
        const preview = await commerceImages.rasterPreview({ projectId: file.projectId, artifactId: file.id, signal }), proxy = await artifactStore.write({ projectId: input.projectId, runId, name: `上架内部预览源-${index + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(preview.buffer), signal });
        const size = rasterDimensions(Buffer.from(preview.buffer)); images.push({ id: proxy.id, name: file.name, width: size.width, height: size.height });
      }
      if (images.length) {
        const width = 1280, height = 960, watermark = input.watermark.trim() || '仅供预览 · 正式文件见交付包';
        const marks = () => [textLayer(watermark, '样张水印', 70, 430, 1140, 100, 48, .5), textLayer('预览样张 · 文件清单见说明', '预览说明', 48, 895, 1184, 40, 24, 1, '#687384')];
        const compose = async (title, layers) => {
          await unchanged(); const output = await commerceImages.compose({ projectId: input.projectId, sourceArtifactId: images[0].id, title, sizes: [{ width, height, label: '公开样张' }], layers, signal }); active(signal);
          const file = output.artifacts.find(file => file.mimeType === 'image/png'); if (!file) throw Error('上架预览没有返回实际PNG。'); previews.push(file); artifacts.push(file); return file;
        };
        const columns = images.length === 1 ? 1 : 2, rows = Math.ceil(images.length / columns), cellWidth = 1184 / columns, cellHeight = 700 / rows, grid = images.map((file, index) => fit(file, 48 + index % columns * cellWidth + 8, 140 + Math.floor(index / columns) * cellHeight + 8, cellWidth - 16, cellHeight - 16));
        await compose(`${input.title}-展示封面`, [textLayer(input.title, '上架标题', 48, 28, 1184, 98, 42), ...grid, ...marks()]);
        const first = images[0], scale = Math.max(1184 / first.width, 730 / first.height) * 1.6;
        await compose(`${input.title}-局部放大样张`, [textLayer('局部放大样张', '局部说明', 48, 28, 1184, 98, 38), pictureLayer(first, (width - first.width * scale) / 2, 130 + (730 - first.height * scale) / 2, first.width * scale, first.height * scale), ...marks()]);
      }
      const explanation = `标题：${input.title.trim()}\n\n商品描述\n${input.description.trim()}\n\n使用说明\n${input.instructions.trim()}\n\n实际文件规格\n${facts.join('\n')}\n\n目录说明\nfiles/ 为所选正式文件原字节；previews/ 为带水印的公开展示样张，不能替代正式文件。预览进行了本地排版或局部放大，不宣称增加原生细节。\n生成预览、排版、水印及打包未调用模型，已发生的API费用不会回退。\n`;
      const readme = await write(`${input.title}-README-上架说明.txt`, 'text/plain', Buffer.from(explanation)), licence = await write(`${input.title}-LICENSE-授权范围.txt`, 'text/plain', Buffer.from(input.licence.trim() + '\n'));
      archiveFiles.push({ name: 'README-上架说明.txt', buffer: Buffer.from(explanation) }, { name: 'LICENSE.txt', buffer: Buffer.from(input.licence.trim() + '\n') });
      for (const [index, file] of previews.entries()) { const actual = await artifactStore.read(file.id); archiveFiles.push({ name: `previews/${index + 1}-${publicName(actual.name)}`, buffer: actual.buffer }); }
      await unchanged(); const zip = cpuTasks ? await cpuTasks.run('business-listing-zip', { files: archiveFiles }, { signal }) : await createListingZip({ files: archiveFiles }, loadModule); active(signal);
      await write(`${input.title}-完整上架包.zip`, 'application/zip', Buffer.from(zip));
      return { artifacts, formalArtifactIds: formal.map(file => file.id), previewArtifactIds: previews.map(file => file.id), readmeArtifactId: readme.id, licenceArtifactId: licence.id };
    } catch (error) { error.artifacts = artifacts; throw error; }
  }
  const service = {
    export(input) { if (closing || quiescing) return Promise.reject(Error('上架包服务正在关闭。')); const controller = new AbortController(), job = { projectId: input?.projectId, controller }; const task = tail.then(() => generate(input, controller.signal)); tail = task.catch(() => undefined); job.task = task; jobs.add(job); void task.finally(() => jobs.delete(job)).catch(() => undefined); return task; },
    async cancel({ projectId }) { if (!validId(projectId)) throw Error('项目编号无效。'); const selected = [...jobs].filter(job => job.projectId === projectId); for (const job of selected) job.controller.abort(); await Promise.allSettled(selected.map(job => job.task)); },
    async drain() { while (jobs.size) await Promise.allSettled([...jobs].map(job => job.task)); },
    async prepareClose() { quiescing = true; try { for (const job of jobs) job.controller.abort(); await service.drain(); } finally { quiescing = false; } },
    async shutdown() { closing = true; for (const job of jobs) job.controller.abort(); await service.drain(); },
  };
  return service;
}
module.exports = { createBusinessListing, createListingZip, publicName };
