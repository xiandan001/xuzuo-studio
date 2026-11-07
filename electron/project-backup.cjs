const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { checkedDirectory, checkedFile, atomicJson, inside, key } = require('./workspace-paths.cjs');
const { hash, MAX_TOTAL, MAX_FILES, safePath, inspectZip, withoutSecrets, validateManifest, createIdMap, remap, mappedName, validId } = require('./backup-format.cjs');
const { validateQuoteBackups } = require('./quote-backup.cjs');
const { validateRecords } = require('./run-history-store.cjs');
const { validateAssetCategoryState, remapAssetCategoryState } = require('./asset-categories.cjs');
const { purgedProjectAudit } = require('./backup-project-audits.cjs');
const APP_VERSION = require('../package.json').version;
const controlledPath = relative => {
  const parts = relative.split('/'), basename = parts.at(-1);
  const beadRecovery = /^bead-before-restore-[a-f0-9-]{36}\.json$/i.test(basename) || parts.at(-2) === 'bead-revisions-v1' && /^index-invalid-[a-f0-9-]{36}\.json$/i.test(basename);
  if (parts.includes('.xuzuo') && beadRecovery) return false;
  return relative.endsWith('.json') && (parts.includes('.xuzuo') || basename === '.xuzuo-workspace-v1.json' || parts.includes('.xuzuo-assets') && ['library-v1.json', 'categories-v1.json'].includes(basename));
};

function createProjectBackup({ directory, workspaceStorage, artifactStore, liveEngine, batchProduction, automationProvider, receiptProvider, fileSystem = fsDefault, loadModule = require }) {
  const fs = fileSystem, receipts = path.join(path.resolve(directory), 'backup-imports-v1');
  let pending = Promise.resolve();
  const serial = action => { const task = pending.then(action); pending = task.catch(() => undefined); return task; };
  const batchManager = () => typeof batchProduction === 'function' ? batchProduction() : batchProduction;
  const automationManager = () => typeof automationProvider === 'function' ? automationProvider() : automationProvider;
  const receiptManager = () => typeof receiptProvider === 'function' ? receiptProvider() : receiptProvider;
  async function readJson(filename) { await checkedFile(fs, filename); return JSON.parse(await fs.readFile(filename, 'utf8')); }
  async function readBackup(filename) {
    await checkedDirectory(fs, path.dirname(filename)); const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_TOTAL) throw new Error('备份不是普通 ZIP 文件或超过 512 MB。');
    const bytes = await fs.readFile(filename); inspectZip(bytes);
    const Zip = loadModule('jszip'), zip = await Zip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
    const entry = zip.file('manifest.json'); if (!entry || entry._data.uncompressedSize > 16 * 1024 * 1024) throw new Error('备份清单缺失或过大。');
    const manifest = validateManifest(JSON.parse(await entry.async('string'))), files = new Map();
    const expected = new Set(['manifest.json', ...manifest.files.map(item => item.path)]);
    if (Object.values(zip.files).some(item => !item.dir && (!expected.has(item.name) || item.unsafeOriginalName !== undefined && item.unsafeOriginalName !== item.name))) throw new Error('备份包含清单以外的内容或不安全路径。');
    for (const item of manifest.files) {
      const source = zip.file(item.path); if (!source || source._data.uncompressedSize !== item.bytes) throw new Error('备份文件缺失或大小与清单不一致。');
      const buffer = await source.async('nodebuffer');
      if (buffer.length !== item.bytes || hash(buffer) !== item.sha256) throw new Error('备份内容哈希不一致，未恢复任何项目。');
      files.set(item.path, buffer);
    }
    validateRecords(manifest.records);
    if (manifest.batches?.length && !batchManager()) throw new Error('当前应用缺少批量记录恢复模块，请使用完整桌面版本导入。');
    for (const artifact of manifest.artifacts) {
      const project = manifest.locations.projects.find(item => item.projectId === artifact.projectId), workspace = manifest.locations.workspaces.find(item => item.workspaceId === project.workspaceId);
      const name = artifact.trashedAt ? artifact.trashFileName : artifact.fileName; safePath(name);
      if (artifact.storageDirectory && key(artifact.storageDirectory) !== key(project.directory)) throw new Error('备份产物目录与项目归属不匹配。');
      const relative = artifact.storageDirectory ? `workspaces/${workspace.workspaceId}/${path.relative(workspace.directory, project.directory).split(path.sep).join('/')}/${artifact.trashedAt ? 'trash' : 'files'}/${name}` : `legacy-artifacts/${artifact.id}/${name}`;
      const bytes = files.get(relative);
      if (!bytes || bytes.length !== artifact.bytes || artifact.sha256 && hash(bytes) !== artifact.sha256) throw new Error('备份产物登记与实际文件的大小或哈希不一致。');
      artifact.sha256 ||= hash(bytes);
    }
    for (const [relative, bytes] of files) {
      if (!relative.endsWith('.json')) continue;
      const parts = relative.split('/'), basename = parts.at(-1);
      if (parts.includes('.xuzuo') && basename === 'project-v1.json') {
        const marker = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        const project = manifest.locations.projects.find(item => item.projectId === marker.projectId), workspace = project && manifest.locations.workspaces.find(item => item.workspaceId === project.workspaceId);
        const expected = workspace && `workspaces/${workspace.workspaceId}/${path.relative(workspace.directory, project.directory).split(path.sep).join('/')}/.xuzuo/project-v1.json`;
        if (marker.version !== 1 || !project || relative !== expected) throw new Error('备份包含未登记或已永久移除的项目目录内容。');
      }
      if (parts.includes('.xuzuo-assets') && basename === 'categories-v1.json') validateAssetCategoryState(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      if (parts.includes('.xuzuo-assets') && basename === 'library-v1.json') {
        const library = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (library.version !== 1 || !Array.isArray(library.assets) || new Set(library.assets.map(item => item.id)).size !== library.assets.length) throw new Error('备份素材索引的版本或编号无效。');
        for (const asset of library.assets) {
          safePath(asset.fileName); if (!validId(asset.id) || !asset.fileName.startsWith(`${asset.id}-`)) throw new Error('备份素材身份无效。');
          const content = files.get(`${parts.slice(0, -1).join('/')}/files/${asset.fileName}`);
          if (!content || content.length !== asset.bytes || hash(content) !== asset.sha256) throw new Error('备份素材索引与实际文件不一致。');
        }
      }
      if (parts.includes('.xuzuo') && /^revision-[1-9]\d*-/.test(basename)) {
        const snapshot = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), match = /^revision-([1-9]\d*)-([a-f0-9]{64})(?:-[a-f0-9-]+)?\.json$/.exec(basename);
        if (!match || snapshot.version !== 1 || snapshot.projectId !== snapshot.record?.projectId || !manifest.locations.projects.some(item => item.projectId === snapshot.projectId) || Number(match[1]) !== snapshot.record.revision || match[2] !== snapshot.hash || snapshot.hash !== hash(JSON.stringify(snapshot.record))) throw new Error('备份独立修订的身份或内部哈希无效，未重写历史。');
      }
    }
    return { manifest, files };
  }
  async function exportBackup({ meta, workspaceIds, projectIds, filePath, beforeWrite }) {
    const locations = await workspaceStorage.list(), nativePurges = await workspaceStorage.listPurges?.() || [], requested = new Set(workspaceIds);
    if (!requested.size || requested.size !== workspaceIds.length || workspaceIds.some(id => !locations.workspaces.some(item => item.workspaceId === id))) throw new Error('请选择已连接本地文件夹的工作区。');
    const workspaces = locations.workspaces.filter(item => requested.has(item.workspaceId));
    if (workspaces.some(item => inside(item.directory, path.resolve(directory)))) throw new Error('工作区包含应用资料目录，请把项目放入独立本地工作区后再备份。');
    const auditById = new Map(meta.projects.filter(item => item.purgedAt).map(item => [item.id, purgedProjectAudit(item)]));
    for (const item of nativePurges) {
      const prior = meta.projects.find(project => project.id === item.projectId);
      if (prior && prior.workspaceId !== item.workspaceId) throw new Error('永久移除审计和界面工作区归属不一致，未导出混合备份。');
      auditById.set(item.projectId, purgedProjectAudit({ ...prior, ...item, id: item.projectId }));
    }
    const audits = [...auditById.values()].filter(item => requested.has(item.workspaceId) && (!projectIds || projectIds.includes(item.id))), auditIds = new Set(audits.map(item => item.id));
    const projects = locations.projects.filter(item => !auditById.has(item.projectId) && requested.has(item.workspaceId) && (!projectIds || projectIds.includes(item.projectId))), selected = new Set(projects.map(item => item.projectId));
    const auditedSelection = new Set([...selected, ...auditIds]);
    if (projectIds && (new Set(projectIds).size !== projectIds.length || projectIds.some(id => !auditedSelection.has(id)))) throw new Error('所选项目不属于备份范围或尚未绑定目录。');
    if (meta.projects.some(item => requested.has(item.workspaceId) && (!projectIds || projectIds.includes(item.id)) && !auditedSelection.has(item.id))) throw new Error('备份范围含尚未绑定本地目录的项目，请先连接目录。');
    const excludedDirectories = [...nativePurges.flatMap(item => item.directories || (item.directory ? [item.directory] : [])), ...locations.projects.filter(item => auditById.has(item.projectId)).map(item => item.directory)];
    const filteredMeta = withoutSecrets({ ...meta, workspaces: meta.workspaces.filter(item => requested.has(item.id)), projects: [...meta.projects.filter(item => selected.has(item.id)), ...audits], ledger: meta.ledger.filter(item => auditedSelection.has(item.projectId)), customPrompts: meta.customPrompts.filter(item => !item.workspaceId || requested.has(item.workspaceId)), preferencesByWorkspace: Object.fromEntries(Object.entries(meta.preferencesByWorkspace).filter(([id]) => requested.has(id))), configuration: Object.fromEntries(Object.entries(meta.configuration || {}).filter(([name]) => ['connections', 'models', 'workflows', 'categories', 'studioActions', 'useTemplates'].includes(name)).map(([name, items]) => [name, Array.isArray(items) ? items.filter(item => !item.workspaceId || requested.has(item.workspaceId)) : items])) });
    if (meta.quoteDrafts !== undefined) { if (!Array.isArray(meta.quoteDrafts)) throw Error('备份报价清单无效。'); filteredMeta.quoteDrafts = withoutSecrets(meta.quoteDrafts.filter(item => selected.has(item.projectId))); validateQuoteBackups(filteredMeta.quoteDrafts, filteredMeta.projects); }
    const artifacts = await artifactStore.backupEntries([...selected]), records = await liveEngine.exportRecords([...selected]), batches = await batchManager()?.exportRecords([...selected]) || [];
    const automations = await automationManager()?.backupEntries({ workspaceIds: [...requested], projectIds: [...selected] });
    const modelReceipts = await receiptManager()?.backupEntries({ projectIds: [...selected] });
    if (records.some(item => item.run.status === 'running')) throw new Error('请等待模型请求结束后创建备份。');
    const auditLedger = auditIds.size ? (await liveEngine.snapshot(undefined, { projectIds: [...auditIds], summaryOnly: true })).ledger.filter(entry => auditIds.has(entry.projectId)) : [];
    const durableLedger = withoutSecrets([...records.flatMap(record => record.ledger), ...auditLedger]), durableById = new Map(durableLedger.map(entry => [entry.id, entry]));
    const rendererById = new Map(filteredMeta.ledger.map(entry => [entry.id, entry]));
    filteredMeta.projects = filteredMeta.projects.map(project => {
      if (project.purgedAt) return { ...project, costCents: Math.max(project.costCents, durableLedger.filter(entry => entry.projectId === project.id).reduce((sum, entry) => sum + entry.costCents, 0)) };
      const delta = durableLedger.filter(entry => entry.projectId === project.id).reduce((sum, entry) => sum + entry.costCents - (rendererById.get(entry.id)?.costCents || 0), 0);
      return { ...project, costCents: Math.max(0, project.costCents + delta) };
    });
    filteredMeta.ledger = filteredMeta.ledger.map(entry => durableById.get(entry.id) || entry);
    for (const entry of durableLedger) if (!filteredMeta.ledger.some(existing => existing.id === entry.id)) filteredMeta.ledger.push(entry);
    const manifest = { kind: 'xuzuo-internal-backup', version: audits.length ? 3 : automations || modelReceipts || filteredMeta.quoteDrafts?.length ? 2 : 1, appVersion: APP_VERSION, backupId: randomUUID(), createdAt: new Date().toISOString(), scope: projectIds ? 'projects' : 'workspaces', meta: filteredMeta, locations: { workspaces, projects }, artifacts, records: withoutSecrets(records), batches: withoutSecrets(batches), ...(automations ? { automations } : {}), ...(modelReceipts ? { modelReceipts } : {}), files: [], secretsIncluded: false };
    const Zip = loadModule('jszip'), zip = new Zip(); let total = 0;
    async function add(source, relative) {
      safePath(relative); const stat = await checkedFile(fs, source), buffer = await fs.readFile(source), after = await checkedFile(fs, source);
      if (stat.size !== buffer.length || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) throw new Error('备份期间源文件发生变化，请保存编辑后重试。');
      if ((total += buffer.length) > MAX_TOTAL || manifest.files.length >= MAX_FILES - 1) throw new Error('备份范围超过 512 MB 或 9999 个文件，请缩小范围。');
      if (manifest.files.some(item => item.path.toLowerCase() === relative.toLowerCase())) return;
      manifest.files.push({ path: relative, bytes: buffer.length, sha256: hash(buffer) }); zip.file(relative, buffer, { createFolders: false });
    }
    async function walk(source, relative, include = () => true) {
      await checkedDirectory(fs, source);
      for (const item of await fs.readdir(source, { withFileTypes: true })) {
        if (/^credentials-v1\.json(?:\.|$)/i.test(item.name)) continue;
        const from = path.join(source, item.name), next = `${relative}/${item.name}`; if (!include(from)) continue;
        const stat = await fs.lstat(from);
        if (stat.isSymbolicLink()) throw new Error('备份目录包含链接或 junction，未创建不完整备份。');
        if (stat.isDirectory()) await walk(from, next, include); else if (stat.isFile()) await add(from, next); else throw new Error('备份目录包含非普通文件。');
      }
    }
    for (const workspace of workspaces) {
      await workspaceStorage.validateWorkspace(workspace.workspaceId);
      for (const project of projects.filter(item => item.workspaceId === workspace.workspaceId)) await workspaceStorage.projectDirectory(project.projectId);
      const allProjects = locations.projects.filter(item => item.workspaceId === workspace.workspaceId);
      await walk(workspace.directory, `workspaces/${workspace.workspaceId}`, filename => {
        const purgedTree = excludedDirectories.some(directory => inside(directory, filename));
        const newRegisteredTree = projects.some(project => inside(project.directory, filename) || inside(filename, project.directory));
        return (!purgedTree || newRegisteredTree) && (!projectIds || !allProjects.some(project => !selected.has(project.projectId) && inside(project.directory, filename)));
      });
    }
    for (const artifact of artifacts) {
      if (artifact.storageDirectory && workspaces.some(item => inside(item.directory, artifact.storageDirectory))) continue;
      const sourceRoot = artifact.storageDirectory || path.join(directory, 'artifacts-v1'), name = artifact.trashedAt ? artifact.trashFileName : artifact.fileName;
      await add(path.join(sourceRoot, artifact.trashedAt ? 'trash' : 'files', name), `legacy-artifacts/${artifact.id}/${name}`);
    }
    validateManifest(manifest);
    const serializedManifest = `${JSON.stringify(manifest)}\n`;
    if (Buffer.byteLength(serializedManifest, 'utf8') > 16 * 1024 * 1024) throw new Error('运行历史和索引超过16MB，请按项目分批备份。');
    if (total + Buffer.byteLength(serializedManifest, 'utf8') > MAX_TOTAL) throw new Error('备份文件和索引合计超过512MB，请按项目分批备份。');
    zip.file('manifest.json', serializedManifest, { createFolders: false });
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    if (buffer.length > MAX_TOTAL) throw new Error('压缩后的备份超过512MB，请按项目分批备份。');
    await checkedDirectory(fs, path.dirname(filePath));
    if (workspaces.some(item => inside(item.directory, filePath))) throw new Error('请把内部备份保存到工作区以外，避免下一次把备份再次装入备份。');
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, buffer, { flag: 'wx' });
    try { await beforeWrite?.(); await fs.rename(temporary, filePath); } catch (error) { await fs.unlink(temporary).catch(() => undefined); throw error; }
    return { saved: true, path: filePath, backupId: manifest.backupId, files: manifest.files.length, bytes: total, projects: projects.length, workspaces: workspaces.length };
  }
  async function completeReceipt(receipt) {
    await artifactStore.importEntries(receipt.artifacts);
    await workspaceStorage.importLocations(receipt.locations);
    const audits = receipt.meta.projects.filter(project => project.purgedAt);
    if (audits.length) {
      if (!workspaceStorage.importPurges) throw new Error('本地永久移除审计恢复模块尚未就绪，恢复凭据仍保留。');
      await workspaceStorage.importPurges(audits.map(project => ({ projectId: project.id, workspaceId: project.workspaceId, name: project.name, kind: project.kind, purgedAt: project.purgedAt, trashedAt: project.trashedAt, costCents: project.costCents, updatedAt: project.updatedAt, directories: [], requestId: receipt.backupId })));
    }
    await liveEngine.importRecords(receipt.records);
    if (receipt.batches?.length) {
      if (!batchManager()) throw new Error('批量记录恢复模块尚未就绪，恢复凭据已保留。');
      await batchManager().importRecords(receipt.batches, { backupId: receipt.backupId });
    }
    await liveEngine.refreshArtifactLocations();
    if (receipt.modelReceipts) {
      if (!receiptManager()?.importEntries) throw new Error('模型回执恢复模块尚未就绪，恢复凭据和文件已保留。');
      await receiptManager().importEntries({ records: receipt.modelReceipts, idMap: receipt.idMap, backupId: receipt.backupId, availableRuns: (await liveEngine.snapshot(undefined, { summaryOnly: false })).runs });
    }
    if (receipt.automations) {
      if (!automationManager()?.importEntries) throw new Error('自动化恢复模块尚未就绪，恢复凭据和文件已保留。');
      await automationManager().importEntries({ records: receipt.automations, idMap: receipt.idMap, backupId: receipt.backupId });
    }
    receipt.phase = 'native-ready'; await atomicJson(fs, path.join(receipts, `${receipt.backupId}.json`), receipt);
    return { meta: receipt.meta, locations: receipt.locations, idMap: receipt.idMap, backupId: receipt.backupId, receiptPath: path.join(receipts, `${receipt.backupId}.json`) };
  }
  async function importBackup({ filePath, directory: target }) {
    const { manifest, files } = await readBackup(filePath); await checkedDirectory(fs, receipts, true);
    const receiptFile = path.join(receipts, `${manifest.backupId}.json`);
    try { const previous = await readJson(receiptFile); if (previous.phase === 'acknowledged') throw new Error('这份备份已导入，未重复导入历史费用。'); return completeReceipt(previous); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const controls = [];
    for (const [relative, bytes] of files) if (controlledPath(relative)) {
      try { controls.push(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
      catch { throw new Error('备份编辑源或管理索引不是有效 JSON，未登记导入工作区。'); }
    }
    await checkedDirectory(fs, target);
    const existing = await workspaceStorage.list();
    if (existing.workspaces.some(item => inside(item.directory, target) || inside(target, item.directory))) throw new Error('导入位置不能包含现有工作区或位于现有工作区内。');
    const importRoot = path.join(target, `序作恢复-${manifest.backupId.slice(0, 8)}-${randomUUID().slice(0, 8)}`); await fs.mkdir(importRoot);
    const idMap = createIdMap({ manifest, controls }), pathMap = {}, fileNames = {}, renamedNames = {};
    for (const item of [...manifest.artifacts, ...controls.flatMap(value => Array.isArray(value.assets) ? value.assets : [])]) {
      for (const name of [item.fileName, item.trashFileName].filter(Boolean)) renamedNames[name] = mappedName(name, { [item.id]: idMap[item.id] });
    }
    const locations = { workspaces: manifest.locations.workspaces.map(item => ({ ...remap(item, idMap), directory: path.join(importRoot, idMap[item.workspaceId]) })), projects: [] };
    for (const workspace of manifest.locations.workspaces) pathMap[workspace.directory] = locations.workspaces.find(item => item.workspaceId === idMap[workspace.workspaceId]).directory;
    for (const project of manifest.locations.projects) {
      const oldWorkspace = manifest.locations.workspaces.find(item => item.workspaceId === project.workspaceId);
      if (!oldWorkspace || !inside(oldWorkspace.directory, project.directory) || key(oldWorkspace.directory) === key(project.directory)) throw new Error('备份项目路径不属于其工作区。');
      const destination = path.join(pathMap[oldWorkspace.directory], path.relative(oldWorkspace.directory, project.directory));
      pathMap[project.directory] = destination; locations.projects.push({ ...remap(project, idMap), directory: destination });
    }
    const staged = [];
    for (const [relative, original] of files) {
      if (relative.split('/').some(name => /^credentials-v1\.json(?:\.|$)/i.test(name))) throw new Error('备份包含凭证库文件，已拒绝导入。');
      const parts = relative.split('/'); let destination, buffer = original;
      if (parts[0] === 'workspaces' && idMap[parts[1]] && manifest.locations.workspaces.some(item => item.workspaceId === parts[1])) destination = path.join(importRoot, idMap[parts[1]], ...parts.slice(2, -1), renamedNames[parts.at(-1)] || parts.at(-1));
      else if (parts[0] === 'legacy-artifacts' && parts.length === 3) {
        const artifact = manifest.artifacts.find(item => item.id === parts[1]), project = locations.projects.find(item => item.projectId === idMap[artifact?.projectId]);
        if (!artifact || !project) throw new Error('备份包含未登记产物。');
        destination = path.join(project.directory, artifact.trashedAt ? 'trash' : 'files', renamedNames[parts[2]] || parts[2]);
      } else throw new Error('备份包含未知文件区域。');
      if (!inside(importRoot, destination) || key(importRoot) === key(destination)) throw new Error('恢复路径超出独立导入目录。');
      const controlled = controlledPath(relative);
      if (controlled && relative.endsWith('.json')) {
        let value; try { const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original)); value = relative.includes('/.xuzuo-assets/') && relative.endsWith('/categories-v1.json') ? remapAssetCategoryState(raw, idMap) : remap(raw, idMap, pathMap, renamedNames); } catch { throw new Error('备份的编辑源或独立修订不是有效 JSON，未登记导入工作区。'); }
        if (/^revision-[1-9]\d*-[a-f0-9]{64}(?:-[a-f0-9-]+)?\.json$/.test(parts.at(-1)) && value.record) {
          value.hash = hash(JSON.stringify(value.record)); const before = path.basename(destination), after = `revision-${value.record.revision}-${value.hash}.json`;
          fileNames[before] = after; destination = path.join(path.dirname(destination), after);
        }
        buffer = Buffer.from(`${JSON.stringify(value)}\n`);
      }
      staged.push({ destination, buffer, controlled });
    }
    for (const item of staged) {
      let buffer = item.buffer;
      if (item.controlled && path.basename(item.destination) === 'index-v1.json') {
        const value = JSON.parse(buffer.toString('utf8')); for (const entry of value.entries || []) entry.fileName = fileNames[entry.fileName] || entry.fileName;
        buffer = Buffer.from(`${JSON.stringify(value)}\n`);
      }
      // Revision index hashes must refer to the rewritten immutable revision file.
      if (item.controlled && path.basename(item.destination) === 'index-v1.json') {
        const value = JSON.parse(buffer.toString('utf8'));
        for (const entry of value.entries || []) { const match = /^revision-[1-9]\d*-([a-f0-9]{64})/.exec(entry.fileName); if (match) entry.hash = match[1]; }
        buffer = Buffer.from(`${JSON.stringify(value)}\n`);
      }
      await checkedDirectory(fs, path.dirname(item.destination), true); await fs.writeFile(item.destination, buffer, { flag: 'wx' });
      if (hash(await fs.readFile(item.destination)) !== hash(buffer)) throw new Error('恢复文件写入核验失败，保留独立副本供检查。');
    }
    for (const project of locations.projects) for (const name of ['files', 'trash', '.xuzuo']) await checkedDirectory(fs, path.join(project.directory, name), true);
    const meta = remap(manifest.meta, idMap, pathMap, renamedNames), artifacts = remap(manifest.artifacts, idMap, pathMap, renamedNames).map(item => ({ ...item, storageDirectory: locations.projects.find(project => project.projectId === item.projectId).directory }));
    const records = remap(manifest.records, idMap, pathMap, renamedNames);
    for (const workspace of meta.workspaces) workspace.directory = pathMap[manifest.meta.workspaces.find(item => idMap[item.id] === workspace.id)?.directory] || locations.workspaces.find(item => item.workspaceId === workspace.id).directory;
    for (const project of meta.projects) {
      if (project.purgedAt) { delete project.directory; continue; }
      project.directory = locations.projects.find(item => item.projectId === project.id).directory;
    }
    for (const record of records) {
      const original = manifest.records.find(item => idMap[item.run.id] === record.run.id), project = locations.projects.find(item => item.projectId === record.run.projectId);
      record.importOrigin = { backupId: manifest.backupId, sourceRunId: original.run.id, sourceWorkspaceId: original.run.workspaceId };
      record.run.workspaceId = project.workspaceId; record.run.snapshot.workspaceId = project.workspaceId;
      record.request.project.workspaceId = project.workspaceId; record.request.workflow.workspaceId = project.workspaceId;
      if (['running', 'paused', 'waiting-review'].includes(record.run.status)) { record.run.status = 'interrupted'; record.run.error = '从内部备份恢复；继续运行前请重新配置凭证并核对已发生费用。'; }
      for (const attempt of record.run.attempts) if (['running', 'waiting-review'].includes(attempt.status)) attempt.status = 'cancelled';
      for (const entry of record.ledger) if (entry.status === 'processing') { entry.status = 'cancelled'; entry.costState = 'unknown'; }
    }
    const receipt = { version: 1, backupId: manifest.backupId, sourcePath: filePath, createdAt: new Date().toISOString(), phase: 'prepared', importRoot, idMap, meta, locations, artifacts, records, batches: remap(manifest.batches || [], idMap, pathMap, renamedNames), ...(manifest.automations ? { automations: manifest.automations } : {}), ...(manifest.modelReceipts ? { modelReceipts: manifest.modelReceipts } : {}) };
    await atomicJson(fs, receiptFile, receipt); return completeReceipt(receipt);
  }
  return {
    exportBackup: input => serial(() => exportBackup(input)),
    inspectBackup: filename => serial(async () => { const { manifest } = await readBackup(filename); return { backupId: manifest.backupId, createdAt: manifest.createdAt, scope: manifest.scope, workspaces: manifest.meta.workspaces.map(({ id, name }) => ({ id, name })), projects: manifest.meta.projects.filter(project => !project.purgedAt).map(({ id, name }) => ({ id, name })), files: manifest.files.length, bytes: manifest.files.reduce((sum, item) => sum + item.bytes, 0), secretsIncluded: false }; }),
    importBackup: input => serial(() => importBackup(input)),
    pendingImports: () => serial(async () => { await checkedDirectory(fs, receipts, true); const result = []; for (const name of await fs.readdir(receipts)) { if (!/^[A-Za-z0-9-]+\.json$/.test(name)) continue; const receipt = await readJson(path.join(receipts, name)); if (receipt.phase !== 'acknowledged') result.push(await completeReceipt(receipt)); } return result; }),
    acknowledgeImport: backupId => serial(async () => { if (!validId(backupId)) throw new Error('导入凭据编号无效。'); const filename = path.join(receipts, `${backupId}.json`), receipt = await readJson(filename); if (receipt.phase !== 'native-ready') throw new Error('本地文件恢复尚未完成。'); receipt.phase = 'acknowledged'; await atomicJson(fs, filename, receipt); }),
    flush: () => pending,
  };
}
module.exports = { createProjectBackup };
