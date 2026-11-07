const { createHash } = require('node:crypto');
const { imageType, rasterDimensions } = require('./image-output-formats.cjs');
const { wallpaperTargetError } = require('./wallpaper-export.cjs');
const core = require('./bead-pattern.runtime.cjs');
const { imageDeliveryChecks } = require('./delivery-quality.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
function hashBeadGrid(pattern) {
  const palette = pattern.palette;
  return hash(JSON.stringify({ type: pattern.type, version: pattern.version, columns: pattern.columns, rows: pattern.rows, palette: { id: palette.id, name: palette.name, brand: palette.brand, version: palette.version, sourceUrl: palette.sourceUrl, sourceNote: palette.sourceNote, license: palette.license, colors: palette.colors.map(color => ({ code: color.code, name: color.name, hex: color.hex.toUpperCase(), rgb: [...color.rgb], kind: color.kind, automatic: color.automatic })) }, cells: [...pattern.cells] }));
}
function beadStateHash(document) {
  const settings = document.settings, procurement = document.procurement;
  const sorted = value => Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en'));
  return hash(JSON.stringify({ title: document.title.trim(), grid: hashBeadGrid(document.pattern), settings: [settings.columns, settings.rows, settings.fit, settings.maxColors, settings.alphaThreshold, settings.boardColumns, settings.boardRows], procurement: [procurement.copies, procurement.lossPercent, procurement.defaultPackSize, sorted(procurement.stock), sorted(procurement.packSizes)] }));
}
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const baseMime = value => typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : '';
const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const allowedBeadMime = new Set(['image/png', 'application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/json', 'application/zip', 'text/plain', 'text/markdown']);
const check = (id, label, status, detail) => ({ id, label, status, detail });
function failure(message) { return Error(`${message} 已有文件和费用保留，请重新检查当前版本。`); }

function createLocalImageProof({ artifactStore, readBeadDocument }) {
  async function filesFor(input) {
    if (!validId(input.projectId) || !validId(input.runId) || !Array.isArray(input.artifacts) || !input.artifacts.length || input.artifacts.length > 20) throw failure('本地成品记录无效。');
    const seen = new Set(), files = [], originals = new Map(); let total = 0;
    for (const artifact of input.artifacts) {
      if (!artifact || !validId(artifact.id) || seen.has(artifact.id)) throw failure('本地成品编号无效或重复。'); seen.add(artifact.id);
      const file = await artifactStore.read(artifact.id);
      if (file.projectId !== input.projectId || file.runId !== input.runId || file.trashedAt || file.unavailable || file.mimeType !== artifact.mimeType || !Buffer.isBuffer(file.buffer) || !file.buffer.length) throw failure('本地成品类型、项目或制作来源不一致。');
      total += file.buffer.length; if (total > 100 * 1024 * 1024) throw failure('本地交付文件超过100MB。');
      files.push({ id: file.id, name: file.name, mimeType: file.mimeType, bytes: file.buffer.length, sha256: hash(file.buffer) }); originals.set(file.id, file);
    }
    return { files, originals };
  }
  async function validate(input) {
    if (!input || (input.beadExport !== undefined) === (input.wallpaperExport !== undefined)) throw failure('需要明确且唯一的本地图像来源证明。');
    const { files, originals } = await filesFor(input);
    if (input.beadExport !== undefined) {
      const source = input.beadExport;
      if (!source || !validId(source.documentId) || !validId(source.sourceArtifactId) || !Number.isSafeInteger(source.revision) || source.revision < 1 || !fingerprint(source.gridSha256)) throw failure('拼豆版本来源无效。');
      const canonical = originals.get(source.sourceArtifactId);
      if (!canonical || baseMime(canonical.mimeType) !== 'application/json' || canonical.buffer.length > 4 * 1024 * 1024) throw failure('缺少此版本的自含拼豆工程文件。');
      let document;
      try { document = JSON.parse(canonical.buffer.toString('utf8')); } catch { throw failure('拼豆工程文件无法读取。'); }
      const issue = core.beadDocumentIssue(document); if (issue) throw failure(issue);
      if (document.projectId !== input.projectId || document.id !== source.documentId || document.revision !== source.revision || hashBeadGrid(document.pattern) !== source.gridSha256) throw failure('拼豆工程、格子内容和导出版本不一致。');
      const current = typeof readBeadDocument === 'function' ? await readBeadDocument(input.projectId) : undefined;
      if (!current || core.beadDocumentIssue(current) || current.id !== source.documentId || current.projectId !== input.projectId || current.revision !== source.revision || hashBeadGrid(current.pattern) !== source.gridSha256 || beadStateHash(current) !== beadStateHash(document)) throw failure('当前拼豆图纸或采购设置已有未匹配的保存内容。');
      const totals = core.beadTotals(document.pattern); if (!totals.beads || totals.beads + totals.emptyCells !== totals.totalCells) throw failure('拼豆图纸为空或统计不守恒。');
      const pngs = files.filter(file => baseMime(file.mimeType) === 'image/png'); if (!pngs.length) throw failure('缺少可核验的拼豆预览成品。');
      for (const file of files) {
        if (!allowedBeadMime.has(baseMime(file.mimeType))) throw failure('拼豆套件包含不支持的文件类型。');
        if (baseMime(file.mimeType) !== 'image/png') continue;
        const bytes = originals.get(file.id).buffer, size = rasterDimensions(bytes), scale = size.width / document.pattern.columns;
        if (imageType(bytes).mimeType !== 'image/png' || !Number.isInteger(scale) || scale < 1 || size.width > 4096 || size.height > 4096 || size.height !== document.pattern.rows * scale) throw failure('拼豆预览画布与实际网格尺寸不一致。');
      }
      return { proof: { version: 1, kind: 'bead', projectId: input.projectId, runId: input.runId, files, beadExport: structuredClone(source) }, sourceRevision: source.revision, beadDocument: document, summary: `拼豆图纸 ${document.pattern.columns}×${document.pattern.rows}，${totals.beads}颗珠子，${totals.colorsUsed}色；本地制图未调用模型。` };
    }
    const source = input.wallpaperExport;
    if (!source || !validId(source.sourceArtifactId) || !fingerprint(source.sourceSha256) || wallpaperTargetError(source.target) || ![[2160, 3840], [3840, 2160]].some(([width, height]) => source.target.width === width && source.target.height === height)) throw failure('4K来源或真实目标尺寸无效。');
    const original = await artifactStore.read(source.sourceArtifactId);
    if (original.projectId !== input.projectId || original.mimeType !== 'image/png' || original.trashedAt || original.unavailable || !Buffer.isBuffer(original.buffer) || imageType(original.buffer).mimeType !== 'image/png' || hash(original.buffer) !== source.sourceSha256) throw failure('4K适配的原文件已改变或不可读取。');
    if (files.length !== 1 || files[0].mimeType !== 'image/png' || files[0].id === original.id) throw failure('4K成品必须是另存的新PNG文件。');
    const size = rasterDimensions(originals.get(files[0].id).buffer);
    if (imageType(originals.get(files[0].id).buffer).mimeType !== 'image/png' || size.width !== source.target.width || size.height !== source.target.height) throw failure('4K成品实际像素不符合目标。');
    return { proof: { version: 1, kind: 'wallpaper-4k', projectId: input.projectId, runId: input.runId, files, wallpaperExport: structuredClone(source) }, sourceRevision: 1, summary: `本地4K适配 ${size.width}×${size.height}，未调用模型；分辨率适配不代表模型原生细节提升。` };
  }
  async function inspect(run, selectedIds = []) {
    const proof = run?.localImageProof, attempt = run?.attempts?.[0];
    if (!proof || proof.version !== 1 || !['bead', 'wallpaper-4k'].includes(proof.kind) || proof.runId !== run.id || proof.projectId !== run.projectId || run.mode !== 'live' || run.status !== 'complete' || run.snapshot?.outputKind !== 'image' || !Array.isArray(run.snapshot.steps) || run.snapshot.steps.length !== 1 || run.snapshot.steps[0]?.kind !== 'export' || !Array.isArray(run.attempts) || run.attempts.length !== 1 || attempt.status !== 'complete' || attempt.costState !== 'not-incurred' || attempt.costCents !== 0 || attempt.usage || attempt.calculation || !Array.isArray(proof.files) || !proof.files.length) throw failure('本地交付记录不完整。');
    for (const file of proof.files) if (!file || !validId(file.id) || typeof file.name !== 'string' || typeof file.mimeType !== 'string' || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || !fingerprint(file.sha256)) throw failure('本地交付校验记录无效。');
    const fresh = await validate({ projectId: run.projectId, runId: run.id, artifacts: attempt.artifacts, ...(proof.kind === 'bead' ? { beadExport: proof.beadExport } : { wallpaperExport: proof.wallpaperExport }) });
    if (!Array.isArray(proof.files) || fresh.proof.files.length !== proof.files.length || fresh.proof.files.some(file => !proof.files.some(saved => saved.id === file.id && saved.name === file.name && saved.mimeType === file.mimeType && saved.bytes === file.bytes && saved.sha256 === file.sha256))) throw failure('交付文件与登记时的校验值不一致。');
    if (!Array.isArray(selectedIds) || selectedIds.length > 20) throw failure('请选择当前版本的成品。');
    const selected = selectedIds.length ? selectedIds : proof.files.map(file => file.id), unique = new Set();
    for (const id of selected) { if (!validId(id) || unique.has(id) || !proof.files.some(file => file.id === id)) throw failure('所选文件不属于本次本地成品。'); unique.add(id); }
    const files = proof.files.filter(file => unique.has(file.id));
    let checks, title, revision;
    if (proof.kind === 'bead') {
      const document = fresh.beadDocument, totals = core.beadTotals(document.pattern), usage = core.beadUsage(document.pattern, document.procurement);
      const full = ['image/png', 'application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/json'].every(mime => files.some(file => baseMime(file.mimeType) === mime));
      title = document.title; revision = `bead:${document.id}:${document.revision}:${proof.beadExport.gridSha256}`;
      checks = [check('bead-grid', '图纸格子与色号完整', 'passed', `${document.pattern.columns}×${document.pattern.rows}格，${totals.beads}颗，空格${totals.emptyCells}。`), check('bead-colors', '色卡来源和版本明确', 'passed', `${document.pattern.palette.name} · ${document.pattern.palette.version}`), check('bead-usage', '用量与采购由当前网格计算', 'passed', `${usage.length}种实物珠，份数${document.procurement.copies}，库存和包装按当前保存设置计算。`), check('bead-package', '当前版本的完整图纸套件', full ? 'passed' : 'unknown', full ? 'PNG、打印PDF、用量CSV、采购XLSX和工程JSON来自同一保存版本。' : '当前为部分文件，请使用“导出整套”补齐该保存版本。'), check('bead-appearance', '原图与成品形象、细节已查看', 'manual', '对照原图检查主体识别、轮廓、用色和需要手动保留的细节。'), check('bead-print', '打印图纸与采购设置已核对', 'manual', '检查分块行列、色号图例、库存与包装粒数，确认可以照图制作。'), check('rights', '素材来源与使用范围已核对', 'manual', '确认本次原图、图案与素材适合预期交付用途。')];
    } else {
      title = run.workflowName || '4K壁纸'; revision = `local-wallpaper:${run.id}`;
      const target = proof.wallpaperExport.target;
      checks = imageDeliveryChecks({ width: target.width, height: target.height, artifactAvailable: true, mimeType: 'image/png', expectedSize: `${target.width}x${target.height}` });
    }
    return { projectId: run.projectId, kind: 'image', title, revision, sourceHash: hash(JSON.stringify(proof)), files, checks, errors: [] };
  }
  return { validate, inspect };
}
module.exports = { createLocalImageProof, hashBeadGrid };
