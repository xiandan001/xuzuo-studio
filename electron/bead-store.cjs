const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { checkedDirectory } = require('./workspace-paths.cjs');
const { createRevisionStore } = require('./revision-store.cjs');
const { createSerialQueue } = require('./queue-lifecycle.cjs');
const { checkedBeadDocument } = require('./bead-document.cjs');
const { validId, ensureBeadActive } = require('./bead-source.cjs');
function createBeadStore({ workspaceStorage, fileSystem = fs }) {
  const queue = createSerialQueue(), commitSignals = new Map();
  const guardedFs = { ...fileSystem, async rename(from, to) { ensureBeadActive(commitSignals.get(path.resolve(to))); return fileSystem.rename(from, to); } };
  async function location(projectId) {
    if (!validId(projectId)) throw Error('拼豆项目编号无效。');
    const project = path.resolve(await workspaceStorage.projectDirectory(projectId)), directory = path.join(project, '.xuzuo');
    await checkedDirectory(fileSystem, directory); return { project, directory, filename: path.join(directory, 'bead-v1.json') };
  }
  function checkedRecord(record, projectId) {
    if (!record || record.version !== 1 || record.projectId !== projectId || !Number.isSafeInteger(record.revision) || record.revision < 1 || typeof record.savedAt !== 'string') throw Error('拼豆保存记录格式无效，原文件保留。');
    const document = checkedBeadDocument(record.document);
    if (document.projectId !== projectId || document.revision !== record.revision || document.updatedAt !== record.savedAt) throw Error('拼豆工程的项目或保存版本不一致，未覆盖文件。');
    return { version: 1, projectId, revision: record.revision, savedAt: record.savedAt, document };
  }
  const revisions = createRevisionStore({ fileSystem: guardedFs, location, prefix: 'bead', validateRecord: checkedRecord, maxBytes: 8 * 1024 * 1024, maxRevisions: 30 });
  async function state(projectId) {
    const raw = await revisions.raw(projectId);
    if (raw === undefined) {
      if ((await revisions.list(projectId)).length) throw Error('拼豆图纸文件缺失，已保留独立恢复点；请从保存记录显式恢复，不会创建空图覆盖。');
      return { raw, current: undefined };
    }
    let record; try { record = JSON.parse(raw); } catch { throw Error('拼豆图纸文件损坏，原文件已保留；请导入工程JSON恢复。'); }
    return { raw, current: checkedRecord(record, projectId) };
  }
  async function commit(projectId, document, originalRaw, signal, restore = false) {
    ensureBeadActive(signal); const place = await location(projectId); commitSignals.set(place.filename, signal);
    try {
      const revision = await revisions.nextRevision(projectId, document.revision), timestamp = new Date().toISOString();
      const record = checkedRecord({ version: 1, projectId, revision, savedAt: timestamp, document: { ...document, revision, updatedAt: timestamp } }, projectId);
      ensureBeadActive(signal); await revisions.commit(projectId, record, originalRaw, { restore }); return record.document;
    } finally { commitSignals.delete(place.filename); }
  }
  async function captureBaseline(projectId) {
    const place = await location(projectId); let stat;
    try { stat = await fileSystem.lstat(place.filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat?.size > 8 * 1024 * 1024) throw Error('损坏图纸超过安全恢复容量，请新建项目导入；原文件保留。');
    const raw = await revisions.raw(projectId, true); let current;
    if (raw !== undefined) try { current = checkedRecord(JSON.parse(raw.toString('utf8')), projectId); } catch { /* Explicit restoration can replace a broken pointer after preserving it. */ }
    const latest = current || (await revisions.list(projectId)).find(item => item.recoveryState === 'saved');
    return { raw, id: latest?.document.id, revision: latest?.revision || 0 };
  }
  return {
    async read({ projectId }) { return queue.run(projectId, async () => { const found = await state(projectId); return found.current ? structuredClone(found.current.document) : undefined; }); },
    save({ projectId, document: input, expectedRevision }, signal) {
      return queue.run(projectId, async () => {
        const document = checkedBeadDocument(input);
        if (document.projectId !== projectId || document.revision !== expectedRevision || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Error('拼豆工程所属项目或编辑基准版本无效，当前修改仍保留。');
        const found = await state(projectId);
        if ((found.current?.revision || 0) !== expectedRevision || found.current && found.current.document.id !== document.id) throw Error('图纸已在另一处更新，未覆盖新版本；请先读取最新图纸。');
        return commit(projectId, document, found.raw, signal);
      });
    },
    async captureImport(projectId) { return queue.run(projectId, () => captureBaseline(projectId)); },
    history({ projectId }) { return queue.run(projectId, async () => (await revisions.list(projectId)).map(item => ({ revision: item.revision, title: item.document.title, updatedAt: item.savedAt, columns: item.document.pattern.columns, rows: item.document.pattern.rows, recoveryState: item.recoveryState }))); },
    restore({ projectId, revision, expectedRevision }, signal) { return queue.run(projectId, async () => {
      if (!Number.isSafeInteger(revision) || revision < 1) throw Error('请选择有效的拼豆保存记录。');
      const baseline = await captureBaseline(projectId);
      if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision !== baseline.revision)) throw Error('图纸已在另一处更新，请重新读取保存记录再恢复。');
      const source = (await revisions.list(projectId)).find(item => item.revision === revision);
      if (!source) throw Error('这个自动保存记录已不可用，请选择其他记录或导入恢复JSON。');
      const document = checkedBeadDocument({ ...source.document, id: baseline.id || source.document.id, projectId, revision: 0 });
      return commit(projectId, document, baseline.raw, signal, true);
    }); },
    importDocument(projectId, input, baseline, signal) {
      return queue.run(projectId, async () => {
        const imported = checkedBeadDocument(input), detached = imported.projectId !== projectId;
        const document = { ...imported, id: baseline.id || randomUUID(), projectId, revision: 0, ...(detached ? { referenceId: undefined, sourceSha256: undefined } : {}) };
        return commit(projectId, checkedBeadDocument(document), baseline.raw, signal, true);
      });
    },
    drain: queue.drain,
  };
}
module.exports = { createBeadStore };
