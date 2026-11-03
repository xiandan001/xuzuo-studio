const fs = require('node:fs/promises');
const path = require('node:path');
const { createRevisionStore } = require('./revision-store.cjs');
const { createSerialQueue } = require('./queue-lifecycle.cjs');
const { validateSpreadsheetDocument, calculateSpreadsheet, SUPPORTED_SPREADSHEET_FUNCTIONS } = require('./spreadsheet-engine.cjs');
const { checkedDirectory } = require('./workspace-paths.cjs');
const { buildSpreadsheetWorkbook } = require('./spreadsheet-export.cjs');
const MAX_BYTES = 16 * 1024 * 1024;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function createSpreadsheetStore({ workspaceStorage, artifactStore, loadModule = require, fileSystem = fs }) {
  const queue = createSerialQueue(), serial = queue.run;
  async function location(projectId) {
    if (!validId(projectId)) throw new Error('项目编号无效。');
    const project = await workspaceStorage.projectDirectory(projectId), directory = path.join(project, '.xuzuo');
    await checkedDirectory(fileSystem, directory);
    return { directory, filename: path.join(directory, 'workbook-v1.json') };
  }
  function checkedRecord(value, projectId) {
    if (!value || value.version !== 1 || value.projectId !== projectId || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.savedAt !== 'string' || !Array.isArray(value.sourceArtifactIds) || value.sourceArtifactIds.length > 20 || value.sourceArtifactIds.some(id => !validId(id))) throw new Error('工作簿版本信息无效，原文件已保留。');
    const document = validateSpreadsheetDocument(value.document);
    return { version: 1, projectId, revision: value.revision, savedAt: value.savedAt, document, sourceArtifactIds: [...value.sourceArtifactIds], calculation: calculateSpreadsheet(document) };
  }
  const revisions = createRevisionStore({ fileSystem, location, prefix: 'workbook', validateRecord: checkedRecord, maxBytes: MAX_BYTES });
  async function readState(projectId) {
    const raw = await revisions.raw(projectId);
    if (raw === undefined) return { raw, current: null, history: [] };
    let source; try { source = JSON.parse(raw); } catch { throw new Error('工作簿编辑源无法读取，原文件已保留，请从独立历史版本恢复。'); }
    if (!Array.isArray(source?.history)) throw new Error('工作簿历史记录格式无效，原文件已保留。');
    const current = checkedRecord(source, projectId), history = source.history.map(item => checkedRecord(item, projectId));
    const revisionNumbers = history.map(item => item.revision);
    if (new Set(revisionNumbers).size !== revisionNumbers.length || history.some(item => item.revision >= current.revision)) throw new Error('工作簿历史版本顺序无效，原文件已保留。');
    return { raw, current, history };
  }
  async function records(projectId) {
    let state, error;
    try { state = await readState(projectId); } catch (cause) { error = cause; }
    const items = await revisions.list(projectId, state ? [...state.history, ...(state.current ? [state.current] : [])] : []);
    if (!items.length && error) throw error;
    return items;
  }
  const publicRecord = source => ({ ...source, document: validateSpreadsheetDocument(source.document), sourceArtifactIds: [...source.sourceArtifactIds], calculation: calculateSpreadsheet(source.document) });
  async function prepare(input) {
    const document = validateSpreadsheetDocument(input?.document);
    if (!Number.isSafeInteger(input?.expectedRevision) || input.expectedRevision < 0) throw new Error('工作簿保存版本无效。');
    const previous = await readState(input.projectId);
    if (!previous.current && (await revisions.list(input.projectId)).length) throw new Error('工作簿编辑源缺失，已保留独立历史版本，请从历史恢复后再保存。');
    if ((previous.current?.revision || 0) !== input.expectedRevision) throw new Error('工作簿已在另一处更新，当前编辑仍保留，请读取最新版本后再保存。');
    const sourceArtifactIds = input.sourceArtifactIds ?? previous.current?.sourceArtifactIds ?? [];
    if (!Array.isArray(sourceArtifactIds) || sourceArtifactIds.length > 20 || sourceArtifactIds.some(id => !validId(id))) throw new Error('工作簿内容来源编号无效。');
    const record = { version: 1, projectId: input.projectId, revision: await revisions.nextRevision(input.projectId, input.expectedRevision), savedAt: new Date().toISOString(), document, sourceArtifactIds: [...new Set(sourceArtifactIds)], calculation: calculateSpreadsheet(document) };
    if (Buffer.byteLength(JSON.stringify({ ...record, history: [] })) > MAX_BYTES) throw new Error('当前工作簿修订超过 16 MB，请拆分内容；原工作簿仍保留。');
    return { ...previous, record };
  }
  async function commit(prepared) {
    const record = await revisions.commit(prepared.record.projectId, prepared.record, prepared.raw, { legacy: [...prepared.history, ...(prepared.current ? [prepared.current] : [])] });
    return publicRecord(record);
  }
  async function restore({ projectId, revision }) {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('请选择有效的工作簿历史修订。');
    const items = await records(projectId), source = items.find(item => item.revision === revision);
    if (!source) throw new Error('找不到这个工作簿版本。');
    const raw = await revisions.raw(projectId, true);
    const record = { ...checkedRecord(source, projectId), revision: await revisions.nextRevision(projectId, Math.max(...items.map(item => item.revision))), savedAt: new Date().toISOString() };
    return publicRecord(await revisions.commit(projectId, record, raw, { restore: true, legacy: items.filter(item => item.recoveryState === 'saved') }));
  }
  return {
    drain: queue.drain, flush: queue.flush,
    load({ projectId }) { return serial(projectId, async () => { const { current } = await readState(projectId); if (!current && (await revisions.list(projectId)).length) throw new Error('工作簿编辑源缺失，已保留独立历史版本，请从历史恢复。'); return current ? publicRecord(current) : null; }); },
    save(input) { return serial(input?.projectId, async () => commit(await prepare(input))); },
    history({ projectId }) { return serial(projectId, async () => (await records(projectId)).map(source => { const record = publicRecord(source); return { revision: record.revision, savedAt: record.savedAt, title: record.document.title, sheetCount: record.document.sheets.length, formulaCount: record.calculation.formulaCount, issueCount: record.calculation.issues.length, recoveryState: source.recoveryState }; })); },
    loadVersion({ projectId, revision }) { return serial(projectId, async () => { const source = (await records(projectId)).find(item => item.revision === revision); if (!source) throw new Error('找不到这个工作簿版本。'); return publicRecord(source); }); },
    restore(input) { return serial(input.projectId, () => restore(input)); },
    export(input) { return serial(input?.projectId, async () => {
      const prepared = await prepare(input), record = prepared.record;
      const { buffer: workbook } = await buildSpreadsheetWorkbook(record.document, loadModule);
      const report = { version: 1, kind: 'spreadsheet-calculation', projectId: record.projectId, sourceRevision: record.revision, engineVersion: record.calculation.engineVersion, supportedFunctions: [...SUPPORTED_SPREADSHEET_FUNCTIONS], formulaCount: record.calculation.formulaCount, calculatedCount: record.calculation.calculatedCount, allFormulasValid: record.calculation.allFormulasValid, issues: record.calculation.issues, fullCalcOnLoad: true, notes: ['本地按明确支持的公式子集重新计算，不信任客户端缓存。', '未支持或出错的公式不写入假的零结果；语法错误的原公式保留为文字并带批注。', 'Excel/WPS 打开时请求重算；文件生成不等同内容、公式或商业用途已人工验收。'] };
      const scope = { projectId: record.projectId, runId: `spreadsheet-${record.projectId}-${record.revision}` };
      try {
        const artifacts = [await artifactStore.write({ ...scope, name: `${record.document.title}.xlsx`, mimeType: XLSX, buffer: workbook })];
        artifacts.push(await artifactStore.write({ ...scope, name: `${record.document.title}-表格检查报告.json`, mimeType: 'application/json', text: JSON.stringify(report, null, 2) }));
        return { record: await commit(prepared), artifacts };
      } catch (error) { throw new Error(`工作簿导出未完成，编辑源版本未提前更新；已生成文件仍保留。${error.message || ''}`); }
    }); },
  };
}
module.exports = { createSpreadsheetStore };
