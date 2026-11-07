const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createBeadStore } = require('./bead-store.cjs');
const { createBeadSource, validId, ensureBeadActive, raceBeadAbort } = require('./bead-source.cjs');
const { checkedBeadDocument } = require('./bead-document.cjs');
const { imageType, rasterDimensions } = require('./image-output-formats.cjs');
const { checkedDirectory } = require('./workspace-paths.cjs');
const FORMATS = ['png', 'pdf', 'csv', 'xlsx', 'json', 'bundle'];
const MIME = { png: 'image/png', pdf: 'application/pdf', csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', json: 'application/json', bundle: 'application/zip' };
const SUFFIX = { png: '拼豆预览', pdf: '色号图纸', csv: '用量采购', xlsx: '用量采购', json: '拼豆工程', bundle: '拼豆完整套件' };
const hash = value => createHash('sha256').update(value).digest('hex');
function createBeadService({ workspaceStorage, artifactStore, nativeImage, cpuTasks, dialog, getWindow = () => undefined, printPdf, store: providedStore, onExport, onChanged, fileSystem = fs }) {
  const store = providedStore || createBeadStore({ workspaceStorage, fileSystem }), sources = createBeadSource({ artifactStore, nativeImage }), jobs = new Set(), cancelling = new Map(); let closing = false, quiescing = false;
  const core = () => require('./bead-pattern.runtime.cjs');
  function operation(input, action, { recovery = false } = {}) {
    const projectId = input?.projectId;
    if (!validId(projectId)) return Promise.reject(Error('请选择有效的拼豆项目。'));
    if ((!recovery && (closing || quiescing)) || cancelling.has(projectId)) return Promise.reject(Error('拼豆任务正在取消或关闭，请稍后再试。'));
    const controller = new AbortController(), job = { projectId, controller };
    const pending = Promise.resolve().then(async () => { if (!recovery) await workspaceStorage.projectDirectory(projectId); ensureBeadActive(controller.signal); return action(controller.signal); });
    job.pending = pending; jobs.add(job); void pending.finally(() => jobs.delete(job)).catch(() => undefined); return pending;
  }
  async function chosenJson(projectId, title, signal) {
    const result = await raceBeadAbort(dialog.showOpenDialog(getWindow(), { title, properties: ['openFile'], filters: [{ name: 'JSON文件', extensions: ['json'] }] }), signal);
    ensureBeadActive(signal); if (result.canceled || !result.filePaths?.length) return undefined;
    const filename = result.filePaths[0]; if (!path.isAbsolute(filename)) throw Error('请选择本机JSON文件。');
    const before = await fileSystem.stat(filename); if (!before.isFile() || before.size > 8 * 1024 * 1024) throw Error('JSON文件必须是8MB以内的普通文件。');
    const bytes = await raceBeadAbort(fileSystem.readFile(filename), signal), after = await fileSystem.stat(filename);
    if (bytes.length > 8 * 1024 * 1024 || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== before.size) throw Error('读取期间JSON文件已变化，请重新选择。');
    ensureBeadActive(signal); await workspaceStorage.projectDirectory(projectId);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); } catch { throw Error('JSON需要有效UTF-8编码，原文件没有改动。'); }
  }
  const worker = (task, input, signal) => raceBeadAbort(cpuTasks.run(task, input, { signal }), signal);
  async function recoveryJson(input, signal) {
    const document = checkedBeadDocument(input.document); if (document.projectId !== input.projectId) throw Error('恢复JSON不属于当前手绘项目，未写入文件。');
    const stem = Array.from(document.title).slice(0, 38).join('').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'), stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const picked = await raceBeadAbort(dialog.showSaveDialog(getWindow(), { title: '导出当前手绘恢复JSON', defaultPath: `${stem}-恢复-${stamp}.json`, filters: [{ name: '拼豆工程JSON', extensions: ['json'] }] }), signal);
    ensureBeadActive(signal); if (picked.canceled || !picked.filePath) return { saved: false };
    if (!path.isAbsolute(picked.filePath)) throw Error('请选择其他可用目录中的绝对文件路径。');
    let filename = path.resolve(picked.filePath); if (!path.extname(filename)) filename += '.json';
    if (path.extname(filename).toLowerCase() !== '.json' || filename.split(/[\\/]/).some(part => ['.xuzuo', '.xuzuo-assets'].includes(part.toLowerCase())) || path.basename(filename).startsWith('.xuzuo-')) throw Error('请选择普通JSON文件名，不能覆盖项目内部状态文件。');
    try { await checkedDirectory(fileSystem, path.dirname(filename)); } catch { throw Error('恢复目录不可用，请选择桌面或其他可写磁盘；当前手绘仍保留。'); } ensureBeadActive(signal);
    const buffer = Buffer.from(`${JSON.stringify(document, null, 2)}\n`); let handle;
    try { handle = await fileSystem.open(filename, 'wx'); } catch (error) { throw Error(error.code === 'EEXIST' ? '恢复文件已存在，请换一个名称；不会覆盖已有文件。' : '恢复位置无法写入，请选择其他可用目录；当前手绘仍保留。'); }
    try { await handle.writeFile(buffer); await handle.sync(); } finally { await handle.close(); }
    if (hash(await fileSystem.readFile(filename)) !== hash(buffer)) throw Error('恢复JSON未完整写入，请换其他目录；当前手绘仍保留。');
    return { saved: true, path: filename };
  }
  async function prepareClose() { quiescing = true; try { for (const job of jobs) job.controller.abort(); await Promise.allSettled([...jobs].map(job => job.pending)); await store.drain(); sources.clear(); } finally { quiescing = false; } }
  async function generate(input, signal) {
    const issue = core().beadSettingsIssue(input.settings) || core().beadPaletteIssue(input.palette) || core().beadProcurementIssue(input.procurement);
    if (issue) throw Error(issue);
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120) throw Error('请填写120字以内的拼豆图纸名称。');
    const previous = await store.read({ projectId: input.projectId });
    if (input.expectedRevision === undefined && previous) throw Error('当前项目已有图纸，请先读取最新版本再重新制图。');
    const expected = input.expectedRevision ?? 0;
    if (!Number.isSafeInteger(expected) || expected < 0 || expected !== (previous?.revision || 0)) throw Error('图纸版本已变化，请先读取最新图纸，未覆盖原稿。');
    const source = await raceBeadAbort(sources.read(input, signal), signal);
    const pattern = await worker('bead', { raster: source.raster, settings: input.settings, palette: input.palette }, signal);
    const currentSource = await raceBeadAbort(sources.read(input, signal), signal);
    if (source.preview.sourceSha256 !== currentSource.preview.sourceSha256) throw Error('底图已经变化，请重新制图，已保存版本未改变。');
    ensureBeadActive(signal);
    return store.save({ projectId: input.projectId, expectedRevision: expected, document: { type: 'xuzuo-bead-document', version: 1, id: previous?.id || randomUUID(), projectId: input.projectId, revision: expected, title: input.title.trim(), referenceId: input.referenceId, sourceSha256: source.preview.sourceSha256, settings: input.settings, pattern, procurement: input.procurement, updatedAt: new Date().toISOString() } }, signal);
  }
  async function exportDocument(input, signal) {
    if (!FORMATS.includes(input.format) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw Error('请选择有效的导出格式和已保存版本。');
    const document = await store.read({ projectId: input.projectId });
    if (!document || document.revision !== input.expectedRevision) throw Error('图纸尚未保存或保存版本已变化，请保存当前图纸后再导出。');
    const totals = core().beadTotals(document.pattern);
    if (!totals.beads && input.format !== 'json') throw Error('当前图纸没有实际珠子，不能导出空白商品图纸；可以保存JSON草稿。');
    if (totals.beads && typeof onExport !== 'function') throw Error('当前环境不能登记拼豆成品版本，请使用新版桌面应用；图纸仍已保存。');
    if (['pdf', 'bundle'].includes(input.format) && typeof printPdf !== 'function') throw Error('当前环境不能生成打印PDF，请使用新版桌面应用。');
    const serialized = `${JSON.stringify(checkedBeadDocument(document), null, 2)}\n`, identity = hash(JSON.stringify(document)), runId = randomUUID(), artifacts = [];
    async function current() { ensureBeadActive(signal); const latest = await store.read({ projectId: input.projectId }); if (!latest || hash(JSON.stringify(latest)) !== identity) throw Error('图纸已在另一处更新，请重新导出；之前生成的文件已保留。'); ensureBeadActive(signal); }
    function filename(format) { return `${Array.from(document.title).slice(0, 42).join('')}-v${document.revision}-${SUFFIX[format]}.${format === 'bundle' ? 'zip' : format}`; }
    async function write(format, bytes) {
      await current(); const buffer = Buffer.from(bytes); if (!buffer.length || buffer.length > 100 * 1024 * 1024) throw Error('导出文件为空或超过100MB，原图纸保留。');
      if (format === 'png') { const size = rasterDimensions(buffer); if (imageType(buffer).mimeType !== 'image/png' || size.width > 4096 || size.height > 4096) throw Error('拼豆PNG预览格式或尺寸无效，未保存为成品。'); }
      if (format === 'pdf' && buffer.toString('ascii', 0, 5) !== '%PDF-') throw Error('打印服务没有返回真实PDF。');
      if (['xlsx', 'bundle'].includes(format) && !buffer.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))) throw Error('本地打包没有返回有效的工作簿或ZIP文件。');
      const artifact = await artifactStore.write({ projectId: input.projectId, runId, name: filename(format), mimeType: MIME[format], buffer, signal });
      artifacts.push(artifact); onChanged?.(input.projectId); return artifact;
    }
    try {
      const output = await worker('bead-export', { document, format: input.format }, signal), source = await write('json', Buffer.from(serialized));
      let requested = input.format === 'json' ? source : undefined;
      const parts = input.format === 'bundle' ? output.parts : input.format === 'pdf' || input.format === 'json' ? [] : [output];
      let preview;
      for (const part of parts) {
        if (part.extension === 'json') continue;
        if (!['png', 'csv', 'xlsx'].includes(part.extension) || part.mimeType?.split(';')[0] !== MIME[part.extension] || !(part.buffer instanceof Uint8Array)) throw Error('本地导出返回了无效文件，原图纸保留。');
        const artifact = await write(part.extension, part.buffer); if (part.extension === 'png') preview = artifact; if (part.extension === input.format) requested = artifact;
      }
      if (totals.beads && !preview) { const png = await worker('bead-export', { document, format: 'png' }, signal); preview = await write('png', png.buffer); }
      if (input.format === 'pdf' || input.format === 'bundle') {
        const pdf = input.format === 'bundle' ? output.pdf : output;
        const buffer = await raceBeadAbort(printPdf(pdf, { signal }), signal), artifact = await write('pdf', buffer); if (input.format === 'pdf') requested = artifact;
      }
      if (input.format === 'bundle') {
        const partsToZip = [];
        for (const artifact of artifacts) { ensureBeadActive(signal); const file = await artifactStore.read(artifact.id); partsToZip.push({ name: artifact.name, buffer: file.buffer }); }
        const zip = await worker('bead-bundle', { parts: partsToZip, readme: output.readme, license: document.pattern.palette.license }, signal); requested = await write('bundle', zip);
      }
      await current();
      if (totals.beads) await onExport({ projectId: input.projectId, runId, document, artifacts, beadExport: { documentId: document.id, revision: document.revision, sourceArtifactId: source.id, gridSha256: require('./local-image-proof.cjs').hashBeadGrid(document.pattern) } });
      return { artifact: requested, artifacts, ...(totals.beads ? { exportRunId: runId, sourceRevision: document.revision } : {}) };
    } catch (error) { error.artifacts = artifacts; if (artifacts.length && error.name !== 'AbortError') error.message = `${error.message} 已生成的${artifacts.length}份文件仍保存在项目文件中；没有调用模型。`; throw error; }
  }
  return {
    source(input) { return operation(input, async signal => (await raceBeadAbort(sources.read(input, signal), signal)).preview); },
    read(input) { return operation(input, () => store.read(input)); },
    history(input) { return operation(input, () => store.history(input)); },
    restore(input) { return operation(input, signal => store.restore(input, signal)); },
    generate(input) { return operation(input, signal => generate(input, signal)); },
    save(input) { return operation(input, signal => store.save(input, signal)); },
    export(input) { return operation(input, signal => exportDocument(input, signal)); },
    exportRecovery(input) { return operation(input, signal => recoveryJson(input, signal), { recovery: true }); },
    importPalette(input) { return operation(input, async signal => { const text = await chosenJson(input.projectId, '导入拼豆色卡JSON', signal); return text === undefined ? undefined : require('./bead-palettes.runtime.cjs').parseBeadPalette(text); }); },
    importDocument(input) { return operation(input, async signal => { const baseline = await store.captureImport(input.projectId), text = await chosenJson(input.projectId, '导入拼豆工程JSON', signal); if (text === undefined) return undefined; let document; try { document = JSON.parse(text); } catch { throw Error('拼豆工程JSON无法解析，当前图纸未改变。'); } ensureBeadActive(signal); return store.importDocument(input.projectId, document, baseline, signal); }); },
    async cancel(input) { if (!validId(input?.projectId)) throw Error('拼豆项目编号无效。'); const projectId = input.projectId; cancelling.set(projectId, (cancelling.get(projectId) || 0) + 1); try { const found = [...jobs].filter(job => job.projectId === projectId); for (const job of found) job.controller.abort(); await Promise.allSettled(found.map(job => job.pending)); } finally { const count = cancelling.get(projectId) - 1; if (count) cancelling.set(projectId, count); else cancelling.delete(projectId); } },
    async shutdown() { closing = true; await prepareClose(); },
    prepareClose,
    drain: async () => { await Promise.allSettled([...jobs].map(job => job.pending)); await store.drain(); },
    store, sourceStats: sources.stats,
  };
}
module.exports = { createBeadService };
