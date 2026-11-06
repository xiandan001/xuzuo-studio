const defaultFileSystem = require('node:fs/promises');
const { createOperationTracker } = require('./queue-lifecycle.cjs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createTrashStore, safeBasename } = require('./trash-store.cjs');
const { copyVerifiedFile } = require('./workspace-paths.cjs');
const { assetProvenance } = require('./asset-provenance.cjs');
const { timestampedFilename, stripSavedTimestamp } = require('./saved-filename.cjs');

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const TEXT_PREVIEW_BYTES = 1024 * 1024;
const TYPES = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pdf': 'application/pdf',
};

function kindFor(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.includes('officedocument')) return 'office';
  if (mimeType.startsWith('text/') || mimeType === 'application/json') return 'text';
  return 'other';
}

function safeName(value, mimeType) {
  const basename = typeof value === 'string' ? path.posix.basename(value.replaceAll('\\', '/')) : '';
  let name = basename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+|[.\s]+$/g, '').trim() || '创作产物';
  const expected = Object.entries(TYPES).find(([, type]) => type === mimeType)?.[0];
  const extension = path.extname(name).toLowerCase();
  const stem = (extension ? name.slice(0, -extension.length) : name).slice(0, 80);
  if (expected && TYPES[extension] !== mimeType) name = `${stem}${expected}`;
  else name = `${stem}${extension}`;
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `产物-${name}`;
  return name;
}

function metadata(entry, directory) {
  const provenance = assetProvenance(entry.provenance);
  const { id, name, mimeType, bytes, kind, createdAt, runId, projectId } = entry;
  return { id, name, mimeType, bytes, path: path.join(entry.storageDirectory || directory, entry.trashedAt ? 'trash' : 'files', entry.trashedAt ? entry.trashFileName : entry.fileName), kind, createdAt, ...(runId ? { runId } : {}), ...(projectId ? { projectId } : {}), ...(entry.trashedAt ? { trashedAt: entry.trashedAt } : {}), ...(provenance ? { provenance } : {}) };
}

function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value); }

function createArtifactStore({ directory, loadModule = require, convertImage, renderOffice, fileSystem = defaultFileSystem, workspaceStorage }) {
  const fs = fileSystem;
  const root = path.resolve(directory);
  const filesDirectory = path.join(root, 'files');
  const manifestFile = path.join(root, 'manifest-v1.json');
  const managed = createTrashStore({ directory: root, fileSystem, maxBytes: MAX_FILE_BYTES });
  const scopedStores = new Map();
  async function managedFor(entry) {
    if (!entry.storageDirectory) return managed;
    if (!workspaceStorage || !entry.projectId) throw new Error('本地产物缺少工作区目录登记，原文件已保留。');
    const projectRoot = await workspaceStorage.validateDirectory(entry.storageDirectory, entry.projectId);
    if (!scopedStores.has(projectRoot)) scopedStores.set(projectRoot, createTrashStore({ directory: projectRoot, fileSystem, maxBytes: MAX_FILE_BYTES }));
    return scopedStores.get(projectRoot);
  }
  let pending = Promise.resolve();
  const serial = action => {
    const operation = pending.then(action);
    pending = operation.catch(() => undefined);
    return operation;
  };

  function validEntry(entry) {
    if (entry?.sha256 !== undefined && (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256))) return false;
    return entry && validId(entry.id) && safeBasename(entry.fileName) && entry.fileName.startsWith(`${entry.id}-`) && typeof entry.name === 'string' && typeof entry.mimeType === 'string' && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= MAX_FILE_BYTES && typeof entry.createdAt === 'string' && kindFor(entry.mimeType) === entry.kind && (entry.storageDirectory === undefined || typeof entry.storageDirectory === 'string' && path.isAbsolute(entry.storageDirectory) && validId(entry.projectId)) && (entry.trashedAt === undefined && entry.trashFileName === undefined || typeof entry.trashedAt === 'string' && Number.isFinite(Date.parse(entry.trashedAt)) && safeBasename(entry.trashFileName) && entry.trashFileName.startsWith(`${entry.id}-`));
  }

  async function loadManifest() {
    let entries;
    try {
      if (!(await managed.controlPath('manifest-v1.json'))) return [];
      const value = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
      if (value.version !== 1 || !Array.isArray(value.artifacts)) throw new Error('invalid');
      const ids = new Set();
      for (const entry of value.artifacts) {
        if (!validEntry(entry) || ids.has(entry.id)) throw new Error('invalid');
        assetProvenance(entry.provenance);
        ids.add(entry.id);
      }
      entries = value.artifacts;
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw new Error('无法读取产物登记表，原文件已保留。');
    }
    return recoverMove(entries);
  }

  async function persistManifest(artifacts) {
    const temporary = `${manifestFile}.${randomUUID()}.tmp`;
    try {
      await managed.controlPath('manifest-v1.json', true);
      await fs.writeFile(temporary, `${JSON.stringify({ version: 1, artifacts }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await fs.rename(temporary, manifestFile);
    } catch {
      try { await fs.unlink(temporary); } catch { /* The failed write may not have created a file. */ }
      throw new Error('无法保存产物登记表，已有产物未被覆盖。');
    }
  }

  async function managedPath(entry) {
    if (entry.trashedAt) throw Object.assign(new Error('这份产物已移至回收站，请先恢复后再打开。'), { code: 'ARTIFACT_TRASHED' });
    return (await managedFor(entry)).existingPath('files', entry.fileName);
  }

  function validateMove(value) {
    if (!value || value.version !== 1 || !['trash', 'restore'].includes(value.operation) || !validEntry(value.before) || !validEntry(value.after)) throw new Error('产物回收事务格式无效，文件仍已保留。');
    const stable = ['id', 'name', 'mimeType', 'bytes', 'kind', 'createdAt', 'runId', 'projectId', 'storageDirectory', 'sha256'];
    if (stable.some(key => value.before[key] !== value.after[key])) throw new Error('产物回收事务的原始信息不匹配，文件已保留。');
    const removing = value.operation === 'trash';
    const expectedFrom = { area: removing ? 'files' : 'trash', name: removing ? value.before.fileName : value.before.trashFileName };
    const expectedTo = { area: removing ? 'trash' : 'files', name: removing ? value.after.trashFileName : value.after.fileName };
    if (removing ? value.before.trashedAt || !value.after.trashedAt || value.before.fileName !== value.after.fileName : !value.before.trashedAt || value.after.trashedAt) throw new Error('产物回收状态无效，未操作文件。');
    if (value.from?.area !== expectedFrom.area || value.from?.name !== expectedFrom.name || value.to?.area !== expectedTo.area || value.to?.name !== expectedTo.name) throw new Error('产物回收路径记录无效，未操作文件。');
    return value;
  }

  async function recoverMove(entries) {
    const value = await managed.readJournal();
    if (!value) return entries;
    const transaction = validateMove(value);
    const existing = entries.find(item => item.id === transaction.before.id);
    if (!existing) throw new Error('待恢复产物不在登记表内，文件已保留。');
    const location = await managedFor(transaction.before);
    const source = await location.inspect(transaction.from.area, transaction.from.name);
    const target = await location.inspect(transaction.to.area, transaction.to.name);
    if (Boolean(source) === Boolean(target)) throw new Error('产物回收位置需要核对，现有文件均已保留，请勿清理管理目录。');
    const entry = source ? transaction.before : transaction.after;
    const recovered = entries.map(item => item.id === entry.id ? entry : item);
    if (JSON.stringify(existing) !== JSON.stringify(entry)) await persistManifest(recovered);
    try { await managed.clearJournal(); } catch { /* The committed location is usable even if journal cleanup must be retried. */ }
    return recovered;
  }

  async function moveTransaction(entries, transaction) {
    validateMove(transaction);
    const location = await managedFor(transaction.before);
    await location.existingPath(transaction.from.area, transaction.from.name);
    await location.ensureArea(transaction.to.area, true);
    if (await location.inspect(transaction.to.area, transaction.to.name)) throw new Error('目标位置已有文件，现有内容已保留。');
    try { await managed.writeJournal(transaction); }
    catch { throw new Error('无法准备产物回收记录，原文件保持不变；请检查本机写入权限后重试。'); }
    let moved = false;
    try {
      await location.move(transaction.from, transaction.to); moved = true;
      await persistManifest(entries.map(item => item.id === transaction.after.id ? transaction.after : item));
    } catch {
      if (!moved) {
        let source, target;
        try { source = await location.inspect(transaction.from.area, transaction.from.name); target = await location.inspect(transaction.to.area, transaction.to.name); }
        catch { throw new Error('文件移动未能确认，所有文件及恢复记录已保留；请重新读取回收站核对状态。'); }
        if (source && !target) {
          try { await managed.clearJournal(); } catch { /* The next read can recover the unchanged source location. */ }
          throw new Error('文件无法移动，原有文件保持不变；请关闭占用文件的软件后重试。');
        }
        if (source || !target) throw new Error('文件移动未能确认，所有文件及恢复记录已保留；请重新读取回收站核对状态。');
      }
      try {
        await location.move(transaction.to, transaction.from);
        await persistManifest(entries);
        try { await managed.clearJournal(); } catch { /* The unchanged source is recorded in the journal. */ }
      } catch { throw new Error('操作未完成，文件仍被保留；重新打开回收站后可按实际位置恢复，请勿清理管理目录。'); }
      throw new Error('产物状态保存失败，文件已回到原位置，已有费用和历史记录保持不变。');
    }
    try { await managed.clearJournal(); } catch { /* The next read observes the committed destination and clears the journal. */ }
    return metadata(transaction.after, root);
  }

  function findEntry(entries, id) {
    if (!validId(id)) throw new Error('请提供有效的产物编号。');
    const entry = entries.find(item => item.id === id);
    if (!entry) throw new Error('找不到这份产物，请重新选择。');
    return entry;
  }

  function trash(id) {
    return serial(async () => {
      const entries = await loadManifest(), before = findEntry(entries, id);
      if (before.trashedAt) return metadata(before, root);
      const after = { ...before, trashedAt: new Date().toISOString(), trashFileName: `${before.id}-${randomUUID()}-${safeName(before.name, before.mimeType)}` };
      return moveTransaction(entries, { version: 1, operation: 'trash', before, after, from: { area: 'files', name: before.fileName }, to: { area: 'trash', name: after.trashFileName } });
    });
  }

  function restore(id) {
    return serial(async () => {
      const entries = await loadManifest(), before = findEntry(entries, id);
      if (!before.trashedAt) { await managedPath(before); return metadata(before, root); }
      const location = await managedFor(before);
      await location.ensureArea('files', true);
      const collision = await location.inspect('files', before.fileName);
      const { trashedAt: _trashedAt, trashFileName: _trashFileName, ...active } = before;
      const after = { ...active, fileName: collision ? `${before.id}-${randomUUID()}-${safeName(before.name, before.mimeType)}` : before.fileName };
      return moveTransaction(entries, { version: 1, operation: 'restore', before, after, from: { area: 'trash', name: before.trashFileName }, to: { area: 'files', name: after.fileName } });
    });
  }

  function listTrash() {
    return serial(async () => (await loadManifest()).filter(entry => entry.trashedAt).map(entry => metadata(entry, root)).sort((a, b) => b.trashedAt.localeCompare(a.trashedAt)));
  }

  async function write(input) {
    // Resolve pending workspace transitions before entering the artifact queue.
    const storageDirectory = workspaceStorage ? await workspaceStorage.projectDirectory(input?.projectId) : undefined;
    return serial(async () => {
      if (!input || typeof input.mimeType !== 'string' || !Object.values(TYPES).includes(input.mimeType)) throw new Error('不支持这个产物文件类型。');
      if ((input.text !== undefined) === (input.buffer !== undefined)) throw new Error('写入产物时，请只提供文本或二进制内容中的一种。');
      if (input.text !== undefined && typeof input.text !== 'string') throw new Error('产物文本格式无效。');
      if (input.buffer !== undefined && !(input.buffer instanceof Uint8Array)) throw new Error('产物二进制格式无效。');
      const buffer = input.text !== undefined ? Buffer.from(input.text, 'utf8') : Buffer.from(input.buffer);
      if (input.mimeType === 'image/svg+xml') require('./image-output-formats.cjs').validateSvg(buffer);
      if (input.mimeType === 'image/gif') require('./image-output-formats.cjs').validateGif(buffer);
      if (buffer.length > MAX_FILE_BYTES) throw new Error('单个产物最大支持 100 MB，请缩小内容或拆分文件。');
      const provenance = assetProvenance(input.provenance);
      const entries = await loadManifest();
      const id = randomUUID();
      const originalName = safeName(input.preserveOriginalName === true ? input.name : stripSavedTimestamp(input.name), input.mimeType);
      const name = input.preserveOriginalName === true ? originalName : timestampedFilename(originalName);
      const entry = { id, name, mimeType: input.mimeType, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex'), kind: kindFor(input.mimeType), createdAt: new Date().toISOString(), fileName: `${id}-${name}`, ...(input.runId ? { runId: String(input.runId) } : {}), ...(input.projectId ? { projectId: String(input.projectId) } : {}), ...(storageDirectory ? { storageDirectory } : {}), ...(provenance ? { provenance } : {}) };
      const location = await managedFor(entry);
      await location.ensureArea('files', true);
      const filename = path.join(storageDirectory ? path.join(storageDirectory, 'files') : filesDirectory, entry.fileName);
      await fs.writeFile(filename, buffer, { flag: 'wx' });
      try { await persistManifest([...entries, entry]); }
      catch (error) { try { await fs.unlink(filename); } catch { /* Only this unregistered new file is removed. */ } throw error; }
      return metadata(entry, root);
    });
  }

  function read(id) {
    return serial(async () => {
      if (!validId(id)) throw new Error('请使用有效的产物编号读取文件。');
      const entry = (await loadManifest()).find(item => item.id === id);
      if (!entry) throw new Error('找不到这份产物，请重新选择。');
      const filename = await managedPath(entry);
      const buffer = await fs.readFile(filename);
      if (entry.sha256 && createHash('sha256').update(buffer).digest('hex') !== entry.sha256) throw new Error('产物内容已在应用外改变，请作为新文件重新导入；原登记和费用保持不变。');
      return { ...metadata(entry, root), buffer };
    });
  }

  async function inspectImageArtifact(id) {
    const types = ['image/png', 'image/jpeg', 'image/webp'], limit = 20 * 1024 * 1024;
    const [artifact] = await list([id]);
    if (artifact.kind !== 'image' || !types.includes(artifact.mimeType)) throw new Error('参考图片仅支持 PNG、JPEG 或 WebP。');
    if (!artifact.bytes || artifact.bytes > limit) throw new Error('参考图片为空或超过 20 MB，请重新选择。');
    const file = await read(id), bytes = file.buffer.length;
    if (file.kind !== 'image' || !types.includes(file.mimeType)) throw new Error('参考图片格式已变化，请重新选择。');
    if (!bytes || bytes > limit) throw new Error('参考图片为空或超过 20 MB，请重新选择。');
    return { id: file.id, mimeType: file.mimeType, bytes };
  }

  function thumbnailSource(id) {
    return serial(async () => {
      if (!validId(id)) throw new Error('请使用有效的图片编号。');
      const entry = (await loadManifest()).find(item => item.id === id);
      if (!entry || entry.kind !== 'image') throw new Error('找不到这张受管图片。');
      const filename = await managedPath(entry), stat = await fs.lstat(filename);
      if (stat.size !== entry.bytes) throw new Error('图片大小与登记不一致，请重新导入。');
      return { artifact: metadata(entry, root), key: JSON.stringify([id, filename, entry.sha256, entry.bytes, stat.mtimeMs, stat.ctimeMs]), read: () => read(id) };
    });
  }

  function list(ids) {
    return serial(async () => {
      if (!Array.isArray(ids) || ids.some(id => !validId(id))) throw new Error('请提供有效的产物编号列表。');
      const entries = await loadManifest();
      const result = [];
      for (const id of new Set(ids)) {
        const entry = entries.find(item => item.id === id);
        if (!entry) throw new Error('产物列表包含不存在的编号。');
        if (entry.trashedAt) throw Object.assign(new Error('这份产物已移至回收站，请先恢复后再使用。'), { code: 'ARTIFACT_TRASHED' });
        await managedPath(entry);
        result.push(metadata(entry, root));
      }
      return result;
    });
  }

  async function listProject(projectId) {
    if (!validId(projectId)) throw new Error('请提供有效的项目编号。');
    if (workspaceStorage && !(await workspaceStorage.list()).projects.some(project => project.projectId === projectId)) throw new Error('项目未登记在本机工作区，不能读取项目文件。');
    return serial(async () => {
      const entries = (await loadManifest()).filter(entry => entry.projectId === projectId), result = [];
      for (const entry of entries) {
        const value = metadata(entry, root);
        try {
          const location = await managedFor(entry), inspected = await location.inspect(entry.trashedAt ? 'trash' : 'files', entry.trashedAt ? entry.trashFileName : entry.fileName);
          if (!inspected) result.push({ ...value, unavailable: true, unavailableReason: '原文件不在原位置，请保留记录并检查本机文件。' });
          else if (inspected.stat.size !== entry.bytes) result.push({ ...value, unavailable: true, unavailableReason: '文件大小与登记不一致，请保留现有文件并核对。' });
          else result.push(value);
        } catch {
          result.push({ ...value, path: '', unavailable: true, unavailableReason: '文件或所属目录无法安全读取，请保留原文件并检查工作区。' });
        }
      }
      return result.sort((first, second) => second.createdAt.localeCompare(first.createdAt));
    });
  }

  async function importPaths(paths, scope = {}) {
    if (!Array.isArray(paths) || paths.length > 20 || paths.some(filename => typeof filename !== 'string' || !path.isAbsolute(filename))) throw new Error('请选择最多 20 个本机文件。');
    const selected = [];
    for (const filename of paths) {
      const mimeType = TYPES[path.extname(filename).toLowerCase()];
      if (!mimeType) throw new Error(`不支持导入 ${path.extname(filename) || '无扩展名'} 文件；请选择文字、图像、音频、视频或 Office/PDF 文件。`);
      const stat = await fs.stat(filename);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('只能导入单个不超过 100 MB 的文件。');
      selected.push({ filename, mimeType });
    }
    const result = [];
    for (const item of selected) result.push(await write({ name: path.basename(item.filename), mimeType: item.mimeType, buffer: await fs.readFile(item.filename), runId: scope.runId, projectId: scope.projectId, preserveOriginalName: true }));
    return result;
  }

  async function preview(id) {
    const artifact = (await list([id]))[0];
    const imageSupported = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'].includes(artifact.mimeType);
    if (!imageSupported && artifact.kind !== 'text') return { artifact, supported: false, reason: artifact.kind === 'office' || artifact.mimeType === 'application/pdf' ? '暂不支持 Office/PDF 的内置渲染或文本提取，请保存后在本机查看。' : '此类音视频请保存后使用本机播放器查看，当前不执行文字提取。' };
    if (artifact.kind === 'text' && artifact.bytes > TEXT_PREVIEW_BYTES) return { artifact, supported: false, reason: '文字超过 1 MB，请保存后在本机编辑器查看。' };
    if (imageSupported && artifact.bytes > 20 * 1024 * 1024) return { artifact, supported: false, reason: '图像超过 20 MB，请保存后使用本机图像查看器检查。' };
    const result = await read(id);
    const { buffer } = result;
    if (imageSupported) { if (result.mimeType === 'image/svg+xml') require('./image-output-formats.cjs').validateSvg(buffer); if (result.mimeType === 'image/gif') require('./image-output-formats.cjs').validateGif(buffer); return { artifact, supported: true, dataUrl: `data:${result.mimeType};base64,${buffer.toString('base64')}` }; }
    if (result.kind === 'text') {
      if (buffer.length > TEXT_PREVIEW_BYTES) return { artifact, supported: false, reason: '文字超过 1 MB，请保存后在本机编辑器查看。' };
      try { return { artifact, supported: true, text: new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '') }; }
      catch { return { artifact, supported: false, reason: '这份文字不是有效 UTF-8 编码，请转换编码后再使用。' }; }
    }
    return { artifact, supported: false, reason: '暂不支持这种文件的内置预览。' };
  }

  async function exportOffice(input) {
    const { createOfficeExporter } = require('./office-export.cjs');
    return createOfficeExporter({ writeArtifact: write, readArtifact: read, loadModule, convertImage, renderOffice })(input);
  }

  function migrateProject(projectId, destination, { rebase = false } = {}) {
    return serial(async () => {
      if (!validId(projectId) || !workspaceStorage) throw new Error('项目目录迁移需要已登记的工作区。');
      const target = destination === null ? root : destination || await workspaceStorage.projectDirectory(projectId);
      if (target !== root) await workspaceStorage.validateDirectory(target, projectId);
      const targetStore = target === root ? managed : createTrashStore({ directory: target, fileSystem, maxBytes: MAX_FILE_BYTES });
      const entries = await loadManifest(), changed = [];
      for (const entry of entries.filter(item => item.projectId === projectId)) {
        const area = entry.trashedAt ? 'trash' : 'files', name = entry.trashedAt ? entry.trashFileName : entry.fileName;
        if (path.resolve(entry.storageDirectory || root) === path.resolve(target)) continue;
        await targetStore.ensureArea(area, true);
        const next = { ...entry };
        if (rebase) {
          const destinationFile = await targetStore.existingPath(area, name), bytes = await fs.readFile(destinationFile);
          const sha256 = createHash('sha256').update(bytes).digest('hex');
          if (bytes.length !== entry.bytes || entry.sha256 && sha256 !== entry.sha256) throw new Error('新位置的产物内容与原始大小或哈希不匹配，未更新目录登记。');
          if (!entry.sha256) { next.sha256 = sha256; next.integrityBaseline = 'reconnected-legacy-without-original-hash'; }
        } else {
          const sourceStore = await managedFor(entry), source = await sourceStore.existingPath(area, name);
          await copyVerifiedFile(fs, source, targetStore.filePath(area, name));
        }
        if (target === root) delete next.storageDirectory; else next.storageDirectory = target;
        changed.push(next);
      }
      if (changed.length) await persistManifest(entries.map(entry => changed.find(item => item.id === entry.id) || entry));
      return { migrated: changed.length, artifacts: entries.filter(entry => entry.projectId === projectId).map(entry => metadata(changed.find(item => item.id === entry.id) || entry, root)) };
    });
  }

  function backupEntries(projectIds) { return serial(async () => (await loadManifest()).filter(entry => projectIds.includes(entry.projectId))); }
  function importEntries(added) { return serial(async () => {
    const entries = await loadManifest();
    if (!Array.isArray(added) || added.some(entry => !validEntry(entry)) || new Set(added.map(item => item.id)).size !== added.length || added.some(item => entries.some(existing => existing.id === item.id && JSON.stringify(existing) !== JSON.stringify(item)))) throw new Error('导入产物编号重复或登记无效，未覆盖已有产物。');
    const missing = added.filter(item => !entries.some(existing => existing.id === item.id));
    if (missing.length) await persistManifest([...entries, ...missing]);
  }); }

  const operations = createOperationTracker();
  const api = { write, read, inspectImageArtifact, thumbnailSource, list, listProject, importPaths, preview, exportOffice, trash, restore, listTrash, migrateProject, backupEntries, importEntries };
  return { ...Object.fromEntries(Object.entries(api).map(([name, action]) => [name, (...args) => operations.track(() => action(...args))])), drain: operations.drain, flush: operations.flush };
}

module.exports = { createArtifactStore, MAX_FILE_BYTES };
