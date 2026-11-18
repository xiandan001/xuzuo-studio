const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { checkedDirectory, checkedFile, atomicJson } = require('./workspace-paths.cjs');
const { checkedCommerceDocument, commerceDocumentHash, validId } = require('./commerce-image-document.cjs');
const { checkedReflowTargets } = require('./commerce-reflow.cjs');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const jobId = value => typeof value === 'string' && /^\d{13}-[a-f0-9-]{36}$/.test(value);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const ownScope = (value, scope) => value.projectId === scope.projectId && value.sourceArtifactId === scope.sourceArtifactId && value.documentId === scope.documentId;

function checkedReflowJob(value) {
  if (!value || value.type !== 'commerce-reflow-job' || value.version !== 1 || !jobId(value.id) || !['projectId', 'sourceArtifactId', 'documentId'].every(key => validId(value[key])) || !date(value.createdAt) || !date(value.updatedAt) || !sha(value.sourceHash) || !Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 1 || value.error !== undefined && (typeof value.error !== 'string' || value.error.length > 1000)) throw Error('本地导出续存记录无效，原稿和已保存文件保留。');
  const original = checkedCommerceDocument(value.originalDocument);
  if (original.id !== value.documentId || original.projectId !== value.projectId || original.sourceArtifactId !== value.sourceArtifactId || original.revision !== value.sourceRevision || commerceDocumentHash(original) !== value.sourceHash) throw Error('导出续存的原稿来源已变化，请重新预览确认。');
  if (!Array.isArray(value.fingerprints) || !value.fingerprints.length || value.fingerprints.length > 33 || value.fingerprints.some(item => !item || !validId(item.artifactId) || !sha(item.sha256)) || new Set(value.fingerprints.map(item => item.artifactId)).size !== value.fingerprints.length) throw Error('导出续存的图片来源记录无效。');
  const expectedImages = new Set([original.sourceArtifactId, ...original.layers.filter(layer => layer.type === 'image' && layer.visible && layer.opacity > 0).map(layer => layer.artifactId)]);
  if (expectedImages.size !== value.fingerprints.length || value.fingerprints.some(item => !expectedImages.has(item.artifactId))) throw Error('导出续存的图片清单与原稿不符。');
  const targets = checkedReflowTargets(value.targets);
  if (!Array.isArray(value.approvedTargetIds) || value.approvedTargetIds.length !== targets.length || new Set(value.approvedTargetIds).size !== targets.length || new Set(value.targets.map(item => item.id)).size !== targets.length || new Set(value.targets.map(item => item.runId)).size !== targets.length) throw Error('导出续存缺少逐版确认，不能继续写入。');
  for (const target of value.targets) {
    const document = checkedCommerceDocument(target.document);
    if (!validId(target.id) || !validId(target.runId) || !value.approvedTargetIds.includes(target.id) || document.id === original.id || document.projectId !== value.projectId || document.sourceArtifactId !== value.sourceArtifactId || document.sourceSha256 !== original.sourceSha256 || document.width !== target.width || document.height !== target.height || document.revision !== 0 || !Array.isArray(target.warnings) || target.warnings.some(warning => typeof warning !== 'string' || warning.length > 500)) throw Error('导出续存的目标版式无效。');
    if (target.completed !== undefined) {
      const result = target.completed;
      if (!result || result.documentId !== document.id || result.runId !== target.runId || !Number.isSafeInteger(result.sourceRevision) || result.sourceRevision < 1 || !Array.isArray(result.artifacts) || result.artifacts.length !== 2 || new Set(result.artifacts.map(file => file.id)).size !== 2 || !result.artifacts.some(file => file.mimeType === 'image/png') || !result.artifacts.some(file => file.mimeType === 'application/json') || result.artifacts.some(file => !validId(file.id) || !['image/png', 'application/json'].includes(file.mimeType) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 100 * 1024 * 1024 || !sha(file.sha256))) throw Error('已完成版的文件记录无效，未重写原文件。');
    }
  }
  return value;
}

function createReflowJobStore({ workspaceStorage, fileSystem = fsDefault }) {
  const fs = fileSystem;
  async function directory(scope, create = false) {
    if (!['projectId', 'sourceArtifactId', 'documentId'].every(key => validId(scope?.[key]))) throw Error('请选择当前项目的有效原稿工程。');
    const project = path.resolve(await workspaceStorage.projectDirectory(scope.projectId)), folder = path.join(project, '.xuzuo', 'commerce-reflow', scope.documentId);
    if (!create) { try { await fs.lstat(folder); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } }
    await checkedDirectory(fs, folder, create); return folder;
  }
  async function read(scope, id) {
    if (!jobId(id)) throw Error('本地导出续存编号无效。');
    const folder = await directory(scope); if (!folder) throw Error('续存记录已不在当前项目，请重新预览。');
    const filename = path.join(folder, id + '.json'), stat = await checkedFile(fs, filename); if (stat.size > 2 * 1024 * 1024) throw Object.assign(Error('本地导出续存记录过大。'), { code: 'REFLOW_JOB_INVALID' });
    const bytes = await fs.readFile(filename, 'utf8'); let envelope, job;
    try {
      envelope = JSON.parse(bytes);
      if (envelope.version !== 1 || !sha(envelope.sha256) || digest(envelope.job) !== envelope.sha256) throw Error('续存记录校验未通过，请重新预览；原稿和成品保留。');
      job = checkedReflowJob(envelope.job); if (job.id !== id || !ownScope(job, scope)) throw Error('续存记录不属于当前项目和原稿。');
    } catch (error) { error.code = 'REFLOW_JOB_INVALID'; throw error; }
    return { job, sha256: envelope.sha256, filename };
  }
  async function index(scope, folder) {
    const filename = path.join(folder, 'index-v1.json');
    try {
      const stat = await checkedFile(fs, filename); if (stat.size > 16384) throw Error('续存索引过大。');
      const value = JSON.parse(await fs.readFile(filename, 'utf8'));
      if (value.type !== 'commerce-reflow-index' || value.version !== 1 || !ownScope(value, scope) || !Array.isArray(value.pending) || value.pending.length > 20 || !Array.isArray(value.completed) || value.completed.length > 3 || [...value.pending, ...value.completed].some(id => !jobId(id)) || new Set([...value.pending, ...value.completed]).size !== value.pending.length + value.completed.length) throw Error('续存索引无效。');
      return value;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const jobs = (await fs.readdir(folder)).filter(name => name.endsWith('.json') && jobId(name.slice(0, -5)));
      if (jobs.length === 1) { const orphan = (await read(scope, jobs[0].slice(0, -5))).job, done = orphan.targets.every(target => target.completed); return { type: 'commerce-reflow-index', version: 1, ...scope, pending: done ? [] : [orphan.id], completed: done ? [orphan.id] : [] }; }
      if (jobs.length) throw Error('续存索引缺失，已有文件保留，请从备份恢复记录或重新预览。');
      return { type: 'commerce-reflow-index', version: 1, ...scope, pending: [], completed: [] };
    }
  }
  async function indexed(scope, folder, job) {
    const value = await index(scope, folder), done = job.targets.every(target => target.completed);
    let pending = value.pending.filter(id => id !== job.id); const completed = value.completed.filter(id => id !== job.id);
    if (![...value.pending, ...value.completed].includes(job.id)) {
      const sameSource = [];
      for (const id of pending) {
        try { const previous = (await read(scope, id)).job; if (previous.sourceHash === job.sourceHash && !previous.targets.every(target => target.completed)) sameSource.push(id); }
        catch (error) { if (!['ENOENT', 'REFLOW_JOB_INVALID'].includes(error.code)) throw error; }
      }
      pending = sameSource;
    }
    if (!done && pending.length >= 20) throw Error('当前原稿已有20项未完成导出，请先继续其中一项。');
    if (done) completed.unshift(job.id); else pending.unshift(job.id);
    return { ...value, pending, completed: completed.slice(0, 3) };
  }
  return {
    read,
    async key(scope, id) { if (!jobId(id)) throw Error('续存编号无效。'); return path.join(await directory(scope, true), id + '.json'); },
    async list(scope) {
      const folder = await directory(scope); if (!folder) return { jobs: [], errors: [] };
      let pointers; try { pointers = await index(scope, folder); } catch { return { jobs: [], errors: ['续存索引暂不可读取，请重新预览；原稿和已完成文件保留。'] }; }
      const jobs = [], errors = [];
      for (const id of [...pointers.pending, ...pointers.completed]) { try { const value = await read(scope, id); jobs.push(value.job); } catch { errors.push('有一份续存记录来源或校验已变化，请重新预览；已保存文件仍在项目中。'); } }
      return { jobs, errors: [...new Set(errors)] };
    },
    async save(job, expectedHash) {
      checkedReflowJob(job); const scope = { projectId: job.projectId, sourceArtifactId: job.sourceArtifactId, documentId: job.documentId }, folder = await directory(scope, true), filename = path.join(folder, job.id + '.json');
      const sha256 = digest(job), envelope = { version: 1, sha256, job };
      if (Buffer.byteLength(JSON.stringify(envelope, null, 2) + '\n', 'utf8') > 2 * 1024 * 1024) throw Error('本次版式续存记录超过2MB，请减少文案或目标后重新预览。');
      const pointers = await indexed(scope, folder, job);
      if (expectedHash) { const previous = await read(scope, job.id); if (previous.sha256 !== expectedHash) throw Error('续存记录已在另一处更新，请重新读取；没有覆盖已有进度。'); }
      else { try { await fs.lstat(filename); throw Error('续存编号已存在，未覆盖先前进度。'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
      await atomicJson(fs, filename, envelope); await atomicJson(fs, path.join(folder, 'index-v1.json'), pointers); return sha256;
    },
  };
}
module.exports = { checkedReflowJob, createReflowJobStore };
