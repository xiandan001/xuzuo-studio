const fs = require('node:fs/promises');
const path = require('node:path');
const { validateEditorDocument, editorImageIds } = require('./editor-document.cjs');
const { createRevisionStore } = require('./revision-store.cjs');
const { createSerialQueue } = require('./queue-lifecycle.cjs');
const MAX_BYTES = 4 * 1024 * 1024;
function createEditorStore({ workspaceStorage, artifactStore, fileSystem = fs }) {
  const queue = createSerialQueue(), serial = queue.run;
  async function location(projectId) {
    if (typeof projectId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(projectId)) throw new Error('项目编号无效。');
    const project = path.resolve(await workspaceStorage.projectDirectory(projectId));
    const directory = path.join(project, '.xuzuo');
    const drive = path.parse(directory).root; let current = drive;
    for (const part of directory.slice(drive.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      const stat = await fileSystem.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('项目编辑目录包含链接或不是普通目录，已拒绝写入。');
    }
    return { project, directory, filename: path.join(directory, 'editor-v1.json') };
  }
  function checkedRecord(value, projectId) {
    if (!value || value.version !== 1 || value.projectId !== projectId || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.savedAt !== 'string' || !Array.isArray(value.sourceArtifactIds) || value.sourceArtifactIds.length > 20 || value.sourceArtifactIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(id))) throw new Error('编辑源文件格式无效，原文件已保留。');
    return { version: 1, projectId, revision: value.revision, savedAt: value.savedAt, document: validateEditorDocument(value.document), sourceArtifactIds: [...value.sourceArtifactIds] };
  }
  const revisions = createRevisionStore({ fileSystem, location, prefix: 'editor', validateRecord: checkedRecord, maxBytes: MAX_BYTES });
  const publicRecord = value => checkedRecord(value, value.projectId);
  async function readState(projectId) {
    const raw = await revisions.raw(projectId);
    if (raw === undefined) return { raw, current: null, history: [] };
    let value; try { value = JSON.parse(raw); } catch { throw new Error('编辑源文件损坏，原文件已保留，请从独立历史版本恢复。'); }
    if (!Array.isArray(value?.history)) throw new Error('编辑源文件格式无效，原文件已保留。');
    const current = checkedRecord(value, projectId), history = value.history.map(item => checkedRecord(item, projectId));
    if (new Set(history.map(item => item.revision)).size !== history.length || history.some(item => item.revision >= current.revision)) throw new Error('编辑源历史版本顺序无效，原文件已保留。');
    return { raw, current, history };
  }
  async function records(projectId) {
    let state, error;
    try { state = await readState(projectId); } catch (cause) { error = cause; }
    const items = await revisions.list(projectId, state ? [...state.history, ...(state.current ? [state.current] : [])] : []);
    if (!items.length && error) throw error;
    return items;
  }
  async function verifyImages(document, projectId) {
    for (const id of editorImageIds(document)) {
      const image = await artifactStore.read(id);
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType) || image.trashedAt || image.projectId && image.projectId !== projectId) throw new Error('插图不属于当前项目、已在回收站或不是受支持图片。');
    }
  }
  async function prepare(input) {
    const document = validateEditorDocument(input?.document);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error('编辑版本无效。');
    const state = await readState(input.projectId), previous = state.current;
    if (!previous && (await revisions.list(input.projectId)).length) throw new Error('编辑源文件缺失，已保留独立历史版本，请从历史恢复后再保存。');
    if ((previous?.revision || 0) !== input.expectedRevision) throw new Error('文档已在另一处更新。当前修改仍保留，请先查看最新版本再保存。');
    if (previous && previous.document.kind !== document.kind) throw new Error('不能把现有项目改为另一种文档类型。');
    const sources = input.sourceArtifactIds ?? previous?.sourceArtifactIds ?? [];
    if (!Array.isArray(sources) || sources.length > 20 || sources.some(id => typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(id))) throw new Error('内容来源编号无效。');
    await verifyImages(document, input.projectId);
    const record = { version: 1, projectId: input.projectId, revision: await revisions.nextRevision(input.projectId, previous?.revision || 0), savedAt: new Date().toISOString(), document, sourceArtifactIds: [...new Set(sources)] };
    if (Buffer.byteLength(JSON.stringify({ ...record, history: [] })) > MAX_BYTES) throw new Error('当前文档修订超过本地编辑源容量，请拆分内容；原版本仍保留。');
    return { state, record };
  }
  async function commit(prepared) {
    const { state, record } = prepared;
    return revisions.commit(record.projectId, record, state.raw, { legacy: [...state.history, ...(state.current ? [state.current] : [])] });
  }
  async function restore({ projectId, revision }) {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('请选择有效的历史修订。');
    const items = await records(projectId), source = items.find(item => item.revision === revision);
    if (!source) throw new Error('找不到这个编辑版本。');
    const raw = await revisions.raw(projectId, true);
    await verifyImages(source.document, projectId);
    const record = { ...publicRecord(source), revision: await revisions.nextRevision(projectId, Math.max(...items.map(item => item.revision))), savedAt: new Date().toISOString() };
    return revisions.commit(projectId, record, raw, { restore: true, legacy: items.filter(item => item.recoveryState === 'saved') });
  }
  return {
    drain: queue.drain, flush: queue.flush,
    async load({ projectId, kind }) { return serial(projectId, async () => { const { current } = await readState(projectId); if (!current && (await revisions.list(projectId)).length) throw new Error('编辑源文件缺失，已保留独立历史版本，请从历史恢复。'); if (current && current.document.kind !== kind) throw new Error('项目文档类型与编辑源不匹配。'); return current ? publicRecord(current) : null; }); },
    save(input) { return serial(input.projectId, async () => commit(await prepare(input))); },
    history({ projectId }) { return serial(projectId, async () => (await records(projectId)).map(item => ({ revision: item.revision, savedAt: item.savedAt, title: item.document.title, kind: item.document.kind, recoveryState: item.recoveryState }))); },
    loadVersion({ projectId, revision }) { return serial(projectId, async () => { const record = (await records(projectId)).find(item => item.revision === revision); if (!record) throw new Error('找不到这个编辑版本。'); return publicRecord(record); }); },
    restore(input) { return serial(input.projectId, () => restore(input)); },
    export(input) { return serial(input.projectId, async () => {
      const prepared = await prepare(input), { record } = prepared;
      const artifacts = await artifactStore.exportOffice({ kind: record.document.kind, title: record.document.title, text: JSON.stringify({ editorDocument: record.document }), assets: editorImageIds(record.document), projectId: input.projectId, runId: `editor-${input.projectId}-${record.revision}` });
      return { record: await commit(prepared), artifacts };
    }); },
  };
}
module.exports = { createEditorStore };
