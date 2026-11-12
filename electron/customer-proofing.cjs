const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { atomicJson, checkedDirectory, checkedFile } = require('./workspace-paths.cjs');
const { createProofPages } = require('./proofing-preview.cjs');
const { proofingHtml } = require('./proofing-client.cjs');
const { idValid, hash, validateFeedback } = require('./proofing-validation.cjs');
const { validateBusinessFormalArtifact } = require('./business-formal.cjs');
const { STORE_LIMIT, publicFilesOf, fingerprintOf, validateProofRecord, validateProofSnapshot } = require('./proofing-record.cjs');
const OFFICE = new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
const LIMIT = 100 * 1024 * 1024;

function createCustomerProofing({ directory, artifactStore, assertProject, readDocument, readImage, previewImage, commitFeedback, loadModule = require, fileSystem = fs }) {
  if (!path.isAbsolute(directory || '') || !artifactStore?.read || !artifactStore?.write || typeof assertProject !== 'function') throw TypeError('客户校样缺少本地受管文件接口。');
  const root = path.join(directory, 'customer-proofing-v1'); let tail = Promise.resolve(), closing = false;
  const serial = action => { if (closing) return Promise.reject(Error('校样服务正在退出，请稍后重试。')); const task = tail.then(action); tail = task.catch(() => undefined); return task; };
  function scoped(input) { if (!idValid(input?.workspaceId)) throw Error('请选择有效工作区。'); if (input.projectId !== undefined && !idValid(input.projectId)) throw Error('请选择有效项目。'); return input; }
  const filename = (workspaceId, packageId) => path.join(root, workspaceId, packageId + '.json');
  async function save(record) {
    if (Buffer.byteLength(JSON.stringify(record)) > STORE_LIMIT) throw Error('校样记录过大，请拆分后导出。');
    await checkedDirectory(fileSystem, root, true); await checkedDirectory(fileSystem, path.join(root, record.workspaceId), true);
    await atomicJson(fileSystem, filename(record.workspaceId, record.packageId), record);
  }
  async function read(workspaceId, packageId) {
    if (!idValid(workspaceId) || !idValid(packageId)) throw Error('校样包编号无效。');
    await checkedDirectory(fileSystem, root); await checkedDirectory(fileSystem, path.join(root, workspaceId));
    const file = filename(workspaceId, packageId), stat = await checkedFile(fileSystem, file); if (stat.size > STORE_LIMIT) throw Error('校样记录超过可读取范围。');
    return validateProofRecord(JSON.parse(await fileSystem.readFile(file, 'utf8')), workspaceId, packageId);
  }
  async function ownedArtifact(id, workspaceId, projectId) {
    if (!idValid(id)) throw Error('请选择有效的已保存文件。');
    const file = await artifactStore.read(id);
    if (!file || !idValid(file.projectId) || projectId !== undefined && file.projectId !== projectId || file.trashedAt || !(file.buffer instanceof Uint8Array)) throw Error('校样文件不属于当前有效项目。');
    await assertProject(file.projectId, workspaceId); return { ...file, buffer: Buffer.from(file.buffer) };
  }
  async function create(input) {
    scoped(input);
    if (!idValid(input.projectId) || !Array.isArray(input.artifactIds) || !input.artifactIds.length || input.artifactIds.length > 32 || new Set(input.artifactIds).size !== input.artifactIds.length || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120 || input.orderId !== undefined && !idValid(input.orderId)) throw Error('请选择1–32份已保存成品并填写校样标题。');
    await assertProject(input.projectId, input.workspaceId);
    let total = 0; const files = [];
    for (const id of input.artifactIds) {
      const file = await ownedArtifact(id, input.workspaceId);
      if (file.kind !== 'image' && !OFFICE.has(file.mimeType)) throw Error(`“${file.name}”暂不能生成可定位校样，请选择图片或已保存的Office成品。`);
      await validateBusinessFormalArtifact(file, { loadModule });
      total += file.buffer.length; if (total > 80 * 1024 * 1024) throw Error('校样原文件合计超过80MB，请分批导出。');
      files.push({ ...file, key: randomUUID(), artifactId: file.id, sha256: hash(file.buffer) });
    }
    const pages = await createProofPages(files, { readDocument, readImage: async (id, projectId) => { const file = readImage ? await readImage(id, projectId) : await ownedArtifact(id, input.workspaceId, projectId); if (file.projectId && file.projectId !== projectId) throw Error('文档插图不属于当前项目。'); return previewImage ? previewImage(file) : file; }, previewImage });
    for (const file of files) if (hash((await ownedArtifact(file.id, input.workspaceId, file.projectId)).buffer) !== file.sha256) throw Error('导出期间成品已变化，未生成旧稿校样。');
    const packageId = randomUUID(), createdAt = new Date().toISOString(), publicFiles = publicFilesOf(files.map(file => ({ ...file, bytes: file.buffer.length })));
    const fingerprint = fingerprintOf(packageId, files.map(file => ({ ...file, bytes: file.buffer.length })), pages, { workspaceId: input.workspaceId, projectId: input.projectId });
    const data = { packageId, fingerprint, title: input.title.trim(), createdAt, files: publicFiles, pages }, html = proofingHtml(data);
    const zip = new (loadModule('jszip'))(); zip.file('index.html', html); zip.file('manifest.json', JSON.stringify({ format: 'xuzuo-proof-package', version: 1, packageId, fingerprint, title: data.title, createdAt, files: publicFiles, pageCount: pages.length }, null, 2)); zip.file('README.txt', '解压后双击 index.html 即可离线校样。选择页面、段落或单元格，或在图片上拖动圈选，然后添加意见并导出JSON反馈文件。\n校样不联网、不调用AI。只含选定成品内容，不含制作方Key、提示词和费用。Office复杂分页/动画以正式文件或另附PDF为准。\n');
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE', streamFiles: true }); if (buffer.length > LIMIT) throw Error('校样包超过100MB，请分批导出。');
    const record = { version: 1, packageId, fingerprint, workspaceId: input.workspaceId, projectId: input.projectId, ...(input.orderId ? { orderId: input.orderId } : {}), title: data.title, createdAt, files: files.map(file => ({ key: file.key, artifactId: file.id, projectId: file.projectId, name: file.name, mimeType: file.mimeType, sha256: file.sha256, bytes: file.buffer.length, ...(file.sourceRevision ? { sourceRevision: file.sourceRevision } : {}) })), pages, imported: [] };
    await save(record);
    const artifact = await artifactStore.write({ projectId: input.projectId, runId: `proof-${packageId}`, name: `${data.title}-客户校样.zip`, mimeType: 'application/zip', buffer });
    record.artifactId = artifact.id; await save(record);
    return { packageId, fingerprint, title: data.title, createdAt, pageCount: pages.length, artifact, files: record.files.map(({ key: _key, mimeType: _type, ...file }) => file) };
  }
  async function importFeedback(input) {
    scoped(input);
    let feedback = input.feedback;
    if (typeof feedback === 'string') { if (Buffer.byteLength(feedback) > 2 * 1024 * 1024) throw Error('反馈文件超过2MB，请分批导出。'); feedback = JSON.parse(feedback); }
    if (!feedback || !idValid(feedback.packageId) || input.packageId && input.packageId !== feedback.packageId) throw Error('反馈文件与所选校样包不符。');
    if (Buffer.byteLength(JSON.stringify(feedback)) > 2 * 1024 * 1024) throw Error('反馈文件过大。');
    const record = await read(input.workspaceId, feedback.packageId); if (input.projectId && input.projectId !== record.projectId) throw Error('反馈不属于当前项目。');
    const annotations = validateFeedback(feedback, record), imported = new Map(record.imported.map(item => [item.id, item.fingerprint])), pending = [];
    for (const note of annotations) { if (imported.has(note.id)) { if (imported.get(note.id) !== note.fingerprint) throw Error('同一反馈编号的内容已改变，未覆盖原返修记录。'); } else pending.push(note); }
    if (record.imported.length + pending.length > 5000) throw Error('这份校样已累计5000条意见，请导出新版本校样后继续。');
    for (const id of new Set(pending.map(note => note.target.artifactId))) {
      const source = record.files.find(file => file.artifactId === id), actual = await ownedArtifact(id, record.workspaceId, source.projectId);
      if (hash(actual.buffer) !== source.sha256) throw Error('原校样文件已在应用外改变，不能把旧反馈应用到不同版本。请重新导出校样。');
    }
    let orderId = record.orderId;
    if (pending.length) {
      if (typeof commitFeedback !== 'function') throw Error('当前版本不能将反馈写入返修流程，请更新应用后重试；原反馈文件保留。');
      const result = await commitFeedback({ workspaceId: record.workspaceId, projectId: record.projectId, orderId, packageId: record.packageId, title: record.title, artifactIds: record.files.map(file => file.artifactId), annotations: pending.map(({ fingerprint: _fingerprint, ...note }) => note) });
      orderId = result?.orderId || result?.state?.feedback?.find(note => note.proofPackageId === record.packageId)?.orderId || result?.feedback?.find(note => note.proofPackageId === record.packageId)?.orderId || orderId;
      record.imported.push(...pending.map(note => ({ id: note.id, fingerprint: note.fingerprint, importedAt: new Date().toISOString() }))); if (orderId) record.orderId = orderId; await save(record);
    }
    return { packageId: record.packageId, annotations: pending.length, duplicate: annotations.length - pending.length, ...(orderId ? { orderId } : {}), imported: pending.length > 0 };
  }
  async function exportWorkspace(workspaceId) {
    scoped({ workspaceId }); const folder = path.join(root, workspaceId); let entries;
    try { await fileSystem.lstat(folder); await checkedDirectory(fileSystem, folder); entries = await fileSystem.readdir(folder); } catch (error) { if (error.code === 'ENOENT') return { version: 1, workspaceId, packages: [] }; throw error; }
    const packages = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue; const packageId = entry.slice(0, -5); if (!idValid(packageId)) throw Error('校样备份发现无效记录文件名。'); const record = await read(workspaceId, packageId);
      let active = true;
      try { await assertProject(record.projectId, workspaceId); for (const file of record.files) if (hash((await ownedArtifact(file.artifactId, workspaceId, file.projectId)).buffer) !== file.sha256) { active = false; break; } } catch { active = false; }
      if (active) packages.push(record);
    }
    return validateProofSnapshot({ version: 1, workspaceId, packages });
  }
  async function restoreWorkspace(snapshot) {
    validateProofSnapshot(snapshot);
    await checkedDirectory(fileSystem, path.join(root, snapshot.workspaceId), true);
    for (const record of snapshot.packages) {
      await assertProject(record.projectId, snapshot.workspaceId); for (const file of record.files) await assertProject(file.projectId, snapshot.workspaceId);
      let existing; try { existing = await read(snapshot.workspaceId, record.packageId); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (existing && JSON.stringify(existing) !== JSON.stringify(record)) throw Error('此校样包已恢复且存在不同反馈记录，未覆盖当前版本。');
    }
    for (const record of snapshot.packages) await save(record);
  }
  return { create: input => serial(() => create(input)), importFeedback: input => serial(() => importFeedback(input)), exportWorkspace: workspaceId => serial(() => exportWorkspace(workspaceId)), restoreWorkspace: snapshot => serial(() => restoreWorkspace(snapshot)), validateWorkspaceSnapshot: validateProofSnapshot, async drain() { await tail; }, async prepareClose() { closing = true; await tail; }, resume() { closing = false; }, async shutdown() { closing = true; await tail; } };
}
module.exports = { createCustomerProofing };
