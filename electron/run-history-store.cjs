const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { checkedDirectory, checkedFile, atomicJson } = require('./workspace-paths.cjs');
const { stepReferenceIssue } = require('./workflow-references.cjs');
const digest = text => createHash('sha256').update(text).digest('hex');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(value);
const runFile = /^[A-Za-z0-9-]{1,160}-[a-f0-9]{64}\.json$/;
function validateRecords(records) {
  if (!Array.isArray(records) || records.some(item => !item || !validId(item.run?.id) || !validId(item.run.projectId) || !validId(item.run.workspaceId) || !Array.isArray(item.run.snapshot?.steps) || !Array.isArray(item.run.attempts) || !Array.isArray(item.ledger) || !item.request?.project || !item.request?.workflow || !Array.isArray(item.request.connections) || !Array.isArray(item.request.models)) || new Set(records.map(item => item.run.id)).size !== records.length) throw new Error('真实运行记录格式无效或编号重复，原文件已保留。');
  const ledgerIds = records.flatMap(item => item.ledger.map(entry => entry.id));
  if (records.some(item => [...item.run.snapshot.steps, ...(item.request.workflow.steps || [])].some(step => stepReferenceIssue(step)))) throw new Error('运行历史中的步骤参考文件无效，原记录已保留。');
  if (ledgerIds.some(id => !validId(id)) || new Set(ledgerIds).size !== ledgerIds.length) throw new Error('真实运行账本包含重复编号，原文件已保留。');
  return records;
}
function runSummary(run) {
  return { ...run, contentTruncated: true, input: '', variables: {}, snapshot: { ...run.snapshot, description: '', steps: run.snapshot.steps.map(step => ({ ...step, prompt: '' })) }, attempts: run.attempts.map(attempt => ({ ...attempt, input: '', prompt: '', summary: '' })) };
}
function createRunHistoryStore({ directory, fileSystem: fs }) {
  const root = path.join(directory, 'live-runs-v2'), indexFile = path.join(root, 'index-v2.json'), legacyFile = path.join(directory, 'live-workflows-v1.json');
  let committed = new Map();
  async function json(filename) {
    const stat = await fs.lstat(filename); await checkedDirectory(fs, path.dirname(filename));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > (filename === legacyFile ? 512 : 100) * 1024 * 1024) throw new Error('真实运行记录不是普通文件或超过迁移容量，原文件已保留。');
    try { return JSON.parse(await fs.readFile(filename, 'utf8')); } catch { throw new Error('真实运行记录无法读取，原文件已保留。'); }
  }
  async function load() {
    let index;
    try { index = await json(indexFile); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      let legacy; try { legacy = await json(legacyFile); } catch (legacyError) { if (legacyError.code === 'ENOENT') return { revision: 0, records: [], fresh: true }; throw legacyError; }
      if (legacy.version !== 1) throw new Error('真实运行记录版本无效，原文件已保留。');
      return { revision: legacy.revision || 0, records: validateRecords(legacy.records), legacy: true };
    }
    if (index.version !== 2 || !Number.isSafeInteger(index.revision) || index.revision < 0 || !Array.isArray(index.records) || index.records.some(item => !validId(item.id) || !runFile.test(item.fileName) || !/^[a-f0-9]{64}$/.test(item.sha256)) || new Set(index.records.map(item => item.id)).size !== index.records.length) throw new Error('运行历史索引无效，未覆盖现有记录。');
    const records = new Array(index.records.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, index.records.length) }, async () => {
      while (next < index.records.length) {
        const position = next++, item = index.records[position], value = await json(path.join(root, item.fileName));
        if (value.version !== 2 || !Array.isArray(value.records) || value.records.length !== 1 || value.records[0].run?.id !== item.id || digest(JSON.stringify(value.records[0])) !== item.sha256 || item.fileName !== `${item.id}-${item.sha256}.json`) throw new Error('独立运行记录的身份或哈希不匹配，原文件已保留。');
        records[position] = value.records[0];
      }
    }));
    committed = new Map(index.records.map(item => [item.id, item]));
    return { revision: index.revision, records: validateRecords(records) };
  }
  async function save(records, revision, { changedIds } = {}) {
    const changed = changedIds ? new Set(changedIds) : undefined;
    if (new Set(records.map(item => item.run.id)).size !== records.length) throw new Error('运行编号重复，未保存历史。');
    // Clone only changed runs synchronously so concurrent cost reconciliation cannot tear a record.
    const prepared = records.map(record => {
      const previous = committed.get(record.run.id);
      if (previous && changed && !changed.has(record.run.id)) return { entry: previous };
      const snapshot = structuredClone(record); validateRecords([snapshot]);
      const serialized = JSON.stringify(snapshot), sha256 = digest(serialized), fileName = `${snapshot.run.id}-${sha256}.json`;
      return { entry: { id: snapshot.run.id, fileName, sha256, run: runSummary(snapshot.run) }, contents: `{"version":2,"records":[${serialized}]}\n` };
    });
    await checkedDirectory(fs, root, true);
    for (const { entry, contents } of prepared) {
      if (!contents) continue;
      const filename = path.join(root, entry.fileName);
      let present = committed.get(entry.id)?.sha256 === entry.sha256;
      if (!present) try { await checkedFile(fs, filename); const existing = await fs.readFile(filename, 'utf8'); if (existing !== contents) throw new Error('独立运行历史存在不同内容，未覆盖文件。'); present = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!present) {
        const temporary = `${filename}.${randomUUID()}.tmp`;
        await fs.writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' });
        try { await fs.rename(temporary, filename); } catch (error) { await fs.unlink(temporary).catch(() => undefined); throw error; }
      }
    }
    const entries = prepared.map(item => item.entry);
    await atomicJson(fs, indexFile, { version: 2, revision, records: entries });
    committed = new Map(entries.map(item => [item.id, item]));
  }
  return { load, save };
}
module.exports = { createRunHistoryStore, validateRecords, runSummary };
