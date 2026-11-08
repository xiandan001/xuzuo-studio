const fsDefault = require('node:fs/promises');
const path = require('node:path');
const { checkedDirectory } = require('./workspace-paths.cjs');
const { createRevisionStore } = require('./revision-store.cjs');
const { createSerialQueue } = require('./queue-lifecycle.cjs');
const core = require('./animation-document.runtime.cjs');

function checkedAnimationRecord(input, projectId) {
  if (!input || input.version !== 1 || input.projectId !== projectId || !core.animationId(input.projectId) || !Number.isSafeInteger(input.revision) || input.revision < 1 || typeof input.savedAt !== 'string' || typeof input.label !== 'string' || input.label.length > 160 || /[\u0000-\u001f\u007f]/.test(input.label)) throw Error('角色动画保存记录无效，原文件保留。');
  const document = core.checkedAnimationDocument(input.document, projectId);
  if (document.revision !== input.revision || document.updatedAt !== input.savedAt) throw Error('角色动画的项目或保存版本不一致，未覆盖原稿。');
  return { version: 1, projectId, revision: input.revision, savedAt: input.savedAt, label: input.label, document };
}

function createAnimationStore({ workspaceStorage, clock = Date.now, fileSystem = fsDefault, onChanged = () => undefined }) {
  const fs = fileSystem, queue = createSerialQueue();
  async function location(projectId) {
    if (!core.animationId(projectId)) throw Error('角色动画项目编号无效。');
    const project = path.resolve(await workspaceStorage.projectDirectory(projectId)), directory = path.join(project, '.xuzuo');
    await checkedDirectory(fs, directory); return { project, directory, filename: path.join(directory, 'animation-v1.json') };
  }
  const revisions = createRevisionStore({ fileSystem: fs, location, prefix: 'animation', validateRecord: checkedAnimationRecord, maxBytes: core.ANIMATION_MAX_DOCUMENT_BYTES, maxRevisions: 30 });
  async function state(projectId) {
    const raw = await revisions.raw(projectId);
    if (raw === undefined) {
      if ((await revisions.list(projectId)).length) throw Error('角色动画工程文件缺失，独立保存记录仍保留；请从保存记录显式恢复，不会创建空稿覆盖。');
      return { raw, current: undefined };
    }
    let record; try { record = JSON.parse(raw); } catch { throw Error('角色动画工程文件损坏，原文件保留；请从保存记录显式恢复。'); }
    return { raw, current: checkedAnimationRecord(record, projectId) };
  }
  function defaultDocument(projectId) { return core.newAnimationDocument(projectId, 'gif', clock); }
  async function commit(projectId, document, originalRaw, label, restore = false) {
    if (typeof label !== 'string' || !label.trim() || label.length > 160 || /[\u0000-\u001f\u007f]/.test(label)) throw Error('请输入有效的角色动画版本说明。');
    const revision = await revisions.nextRevision(projectId, document.revision), savedAt = new Date(clock()).toISOString();
    const record = checkedAnimationRecord({ version: 1, projectId, revision, savedAt, label: label.trim(), document: { ...document, projectId, revision, updatedAt: savedAt } }, projectId);
    await revisions.commit(projectId, record, originalRaw, { restore });
    try { onChanged({ projectId, revision }); } catch { /* Saved files outlive a renderer notification. */ }
    return structuredClone(record.document);
  }
  const api = {
    read({ projectId }) { return queue.run(projectId, async () => structuredClone((await state(projectId)).current?.document || defaultDocument(projectId))); },
    save({ projectId, expectedRevision, document: input, label = '保存编辑' }) {
      return queue.run(projectId, async () => {
        const document = core.checkedAnimationDocument(input, projectId);
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || document.revision !== expectedRevision) throw Error('角色动画的编辑基准版本无效，当前修改仍保留。');
        const found = await state(projectId);
        if ((found.current?.revision || 0) !== expectedRevision) { const error = Error('角色动画已在另一处更新，未覆盖新版本；请先读取最新工程。'); error.code = 'ANIMATION_CONFLICT'; throw error; }
        if (found.current && JSON.stringify(document) === JSON.stringify(found.current.document)) return structuredClone(found.current.document);
        return commit(projectId, document, found.raw, label);
      });
    },
    mutate(projectId, action, { label = '更新制作结果' } = {}) {
      return queue.run(projectId, async () => {
        const found = await state(projectId), draft = structuredClone(found.current?.document || defaultDocument(projectId));
        const output = await action(draft), document = core.checkedAnimationDocument(output === undefined ? draft : output, projectId);
        if (found.current && JSON.stringify(document) === JSON.stringify(found.current.document)) return structuredClone(found.current.document);
        return commit(projectId, document, found.raw, label);
      });
    },
    history({ projectId }) { return queue.run(projectId, async () => (await revisions.list(projectId)).map(record => ({ id: `animation-r${record.revision}`, label: record.label + (record.recoveryState === 'saved' ? '' : ' · 未完成保存恢复点'), revision: record.revision, createdAt: record.savedAt }))); },
    restore({ projectId, versionId, expectedRevision }) {
      return queue.run(projectId, async () => {
        const match = /^animation-r([1-9]\d*)$/.exec(versionId || ''); if (!match || !Number.isSafeInteger(Number(match[1]))) throw Error('请选择有效的角色动画保存记录。');
        const place = await location(projectId); let stat; try { stat = await fs.lstat(place.filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (stat?.size > core.ANIMATION_MAX_DOCUMENT_BYTES) throw Error('损坏工程超过安全恢复容量，请新建项目导入；原文件保留。');
        const raw = await revisions.raw(projectId, true), records = await revisions.list(projectId); let current;
        if (raw !== undefined) try { current = checkedAnimationRecord(JSON.parse(raw.toString('utf8')), projectId); } catch { /* Explicit restore preserves the original bytes first. */ }
        const baseline = current?.revision || records.find(record => record.recoveryState === 'saved')?.revision || 0;
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== baseline) { const error = Error('工程已在另一处更新，请重新读取保存记录后恢复。'); error.code = 'ANIMATION_CONFLICT'; throw error; }
        const source = records.find(record => record.revision === Number(match[1])); if (!source) throw Error('找不到这个角色动画保存记录。');
        return commit(projectId, source.document, raw, `恢复版本 ${source.revision}`, true);
      });
    },
    drain: queue.drain,
  };
  return api;
}
module.exports = { createAnimationStore, checkedAnimationRecord };
