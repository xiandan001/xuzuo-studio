const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { checkedDirectory, checkedFile, atomicJson } = require('./workspace-paths.cjs');
const { createDeliverySource, checkedSelection, hash } = require('./delivery-source.cjs');
const MAX_BYTES = 8 * 1024 * 1024;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);
const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function validState(value, projectId) {
  if (!value || value.version !== 1 || value.projectId !== projectId || !Array.isArray(value.receipts) || !value.reviews || typeof value.reviews !== 'object' || Array.isArray(value.reviews)) return false;
  if (Object.entries(value.reviews).some(([key, review]) => !fingerprint(key) || !review || typeof review.savedAt !== 'string' || !Array.isArray(review.checkedIds) || review.checkedIds.some(id => !validId(id)))) return false;
  return value.receipts.every(receipt => receipt && receipt.version === 1 && validId(receipt.id) && receipt.projectId === projectId && ['word', 'ppt', 'excel', 'image'].includes(receipt.kind) && typeof receipt.title === 'string' && typeof receipt.revision === 'string' && fingerprint(receipt.fingerprint) && typeof receipt.confirmedAt === 'string' && Array.isArray(receipt.files) && receipt.files.length > 0 && receipt.files.length <= 20 && receipt.files.every(file => file && validId(file.id) && typeof file.name === 'string' && typeof file.mimeType === 'string' && Number.isSafeInteger(file.bytes) && file.bytes > 0 && fingerprint(file.sha256)) && Array.isArray(receipt.checkedIds) && receipt.checkedIds.every(validId) && Array.isArray(receipt.checks));
}
function checkedChecks(value) {
  if (!Array.isArray(value) || value.length > 100 || value.some(item => !item || typeof item.id !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(item.id) || typeof item.label !== 'string' || item.label.length > 300 || typeof item.detail !== 'string' || item.detail.length > 10000 || !['passed', 'failed', 'unknown', 'manual'].includes(item.status)) || new Set(value.map(item => item.id)).size !== value.length) throw new Error('交付检查项目无效，请重新打开当前成品检查。');
  return value.map(({ id, label, detail, status }) => ({ id, label, detail, status }));
}
function createDeliveryStore(options) {
  const { workspaceStorage, artifactStore, fileSystem = fs, loadModule = require } = options;
  const source = createDeliverySource(options), queues = new Map();
  const serial = (id, action) => { const task = (queues.get(id) || Promise.resolve()).then(action); queues.set(id, task.catch(() => undefined)); return task; };
  async function location(projectId) { const project = await workspaceStorage.projectDirectory(projectId), directory = path.join(project, '.xuzuo'); await checkedDirectory(fileSystem, directory); return path.join(directory, 'deliveries-v1.json'); }
  async function load(projectId) {
    const filename = await location(projectId);
    try { const stat = await checkedFile(fileSystem, filename); if (stat.size > MAX_BYTES) throw new Error('too large'); const value = JSON.parse(await fileSystem.readFile(filename, 'utf8')); if (!validState(value, projectId)) throw new Error('invalid'); return value; }
    catch (error) { if (error.code === 'ENOENT') return { version: 1, projectId, reviews: {}, receipts: [] }; throw new Error('交付验收记录无法读取，原文件已保留，未用空记录覆盖。'); }
  }
  async function persist(value) { if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) throw new Error('交付历史超过容量，请先备份归档，已有记录未删除。'); await atomicJson(fileSystem, await location(value.projectId), value); }
  async function inspectUnlocked(raw) {
    const input = checkedSelection(raw), supplied = checkedChecks(input.checks), current = await source(input), state = await load(input.projectId);
    const checks = current.checks.map(check => { const stricter = supplied.find(item => item.id === check.id && item.status !== 'passed' && item.status !== 'manual'); return check.status === 'passed' && stricter ? stricter : check; });
    for (const check of supplied) if (!checks.some(item => item.id === check.id) && check.status !== 'passed') checks.push(check);
    const fingerprint = hash(JSON.stringify({ projectId: input.projectId, kind: input.kind, revision: current.revision, sourceHash: current.sourceHash, context: input.sourceRevision ?? null, files: current.files, checks }));
    const review = state.reviews[fingerprint], checkedIds = review?.checkedIds || [];
    const technical = checks.filter(check => check.status !== 'manual'), manual = checks.filter(check => check.status === 'manual');
    const ready = !current.errors.length && current.files.length > 0 && technical.length > 0 && technical.every(check => check.status === 'passed') && manual.length > 0 && manual.every(check => checkedIds.includes(check.id));
    const currentReceipt = state.receipts.find(item => item.fingerprint === fingerprint);
    return { projectId: input.projectId, kind: input.kind, title: current.title, revision: current.revision, fingerprint, files: current.files, checks, errors: current.errors, checkedIds, reviewSavedAt: review?.savedAt, ready, receipts: [...state.receipts].reverse(), ...(currentReceipt ? { currentReceipt } : {}) };
  }
  return {
    inspect(input) { return serial(input?.projectId, () => inspectUnlocked(input)); },
    saveReview(input) { return serial(input?.projectId, async () => {
      const current = await inspectUnlocked(input); if (current.fingerprint !== input.fingerprint) throw new Error('成品或检查条件已变化，未保存旧验收，请重新检查。');
      const manual = current.checks.filter(check => check.status === 'manual').map(check => check.id);
      if (!Array.isArray(input.checkedIds) || input.checkedIds.some(id => !manual.includes(id))) throw new Error('人工验收勾选无效。');
      const state = await load(input.projectId); state.reviews[current.fingerprint] = { checkedIds: [...new Set(input.checkedIds)], savedAt: new Date().toISOString() }; await persist(state); return inspectUnlocked(input);
    }); },
    confirm(input) { return serial(input?.projectId, async () => {
      const current = await inspectUnlocked(input); if (current.fingerprint !== input.fingerprint || !current.ready) throw new Error('当前版本尚未完成已保存的验收，或实际成品已变化，未确认交付。');
      if (current.currentReceipt) return current.currentReceipt;
      const state = await load(input.projectId);
      const receipt = { version: 1, id: randomUUID(), projectId: input.projectId, kind: input.kind, title: current.title, revision: current.revision, fingerprint: current.fingerprint, confirmedAt: new Date().toISOString(), files: current.files, checks: current.checks, checkedIds: current.checkedIds };
      state.receipts.push(receipt); await persist(state); return receipt;
    }); },
    history({ projectId }) { return serial(projectId, async () => [...(await load(projectId)).receipts].reverse()); },
    exportZip({ projectId, deliveryId, destination, beforeWrite }) { return serial(projectId, async () => {
      const receipt = (await load(projectId)).receipts.find(item => item.id === deliveryId); if (!receipt) throw new Error('找不到这次已确认交付。');
      if (typeof destination !== 'string' || !path.isAbsolute(destination) || path.extname(destination).toLowerCase() !== '.zip') throw new Error('请选择有效的ZIP保存位置。');
      await checkedDirectory(fileSystem, path.dirname(destination));
      const JSZip = loadModule('jszip'), zip = new JSZip(), manifest = { version: 1, title: receipt.title, kind: receipt.kind, confirmedAt: receipt.confirmedAt, files: [] };
      for (const [index, expected] of receipt.files.entries()) {
        const file = await artifactStore.read(expected.id), bytes = Buffer.from(file.buffer);
        if (file.projectId !== projectId || hash(bytes) !== expected.sha256 || bytes.length !== expected.bytes) throw new Error('已确认文件的实际内容已变化或不可用，未打包错误成品。');
        const basename = `${String(index + 1).padStart(2, '0')}-${String(expected.name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+|[.\s]+$/g, '').slice(0, 150) || '成品'}`;
        zip.file(basename, bytes); manifest.files.push({ name: basename, mimeType: expected.mimeType, bytes: expected.bytes, sha256: expected.sha256 });
      }
      zip.file('交付说明.json', `${JSON.stringify(manifest, null, 2)}\n`);
      const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }), temporary = `${destination}.${randomUUID()}.tmp`;
      try { await fileSystem.writeFile(temporary, buffer, { flag: 'wx' }); await beforeWrite?.(); await fileSystem.rename(temporary, destination); } catch (error) { await fileSystem.unlink(temporary).catch(() => undefined); throw error; }
      return { saved: true, path: destination, sha256: hash(buffer), bytes: buffer.length };
    }); },
    async drain() { await Promise.allSettled([...queues.values()]); },
  };
}
module.exports = { createDeliveryStore, checkedChecks };
