const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createRevisionStore } = require('./revision-store.cjs');
const { createSerialQueue } = require('./queue-lifecycle.cjs');
const { checkedDirectory } = require('./workspace-paths.cjs');
const { validId, checkedCommerceDocument } = require('./commerce-image-document.cjs');
const active = signal => { if (signal?.aborted) throw Object.assign(Error('图层操作已取消，原图和费用保留。'), { name: 'AbortError' }); };
const defaultDocumentId = source => 'commerce-' + createHash('sha256').update(source).digest('hex').slice(0, 32);
function createCommerceImageStore({ workspaceStorage, fileSystem = fs }) {
  const queue = createSerialQueue(), revisions = new Map();
  function scope(input) {
    const documentId = input?.documentId || defaultDocumentId(input?.sourceArtifactId || '');
    if (!validId(input?.projectId) || !validId(input?.sourceArtifactId) || !validId(documentId)) throw Error('请选择本项目的有效图片与图层工程。');
    return { projectId: input.projectId, sourceArtifactId: input.sourceArtifactId, documentId };
  }
  async function directory(projectId, create = true) {
    const root = path.resolve(await workspaceStorage.projectDirectory(projectId)), result = path.join(root, '.xuzuo', 'commerce-images');
    await checkedDirectory(fileSystem, result, create); return result;
  }
  async function resolveScope(input) {
    const value = scope(input); if (input.documentId) return value;
    const project = path.resolve(await workspaceStorage.projectDirectory(value.projectId)), filename = path.join(project, '.xuzuo', 'commerce-images', value.sourceArtifactId, 'default-v1.json');
    let stat; try { stat = await fileSystem.lstat(filename); } catch (error) { if (error.code === 'ENOENT') return value; throw error; }
    await checkedDirectory(fileSystem, path.dirname(filename));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2000) throw Error('图层默认工程指针不可安全读取，当前文件保留。');
    let pointer; try { pointer = JSON.parse(await fileSystem.readFile(filename, 'utf8')); } catch { throw Error('图层默认工程指针损坏，未新建空工程覆盖。'); }
    if (pointer.type !== 'commerce-default' || pointer.version !== 1 || pointer.projectId !== value.projectId || pointer.sourceArtifactId !== value.sourceArtifactId || !validId(pointer.documentId)) throw Error('图层默认工程来源不一致。');
    return { ...value, documentId: pointer.documentId };
  }
  function revisionsFor(input) {
    const value = scope(input), key = [value.projectId, value.sourceArtifactId, value.documentId].join('/');
    if (revisions.has(key)) return revisions.get(key);
    let commitSignal;
    const checkedRecord = (record, projectId) => {
      if (!record || record.version !== 1 || record.projectId !== projectId || record.sourceArtifactId !== value.sourceArtifactId || record.documentId !== value.documentId || !Number.isSafeInteger(record.revision) || record.revision < 1 || typeof record.savedAt !== 'string') throw Error('图层保存记录损坏，原文件保留。');
      const document = checkedCommerceDocument(record.document);
      if (document.projectId !== projectId || document.id !== value.documentId || document.sourceArtifactId !== value.sourceArtifactId || document.revision !== record.revision) throw Error('图层工程保存版本或来源不一致。');
      return { version: 1, projectId, sourceArtifactId: value.sourceArtifactId, documentId: value.documentId, revision: record.revision, savedAt: record.savedAt, document };
    };
    const instance = createRevisionStore({ fileSystem: { ...fileSystem, async rename(from, to) { active(commitSignal); return fileSystem.rename(from, to); } }, prefix: 'commerce-image', maxBytes: 2 * 1024 * 1024, maxRevisions: 20, validateRecord: checkedRecord, async location(projectId) {
      const root = await directory(projectId), location = path.join(root, value.sourceArtifactId, value.documentId); await checkedDirectory(fileSystem, location, true); return { project: root, directory: location, filename: path.join(location, 'document-v1.json') };
    } });
    const state = async () => {
      const raw = await instance.raw(value.projectId);
      if (raw === undefined) { if ((await instance.list(value.projectId)).length) throw Error('图层工程文件缺失，独立记录仍保留，请先从保存记录恢复。'); return { raw, record: undefined }; }
      let parsed; try { parsed = JSON.parse(raw); } catch { throw Error('图层工程文件无法读取，原始内容已保留。'); }
      return { raw, record: checkedRecord(parsed, value.projectId) };
    };
    const entry = { ...value, key, instance, state, setSignal: signal => { commitSignal = signal; }, checkedRecord }; revisions.set(key, entry); return entry;
  }
  async function commit(entry, document, raw, signal, restore = false) {
    active(signal); entry.setSignal(signal);
    try {
      const revision = await entry.instance.nextRevision(entry.projectId, document.revision), savedAt = new Date().toISOString();
      const record = entry.checkedRecord({ version: 1, projectId: entry.projectId, sourceArtifactId: entry.sourceArtifactId, documentId: entry.documentId, revision, savedAt, document: { ...document, revision, updatedAt: savedAt } }, entry.projectId);
      await entry.instance.commit(entry.projectId, record, raw, { restore }); active(signal); return record.document;
    } finally { entry.setSignal(undefined); }
  }
  return {
    scope, resolveScope,
    async read(input) { const entry = revisionsFor(await resolveScope(input)); return queue.run(entry.key, async () => (await entry.state()).record?.document); },
    async save(input, signal) { const entry = revisionsFor(await resolveScope(input)); return queue.run(entry.key, async () => {
      const document = checkedCommerceDocument(input.document), found = await entry.state();
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || document.revision !== input.expectedRevision || document.id !== entry.documentId || document.projectId !== entry.projectId || document.sourceArtifactId !== entry.sourceArtifactId || (found.record?.revision || 0) !== input.expectedRevision) throw Error('图层工程已在另一处更新，请先读取新版本，当前编辑保留。');
      const saved = await commit(entry, document, found.raw, signal);
      if (entry.documentId === defaultDocumentId(entry.sourceArtifactId)) {
        const root = await directory(entry.projectId), folder = path.join(root, entry.sourceArtifactId); await checkedDirectory(fileSystem, folder, true);
        const temporary = path.join(folder, `default-${randomUUID()}.tmp`); await fileSystem.writeFile(temporary, JSON.stringify({ type: 'commerce-default', version: 1, projectId: entry.projectId, sourceArtifactId: entry.sourceArtifactId, documentId: entry.documentId }) + '\n', { flag: 'wx' }); active(signal); await fileSystem.rename(temporary, path.join(folder, 'default-v1.json'));
      }
      return saved;
    }); },
    async history(input) { const entry = revisionsFor(await resolveScope(input)); return queue.run(entry.key, async () => (await entry.instance.list(entry.projectId)).map(record => ({ revision: record.revision, title: record.document.title, savedAt: record.savedAt }))); },
    async restore(input, signal) { const entry = revisionsFor(await resolveScope(input)); return queue.run(entry.key, async () => {
      const found = await entry.state(); if ((found.record?.revision || 0) !== input.expectedRevision) throw Error('图层保存基准已变化，请重新读取记录。');
      const record = (await entry.instance.list(entry.projectId)).find(record => record.revision === input.revision); if (!record) throw Error('所选保存记录已不可用。');
      return commit(entry, record.document, found.raw, signal, true);
    }); },
    async link(projectId, artifactId, snapshotId, workingDocumentId = randomUUID()) {
      if (![projectId, artifactId, snapshotId, workingDocumentId].every(validId)) throw Error('图层回编辑关联无效。');
      const root = await directory(projectId), output = path.join(root, 'exports'); await checkedDirectory(fileSystem, output, true);
      const value = { version: 1, projectId, artifactId, snapshotId, workingDocumentId };
      await fileSystem.writeFile(path.join(output, `${artifactId}.json`), JSON.stringify(value) + '\n', { flag: 'wx' }); return value;
    },
    async linked(projectId, artifactId) {
      if (![projectId, artifactId].every(validId)) throw Error('图层来源编号无效。');
      const root = path.resolve(await workspaceStorage.projectDirectory(projectId)), filename = path.join(root, '.xuzuo', 'commerce-images', 'exports', `${artifactId}.json`);
      let stat; try { stat = await fileSystem.lstat(filename); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
      await checkedDirectory(fileSystem, path.dirname(filename)); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2000) throw Error('回编辑关联文件不可安全读取，未将成品当作平面图片覆盖。');
      let value; try { value = JSON.parse(await fileSystem.readFile(filename, 'utf8')); } catch { throw Error('回编辑关联损坏，原成品和工程仍保留。'); }
      if (value.version !== 1 || value.projectId !== projectId || value.artifactId !== artifactId || !validId(value.snapshotId) || !validId(value.workingDocumentId)) throw Error('回编辑关联来源不一致。'); return value;
    },
    drain: () => queue.drain(),
  };
}
module.exports = { createCommerceImageStore, defaultDocumentId, active };
