const fsDefault = require('node:fs/promises'), path = require('node:path'), { randomUUID, createHash } = require('node:crypto');
const { checkedDirectory, checkedFile, atomicJson } = require('./workspace-paths.cjs');
const { validateEditorDocument } = require('./editor-document.cjs');
const { validateSpreadsheetDocument } = require('./spreadsheet-engine.cjs');
const { editorFromText } = require('./editor-generated.cjs');
const { spreadsheetFromText } = require('./spreadsheet-generated.cjs');
const { assetProvenance } = require('./asset-provenance.cjs');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex'), kinds = new Set(['word', 'ppt', 'excel', 'image']);
const title = value => { if (typeof value !== 'string' || !value.trim() || value.length > 200 || value.includes('\0')) throw Error('请输入有效的模板或作品名称。'); return value.trim(); };
function settings(value = {}) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['content', 'assets', 'workflow', 'formulas'].includes(key)) || Object.values(value).some(item => typeof item !== 'boolean')) throw Error('模板保留选项无效。'); return { content: false, assets: false, workflow: false, formulas: false, ...value }; }
function imageIds(document) { return document?.kind === 'word' ? document.blocks.filter(row => row.type === 'image' && row.imageId).map(row => row.imageId) : document?.kind === 'ppt' ? document.slides.filter(row => row.imageId).map(row => row.imageId) : []; }
function emptyContent(input, retain, name) {
  if (!input) return undefined; const document = structuredClone(input); document.title = name;
  if (document.kind === 'word') for (const block of document.blocks) { block.id = randomUUID(); if (block.table) { for (const column of block.table.columns) column.id = randomUUID(); for (const row of block.table.rows) { row.id = randomUUID(); for (const cell of row.cells) cell.id = randomUUID(); } } if (!retain.content) { block.text = block.type === 'heading' ? '填写标题' : ''; if (block.table) for (const row of block.table.rows) for (const cell of row.cells) cell.text = ''; } if (!retain.assets && block.imageId) { delete block.imageId; block.type = 'paragraph'; } }
  if (document.kind === 'ppt') document.slides.forEach((slide, index) => { slide.id = randomUUID(); if (!retain.content) { slide.title = `第 ${index + 1} 页`; slide.body = ''; slide.notes = ''; } if (!retain.assets) delete slide.imageId; });
  if (document.kind === 'excel') { const names = new Map(document.sheets.map((sheet, index) => [sheet.name, `工作表${index + 1}`])); for (const sheet of document.sheets) { sheet.id = randomUUID(); if (!retain.content) sheet.name = names.get(sheet.name); delete sheet.view?.filter; delete sheet.view?.sort; for (const cell of Object.values(sheet.cells)) { if (!retain.content) cell.value = null; if (!retain.formulas) delete cell.formula; else if (cell.formula && !retain.content) { if (/\[|\]|https?:/i.test(cell.formula)) delete cell.formula; else for (const [before, after] of names) cell.formula = cell.formula.replaceAll(`'${before.replaceAll("'", "''")}'!`, `'${after}'!`).replaceAll(before + '!', after + '!'); } } } }
  return document.kind === 'excel' ? validateSpreadsheetDocument(document) : validateEditorDocument(document);
}
function portableWorkflow(source) {
  if (!source) return undefined;
  const allowed = ['text', 'vision', 'image-generation', 'image-editing', 'manual-review', 'export'];
  if (!kinds.has(source.outputKind) || !Array.isArray(source.steps) || !source.steps.length || source.steps.length > 40 || source.steps.some(step => !allowed.includes(step.kind) || typeof step.enabled !== 'boolean' || !['project', 'previous'].includes(step.inputSource) || step.role !== undefined && !['planner', 'producer', 'reviewer'].includes(step.role) || step.imageSize !== undefined && (typeof step.imageSize !== 'string' || !/^(auto|[1-9]\d{1,4}x[1-9]\d{1,4})$/.test(step.imageSize)) || step.imageBackground !== undefined && !['auto', 'opaque', 'transparent'].includes(step.imageBackground) || step.count !== undefined && (!Number.isSafeInteger(step.count) || step.count < 1 || step.count > 100) || step.maxOutputTokens !== undefined && (!Number.isSafeInteger(step.maxOutputTokens) || step.maxOutputTokens < 1 || step.maxOutputTokens > 1000000))) throw Error('该流程含专用工程步骤或无效参数，请在专用工作台保存模板；当前不会复制旧客户工程或Key。');
  return { name: '模板制作流程', description: '根据新项目需求制作，使用前重新选择当前模型与Key；不包含旧客户内容。', outputKind: source.outputKind, steps: source.steps.map((step, index) => ({ id: randomUUID(), name: `步骤 ${index + 1}`, kind: step.kind, role: step.role, prompt: ['manual-review', 'export'].includes(step.kind) ? '' : '根据本次新项目需求与已确认资料制作完整结果，不复用旧客户事实。', inputSource: step.inputSource, enabled: step.enabled, ...(step.imageSize ? { imageSize: step.imageSize } : {}), ...(step.imageBackground ? { imageBackground: step.imageBackground } : {}), ...(step.count ? { count: step.count } : {}), ...(step.maxOutputTokens ? { maxOutputTokens: step.maxOutputTokens } : {}) })) };
}
function checkedWorkflow(source) {
  if (!source) return;
  const clean = portableWorkflow(source);
  clean.steps.forEach((step, index) => { if (!validId(source.steps[index].id)) throw Error('模板步骤编号无效。'); step.id = source.steps[index].id; });
  return clean;
}
function checkedImageSettings(value) {
  if (value === undefined) return;
  if (!value || Object.keys(value).some(key => !['width', 'height', 'mimeType'].includes(key)) || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width < 1 || value.height < 1 || value.width > 100000 || value.height > 100000 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'].includes(value.mimeType)) throw Error('图片模板尺寸无效。');
  return { width: value.width, height: value.height, mimeType: value.mimeType };
}
function validateTemplate(value, workspaceId, id) {
  if (!value || Object.keys(value).some(key => !['version', 'id', 'workspaceId', 'name', 'kind', 'createdAt', 'retain', 'document', 'materials', 'sourceRevision', 'workflow', 'imageSettings'].includes(key)) || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || value.version !== 1 || value.workspaceId !== workspaceId || value.id !== id || !validId(id) || !kinds.has(value.kind) || !Array.isArray(value.materials) || value.materials.length > 20 || new Set(value.materials.map(file => file.id)).size !== value.materials.length || value.materials.some(file => !file || Object.keys(file).some(key => !['id', 'name', 'mimeType', 'bytes', 'sha256', 'fileName', 'provenance'].includes(key)) || !validId(file.id) || typeof file.name !== 'string' || file.name.length > 240 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'].includes(file.mimeType) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 32 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(file.sha256) || file.fileName !== `${id}-${file.id}.bin`)) throw Error('模板资料无效，原文件未覆盖。');
  title(value.name); value.retain = settings(value.retain);
  if (value.sourceRevision !== undefined && (!Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 1)) throw Error('模板来源版本无效。');
  if (value.document) { if (value.document.kind !== value.kind) throw Error('模板格式不一致。'); value.document = value.document.kind === 'excel' ? validateSpreadsheetDocument(value.document) : validateEditorDocument(value.document); }
  if (value.kind !== 'image' && !value.document) throw Error('模板缺少可编辑内容结构。');
  if (value.workflow) { value.workflow = checkedWorkflow(value.workflow); if (value.workflow.outputKind !== value.kind) throw Error('模板与流程的作品格式不一致。'); }
  if (value.imageSettings) value.imageSettings = checkedImageSettings(value.imageSettings);
  for (const material of value.materials) if (material.provenance) material.provenance = assetProvenance(material.provenance);
  if (value.materials.reduce((sum, item) => sum + item.bytes, 0) > 80 * 1024 * 1024) throw Error('模板素材超过80MB。');
  return value;
}
function createProjectTemplates({ directory, workspaceStorage, artifactStore, editorStore, spreadsheetStore, readDocumentArtifact, onCopied, fileSystem = fsDefault, loadModule = require } = {}) {
  const fs = fileSystem, root = path.join(path.resolve(directory), 'project-templates-v1'), queues = new Map();
  const serial = (key, action) => { const task = (queues.get(key) || Promise.resolve()).catch(() => undefined).then(action); queues.set(key, task); return task.finally(() => { if (queues.get(key) === task) queues.delete(key); }); };
  function scope(workspaceId, id) { if (!validId(workspaceId) || id !== undefined && !validId(id)) throw Error('模板或工作区编号无效。'); return path.join(root, workspaceId); }
  async function assertProject(workspaceId, projectId) { scope(workspaceId); if (!validId(projectId) || !(await workspaceStorage.list()).projects.some(project => project.workspaceId === workspaceId && project.projectId === projectId)) throw Error('项目不属于当前工作区或已不可用。'); }
  async function read(workspaceId, id) { const folder = scope(workspaceId, id), file = path.join(folder, id + '.json'); const stat = await checkedFile(fs, file); if (stat.size > 16 * 1024 * 1024) throw Error('模板超过16MB，请拆分。'); return checked(JSON.parse(await fs.readFile(file, 'utf8')), workspaceId, id); }
  const checked = validateTemplate;
  async function source(input, retain) {
    await assertProject(input.workspaceId, input.sourceProjectId); if (!kinds.has(input.kind)) throw Error('请选择有效作品格式。');
    let document, sourceRevision, imageSettings; const files = await artifactStore.listProject(input.sourceProjectId);
    if (input.sourceArtifactId) {
      const artifact = files.find(file => file.id === input.sourceArtifactId && !file.trashedAt && !file.unavailable); if (!artifact) throw Error('所选成品已不可用，请重新选择。');
      if (input.kind !== 'image') { const expected = { word: 'wordprocessingml', ppt: 'presentationml', excel: 'spreadsheetml' }[input.kind]; if (!artifact.mimeType.includes(expected)) throw Error('所选成品格式与模板类型不符。'); const result = await readDocumentArtifact?.(artifact); const text = typeof result === 'string' ? result : result?.text; if (!text) throw Error('这份历史成品没有可验证编辑源，不能用当前稿冒充它；请选择已保存的编辑版本。'); document = input.kind === 'excel' ? spreadsheetFromText(text, input.name) : editorFromText(input.kind, input.name, text); sourceRevision = result?.sourceRevision; }
    } else if (input.kind !== 'image') { const saved = await (input.kind === 'excel' ? spreadsheetStore.load({ projectId: input.sourceProjectId }) : editorStore.load({ projectId: input.sourceProjectId, kind: input.kind })); if (!saved) throw Error('项目还没有已保存的编辑源，请先保存当前版本。'); document = saved.document; sourceRevision = saved.revision; }
    if (input.kind === 'image') { const selected = input.sourceArtifactId ? files.find(file => file.id === input.sourceArtifactId) : files.find(file => file.kind === 'image' && !file.trashedAt && !file.unavailable); if (!selected || selected.kind !== 'image' || selected.trashedAt || selected.unavailable) throw Error('请先选择一份已保存的图片成品。'); const image = await artifactStore.read(selected.id); const dimensions = loadModule('image-size').imageSize(image.buffer); imageSettings = checkedImageSettings({ width: dimensions.width, height: dimensions.height, mimeType: image.mimeType }); }
    const needed = input.kind === 'image' ? retain.assets ? files.filter(file => file.kind === 'image' && !file.trashedAt && !file.unavailable && (!input.sourceArtifactId || file.id === input.sourceArtifactId)).slice(0, input.sourceArtifactId ? 1 : 20).map(file => file.id) : [] : retain.assets ? imageIds(document) : [];
    if (input.kind === 'image' && retain.assets && !needed.length) throw Error('尚无可复制的已保存图片，请先生成或选择成品。');
    const materials = [];
    for (const id of [...new Set(needed)]) { const file = await artifactStore.read(id); if (file.projectId !== input.sourceProjectId || file.trashedAt || !file.mimeType.startsWith('image/') || !file.buffer?.length || file.buffer.length > 32 * 1024 * 1024) throw Error('模板素材必须是当前项目中可用的图片，且不超过32MB。'); materials.push({ id, name: file.name, mimeType: file.mimeType, bytes: file.buffer.length, sha256: hash(file.buffer), ...(file.provenance ? { provenance: assetProvenance(file.provenance) } : {}), buffer: file.buffer }); }
    if (materials.reduce((sum, file) => sum + file.bytes, 0) > 80 * 1024 * 1024) throw Error('模板可复用素材合计最多80MB。');
    return { document: emptyContent(document, retain, input.name), materials, sourceRevision, ...(imageSettings ? { imageSettings } : {}), workflow: retain.workflow ? portableWorkflow(input.workflow) : undefined };
  }
  const info = value => ({ id: value.id, workspaceId: value.workspaceId, name: value.name, kind: value.kind, createdAt: value.createdAt, retain: value.retain, sourceRevision: value.sourceRevision, files: value.materials.length, ...(value.imageSettings ? { imageSettings: value.imageSettings } : {}) });
  async function save(input) { const retain = settings(input.retain), name = title(input.name), prepared = await source({ ...input, name }, retain), id = randomUUID(), folder = scope(input.workspaceId), files = path.join(folder, 'files'); await checkedDirectory(fs, files, true); if ((await fs.readdir(folder)).filter(item => /^[A-Za-z0-9-]+\.json$/.test(item)).length >= 200) throw Error('已保存200份模板，请移除不再使用的模板后再保存。'); const materials = [];
    try { for (const material of prepared.materials) { const fileName = id + '-' + material.id + '.bin'; await fs.writeFile(path.join(files, fileName), material.buffer, { flag: 'wx' }); const { buffer: _buffer, ...metadata } = material; materials.push({ ...metadata, fileName }); } const value = { version: 1, id, workspaceId: input.workspaceId, name, kind: input.kind, createdAt: new Date().toISOString(), retain, ...prepared, materials }; checked(value, input.workspaceId, id); await atomicJson(fs, path.join(folder, id + '.json'), value); return info(value); }
    catch (error) { for (const material of materials) await fs.unlink(path.join(files, material.fileName)).catch(() => undefined); throw error; }
  }
  async function instantiate(input) { await assertProject(input.workspaceId, input.targetProjectId); const name = title(input.name); if (!kinds.has(input.kind) || !['template', 'copy'].includes(input.mode) || input.sourceProjectId === input.targetProjectId) throw Error('请选择独立的新项目，原作品不会覆盖。');
    let prepared;
    if (input.templateId) { const saved = await read(input.workspaceId, input.templateId); if (saved.kind !== input.kind) throw Error('模板格式与新项目不一致。'); const materials = []; for (const file of saved.materials) { const filename = path.join(scope(input.workspaceId), 'files', saved.id + '-' + file.id + '.bin'); const stat = await checkedFile(fs, filename); if (stat.size !== file.bytes) throw Error('模板素材已变化，未创建空稿。'); const buffer = await fs.readFile(filename); if (hash(buffer) !== file.sha256) throw Error('模板素材校验失败。'); materials.push({ ...file, buffer }); } prepared = { ...saved, materials }; }
    else { if (input.mode !== 'copy') throw Error('请选择模板。'); prepared = await source({ ...input, name }, { content: true, assets: true, workflow: false, formulas: true }); }
    const fingerprint = hash(JSON.stringify([input.workspaceId, input.templateId || input.sourceProjectId, input.sourceArtifactId || '', input.mode, input.kind, name, prepared.sourceRevision, prepared.materials.map(file => [file.id, file.sha256])]));
    const receiptPath = path.join(root, 'copies', input.targetProjectId + '.json');
    let receipt; try { await checkedFile(fs, receiptPath); receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8')); if (receipt.fingerprint !== fingerprint || receipt.projectId !== input.targetProjectId || !Array.isArray(receipt.artifactIds)) throw Error('新项目已有其他复制请求，未覆盖。'); } catch (error) { if (error.code !== 'ENOENT' && !/目录已不可用/.test(error.message)) throw error; }
    const existing = await artifactStore.listProject(input.targetProjectId), savedDocument = input.kind === 'excel' ? await spreadsheetStore.load({ projectId: input.targetProjectId }) : input.kind !== 'image' ? await editorStore.load({ projectId: input.targetProjectId, kind: input.kind }) : null;
    if (!receipt && (existing.length || savedDocument)) throw Error('新项目已有内容，未覆盖；请选择新的空项目文件夹。');
    if (!receipt) { receipt = { version: 1, projectId: input.targetProjectId, fingerprint, artifactIds: [], materials: {}, complete: false, ...(prepared.document ? { document: prepared.document } : {}) }; await atomicJson(fs, receiptPath, receipt); }
    if (receipt.document) prepared.document = receipt.document.kind === 'excel' ? validateSpreadsheetDocument(receipt.document) : validateEditorDocument(receipt.document);
    const finish = async artifacts => { const result = { projectId: input.targetProjectId, artifacts, sourceRevision: prepared.sourceRevision, ...(prepared.imageSettings ? { imageSettings: prepared.imageSettings } : {}), ...(prepared.workflow ? { workflow: prepared.workflow } : {}) }; const deliverables = artifacts.filter(file => input.kind === 'image' ? file.kind === 'image' : file.mimeType?.includes({ word: 'wordprocessingml', ppt: 'presentationml', excel: 'spreadsheetml' }[input.kind])); if (deliverables.length && !receipt.notified && onCopied) { await onCopied({ ...result, artifacts: deliverables, workspaceId: input.workspaceId, name, kind: input.kind, copyId: `template-copy-${input.targetProjectId}` }); receipt.notified = true; await atomicJson(fs, receiptPath, receipt); } return result; };
    if (receipt.complete) { const restored = receipt.artifactIds.map(id => existing.find(file => file.id === id && !file.trashedAt && !file.unavailable)); if (restored.some(file => !file)) throw Error('已复制的成品已被移动或删除，请在新项目中核对，不自动重复复制。'); return finish(restored); }
    for (const file of existing.filter(item => !receipt.artifactIds.includes(item.id))) {
      if (file.runId !== `template-copy-${input.targetProjectId}-material`) throw Error('新项目出现了其他文件，停止重试以保护当前内容；已复制文件保留。');
      const digest = hash((await artifactStore.read(file.id)).buffer), material = prepared.materials.find(item => item.sha256 === digest && !receipt.materials[item.id]); if (!material) throw Error('未确认的复制素材无法核对，已保留当前文件。');
      receipt.materials[material.id] = file.id; receipt.artifactIds.push(file.id); await atomicJson(fs, receiptPath, receipt);
    }
    const ids = new Map(), artifacts = [];
    for (const file of prepared.materials) { let copied = existing.find(item => item.id === receipt.materials[file.id]); if (copied) { const value = await artifactStore.read(copied.id); if (hash(value.buffer) !== file.sha256) throw Error('重试时发现已复制素材变化，未覆盖。'); } else { copied = await artifactStore.write({ projectId: input.targetProjectId, runId: `template-copy-${input.targetProjectId}-material`, name: file.name, mimeType: file.mimeType, buffer: file.buffer, ...(file.provenance ? { provenance: file.provenance } : {}) }); receipt.materials[file.id] = copied.id; receipt.artifactIds.push(copied.id); await atomicJson(fs, receiptPath, receipt); } ids.set(file.id, copied.id); artifacts.push(copied); }
    let document = prepared.document && structuredClone(prepared.document);
    if (document) { document.title = name; if (document.kind === 'word') for (const block of document.blocks) if (block.imageId) block.imageId = ids.get(block.imageId); if (document.kind === 'ppt') for (const slide of document.slides) if (slide.imageId) slide.imageId = ids.get(slide.imageId); if (savedDocument && hash(JSON.stringify(savedDocument.document)) !== hash(JSON.stringify(document))) throw Error('新项目的编辑源已改变，未覆盖当前稿。');
      if (savedDocument) artifacts.push(...existing.filter(file => ![...ids.values()].includes(file.id)));
      else try { const result = await (document.kind === 'excel' ? spreadsheetStore : editorStore).export({ projectId: input.targetProjectId, expectedRevision: 0, document, sourceArtifactIds: [...ids.values()] }); artifacts.push(...result.artifacts); }
      catch (error) { receipt.artifactIds = (await artifactStore.listProject(input.targetProjectId)).map(file => file.id); await atomicJson(fs, receiptPath, receipt); throw error; }
    }
    receipt.complete = true; receipt.artifactIds = artifacts.map(file => file.id); await atomicJson(fs, receiptPath, receipt);
    return finish(artifacts);
  }
  return {
    async list(workspaceId) { const folder = scope(workspaceId); try { await checkedDirectory(fs, folder); } catch (error) { if (error.code === 'ENOENT' || /目录已不可用/.test(error.message)) return []; throw error; } const files = (await fs.readdir(folder)).filter(name => /^[A-Za-z0-9-]+\.json$/.test(name)); if (files.length > 200) throw Error('模板超过200份，请整理后再使用。'); const result = []; for (const name of files) result.push(info(await read(workspaceId, name.slice(0, -5)))); return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
    save: input => serial(input?.workspaceId, () => save(input)), instantiate: input => serial(input?.targetProjectId, () => instantiate(input)),
    async remove(input) { return serial(input?.workspaceId, async () => { const value = await read(input.workspaceId, input.id); await fs.unlink(path.join(scope(input.workspaceId), input.id + '.json')); for (const file of value.materials) await fs.unlink(path.join(scope(input.workspaceId), 'files', value.id + '-' + file.id + '.bin')).catch(() => undefined); }); },
    async exportWorkspace(workspaceId) { const items = [], files = []; for (const summary of await this.list(workspaceId)) { const value = await read(workspaceId, summary.id); items.push(value); for (const material of value.materials) { const buffer = await fs.readFile(await checkedFile(fs, path.join(scope(workspaceId), 'files', value.id + '-' + material.id + '.bin')).then(() => path.join(scope(workspaceId), 'files', value.id + '-' + material.id + '.bin'))); if (buffer.length !== material.bytes || hash(buffer) !== material.sha256) throw Error('模板素材已改变，请恢复后再备份。'); files.push({ templateId: value.id, id: material.id, buffer }); } } return { version: 1, workspaceId, items, files }; },
    async restoreWorkspace(snapshot) {
      if (!snapshot || snapshot.version !== 1 || !validId(snapshot.workspaceId) || !Array.isArray(snapshot.items) || snapshot.items.length > 200 || new Set(snapshot.items.map(item => item.id)).size !== snapshot.items.length || !Array.isArray(snapshot.files)) throw Error('模板备份无效。');
      const map = new Map(snapshot.files.map(file => [`${file.templateId}/${file.id}`, file.buffer]));
      if (map.size !== snapshot.files.length || map.size !== snapshot.items.reduce((sum, item) => sum + item.materials.length, 0)) throw Error('模板备份素材清单重复或不匹配。');
      for (const item of snapshot.items) { checked(item, snapshot.workspaceId, item.id); for (const file of item.materials) { const buffer = map.get(item.id + '/' + file.id); if (!(buffer instanceof Uint8Array) || buffer.length !== file.bytes || hash(buffer) !== file.sha256) throw Error('模板备份缺少对应素材。'); } }
      return serial(snapshot.workspaceId, async () => {
        const folder = scope(snapshot.workspaceId), files = path.join(folder, 'files');
        // Preflight every conflict before starting a restore; matching interrupted writes are reusable.
        for (const item of snapshot.items) { try { if (JSON.stringify(await read(snapshot.workspaceId, item.id)) !== JSON.stringify(item)) throw Error('模板编号冲突，原模板未覆盖。'); } catch (error) { if (error.code !== 'ENOENT' && !/目录已不可用/.test(error.message)) throw error; } for (const file of item.materials) { const target = path.join(files, item.id + '-' + file.id + '.bin'); try { await checkedFile(fs, target); if (hash(await fs.readFile(target)) !== file.sha256) throw Error('模板素材编号冲突，原文件未覆盖。'); } catch (error) { if (error.code !== 'ENOENT' && !/目录已不可用/.test(error.message)) throw error; } } }
        await checkedDirectory(fs, files, true);
        for (const item of snapshot.items) { for (const file of item.materials) { const target = path.join(files, item.id + '-' + file.id + '.bin'); try { await fs.writeFile(target, map.get(item.id + '/' + file.id), { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; } } await atomicJson(fs, path.join(folder, item.id + '.json'), item); }
        return { restored: snapshot.items.length };
      });
    },
    async drain() { await Promise.all([...queues.values()]); },
  };
}
module.exports = { createProjectTemplates, emptyContent, portableWorkflow, validateTemplate };
