const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const sha = value => createHash('sha256').update(value).digest('hex');
async function verifyNewChatFeatures({ service, workspaceId, production, inputFiles, calls, report, evaluate, dom, click, fill, select, chooseScenario, until, step, reload, viewport }) {
  const original = (await service.list(workspaceId))[0], originalLedger = await service.ledger(workspaceId), fixed = entries => entries.map(({ projectName: _name, ...entry }) => entry);
  const originalId = original.id, feeRecords = fixed(originalLedger), checks = report.productivityChecks = {};
  async function sameFees() { assert.equal(calls.length, 9); assert.deepEqual(fixed(await service.ledger(workspaceId)), feeRecords); }
  async function history(scope) { if (!await evaluate(`!!document.querySelector('[aria-label="聊天记录管理"]')`)) await click('[aria-label="聊天历史"]'); await dom(`document.querySelector('[aria-label="聊天记录管理"]')`, 'real history sidebar'); if (scope) await click('.chat-history-scopes button', scope); }
  async function clearAttachments() { while (await evaluate(`!!document.querySelector('.workspace-chat-composer .chat-attachment-remove')`)) await click('.workspace-chat-composer .chat-attachment-remove'); }
  await step('history-rename-pin-archive-trash-restore-and-search-without-fee-duplication', async () => {
    await history(); await select(`整理聊天 ${original.title}`, '重命名');
    await evaluate(`(()=>{const e=document.querySelector('[aria-label="聊天新名称"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'可追踪的客户讨论');e.dispatchEvent(new Event('input',{bubbles:true}))})()`); await click('.chat-history-row form button', '保存');
    await until(async () => (await service.read({ workspaceId, conversationId: originalId })).title === '可追踪的客户讨论', 'rename persisted through real service');
    await select('整理聊天 可追踪的客户讨论', '置顶'); await until(async () => (await service.read({ workspaceId, conversationId: originalId })).pinned === true, 'pin persisted');
    await select('整理聊天 可追踪的客户讨论', '归档聊天'); await dom(`!document.querySelector('[aria-label="聊天记录管理"]')`, 'archiving active chat starts fresh without model'); await history('归档'); await select('整理聊天 可追踪的客户讨论', '回到当前列表');
    await click('.chat-history-scopes button', '当前'); await select('整理聊天 可追踪的客户讨论', '移入回收站'); await until(async () => !!(await service.read({ workspaceId, conversationId: originalId })).trashedAt, 'trash persisted');
    await history('回收站'); await select('整理聊天 可追踪的客户讨论', '恢复聊天'); await click('.chat-history-scopes button', '当前');
    await evaluate(`(()=>{const e=document.querySelector('[aria-label="搜索聊天标题和内容"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'橘猫');e.dispatchEvent(new Event('input',{bubbles:true}))})()`); await dom(`document.querySelector('.chat-history-open')?.textContent.includes('可追踪的客户讨论')`, 'full text search returns renamed original conversation');
    await click('.chat-history-open', '可追踪的客户讨论'); await dom(`document.querySelectorAll('.workspace-chat-turn').length===9`, 'restored original messages'); await sameFees(); checks.historyManagement = true;
  });
  await step('paste-drop-asset-and-project-import-read-real-local-bytes', async () => {
    const png = require('node:fs').readFileSync(inputFiles.png), base64 = png.toString('base64');
    for (const mode of ['paste', 'drop']) {
      await evaluate(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(base64)}),c=>c.charCodeAt(0)),dt=new DataTransfer();dt.items.add(new File([bytes],${JSON.stringify('验收-' + mode + '.png')},{type:'image/png'}));${mode === 'paste' ? "document.querySelector('[aria-label=\"聊天内容\"]').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}))" : "document.querySelector('.workspace-chat-composer').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}))"}})()`);
      await dom(`document.querySelector('[aria-label="本轮附件"]')?.textContent.includes(${JSON.stringify('验收-' + mode + '.png')})`, mode + ' real bytes imported');
      const metadata = await evaluate(`JSON.parse(localStorage.getItem('xuzuo-chat-attachments-v1:${workspaceId}:${originalId}'))`), imported = metadata.find(file => file.name === `验收-${mode}.png`), preview = await service.previewAttachment({ workspaceId, conversationId: originalId, attachmentId: imported.id }); assert.equal(sha(Buffer.from(preview.dataUrl.split(',')[1], 'base64')), inputFiles.pngSha256); await clearAttachments();
    }
    await click('button', '载入验收作品'); await click('[aria-label="添加聊天附件"]'); await click('[aria-label="附件来源"] button', '素材库'); await click('.chat-resource-grid button', '验收本地纹理'); await dom(`document.querySelector('[aria-label="本轮附件"]')?.textContent.includes('验收本地纹理')`, 'own material imported'); await clearAttachments();
    await click('[aria-label="添加聊天附件"]'); await click('[aria-label="附件来源"] button', '项目成品／资料'); await click('.chat-resource-files button', '已保存精修原图'); await dom(`document.querySelector('[aria-label="本轮附件"]')?.textContent.includes('已保存精修原图')`, 'actual saved project image imported');
    const selected = await evaluate(`JSON.parse(localStorage.getItem('xuzuo-chat-attachments-v1:${workspaceId}:${originalId}'))`); assert.equal(selected.length, 1); assert.equal(selected[0].sha256, inputFiles.pngSha256); await sameFees(); checks.localResourceImports = true;
  });
  await step('specialized-tool-reuses-project-and-image-without-chat-call', async () => {
    const before = await evaluate(`document.querySelector('.chat-fixture').dataset.folderRequests`); await chooseScenario('工程P图'); await select('工具保存项目', '继续：离线精修验收作品'); await fill('仅调整地面颜色，保留原图结构。'); await click('[aria-label="进入工程P图"]');
    await dom(`document.querySelector('.chat-fixture').dataset.toolPreset==='工程P图'&&document.querySelector('.chat-fixture').dataset.toolReferences==='1'`, 'tool receives actual reference without planning round'); assert.equal(await evaluate(`document.querySelector('.chat-fixture').dataset.folderRequests`), before); await sameFees(); checks.directToolWithoutChat = true;
  });
  await step('real-refinement-engine-binds-selected-artifact-and-does-not-copy-chat-ledger', async () => {
    await click('button', '精修验收图'); await dom(`document.querySelector('.chat-target-heading')?.textContent.includes('已保存精修原图')&&document.querySelector('[aria-label="精修图片模型"]')`, 'saved target and image model bound in actual React');
    await fill('把背景调整为浅灰，其他细节保持不变。'); await click('[aria-label="开始精修选定成品"]');
    await until(async () => {
      const value = await production.engine.snapshot(), alerts = await evaluate(`Array.from(document.querySelectorAll('[role="alert"]')).map(item=>item.textContent.trim()).filter(Boolean).slice(0,8)`);
      report.refinementDiagnostic = { calls: production.calls.length, alerts, runs: value.runs.map(run => ({ id: run.id, status: run.status, stepIndex: run.stepIndex, error: run.error, attempts: run.attempts.map(attempt => ({ stepId: attempt.stepId, status: attempt.status, error: attempt.error, summary: attempt.summary?.slice(0, 500) })) })), ledger: value.ledger.map(entry => ({ id: entry.id, status: entry.status, costState: entry.costState, costCents: entry.costCents })) };
      if (alerts.length) throw Error('Refinement UI rejected the operation: ' + JSON.stringify(report.refinementDiagnostic));
      if (value.runs.some(run => ['failed','cancelled','interrupted','paused'].includes(run.status))) throw Error('Refinement engine did not complete: ' + JSON.stringify(report.refinementDiagnostic));
      return value.runs.some(run => run.status === 'waiting-review');
    }, 'actual persistent workflow generated PNG through deterministic model substitute');
    const snapshot = await production.engine.snapshot(), run = snapshot.runs[0]; assert.equal(production.calls.length, 1); assert.equal(run.snapshot.sourceArtifactTarget.id, production.source.id); assert.equal(run.snapshot.sourceArtifactTarget.sha256, inputFiles.pngSha256); assert.equal(production.calls[0].sourceSha256, inputFiles.pngSha256); assert.equal(snapshot.ledger.length, 1); assert.equal(snapshot.ledger[0].costCents, 10);
    let linked; await until(async () => { for (const item of await service.list(workspaceId)) { const record = await service.read({ workspaceId, conversationId: item.id }); if (record.productions?.some(link => link.runId === run.id)) { linked = record; return true; } } return false; }, 'confirmed production association persisted without resending');
    assert.equal(linked.turns.length, 0); assert.equal(linked.productions[0].target.artifactId, production.source.id); assert.equal((await service.ledger(workspaceId)).length, originalLedger.length); await sameFees();
    const outputs = run.attempts.flatMap(attempt => attempt.artifacts || []).filter(file => file.kind === 'image'); assert(outputs.some(file => file.id !== production.source.id)); assert.equal(sha((await production.artifactStore.read(production.source.id)).buffer), inputFiles.pngSha256);
    await service.linkProduction({ workspaceId, conversationId: linked.id, runId: run.id, target: linked.productions[0].target, instruction: linked.productions[0].instruction }); assert.equal((await service.read({ workspaceId, conversationId: linked.id })).productions.length, 1); assert.equal(production.calls.length, 1);
    await click('.creation-production .home-result-discuss', '继续修改这份'); await dom(`document.querySelector('.chat-target-heading')&&document.querySelector('.chat-fixture').dataset.discussedArtifact`, 'result-card continuation binds exact exported file'); const selectedId = await evaluate(`document.querySelector('.chat-fixture').dataset.discussedArtifact`); assert(outputs.some(file => file.id === selectedId)); assert.notEqual(selectedId, production.source.id); assert.equal(production.calls.length, 1); checks.boundRefinement = checks.refinementFeesSeparate = true;
  });
  await step('favorite-and-recent-scenes-survive-reload-without-model-calls', async () => {
    await history('当前'); await click('.chat-history-open', '可追踪的客户讨论'); await dom(`document.querySelectorAll('.workspace-chat-turn').length===9`, 'original reply restored for local productivity checks');
    await click('[aria-label="选择使用场景"]'); await click('[aria-label="收藏自由聊天"]'); await click('[aria-label="收藏看图问答"]'); await click('.chat-scenario-groups button', '收藏');
    await dom(`document.querySelectorAll('.chat-scenario-choice').length===2`, 'favorites filter only shows actual favorites'); await click('[aria-label="使用场景 自由聊天"]');
    await click('[aria-label="快速切换看图问答"]'); await dom(`document.querySelector('[aria-label="选择使用场景"]')?.textContent.includes('看图问答')`, 'favorite shortcut switches without sending');
    const key = `xuzuo-chat-scenes-v1:${workspaceId}`, preferences = await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);
    assert.deepEqual(preferences.favorites, ['chat-default', 'chat-vision']); assert.equal(preferences.recent[0], 'chat-vision');
    await click('[aria-label="选择使用场景"]'); await click('.chat-scenario-groups button', '最近'); await dom(`document.querySelector('[aria-label="使用场景 看图问答"]')`, 'recent list includes the actual last selection'); await click('[aria-label="关闭使用场景"]');
    await reload(); await dom(`document.querySelectorAll('.workspace-chat-turn').length===9&&document.querySelector('[aria-label="选择使用场景"]')?.textContent.includes('看图问答')`, 'scenario restored through actual preload and React reload');
    assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`), preferences);
    report.sceneLayouts = [];
    for (const width of [1080, 1440]) for (const theme of ['light', 'dark']) {
      await viewport(width, theme);
      const layout = await evaluate(`(()=>{const composer=document.querySelector('.workspace-chat-composer'),shortcuts=document.querySelector('[aria-label="常用场景快捷入口"]'),toolbar=document.querySelector('.workspace-chat-composer-toolbar'),a=composer.getBoundingClientRect(),b=shortcuts.getBoundingClientRect(),t=toolbar.getBoundingClientRect();return {width:innerWidth,theme:document.documentElement.dataset.appTheme,documentWidth:document.documentElement.scrollWidth,composerWidth:a.width,shortcutWidth:b.width,passed:document.documentElement.scrollWidth<=innerWidth+2&&b.left>=a.left-2&&b.right<=a.right+2&&t.right<=innerWidth+2}})()`);
      assert.equal(layout.passed, true, JSON.stringify(layout)); report.sceneLayouts.push(layout);
    }
    await sameFees(); assert.equal(production.calls.length, 1); report.sceneChecks = { favorites: true, recent: true, reloadRestores: true, lightDarkLayouts: true, noAdditionalCalls: true };
    await click('button', '载入验收作品');
  });
  await step('chat-reply-saves-real-word-ppt-excel-previews-and-opens-editors', async () => {
    const originalRecord = await service.read({ workspaceId, conversationId: originalId }), sourceTurn = originalRecord.turns.find(turn => turn.status === 'complete' && turn.mode !== 'plan' && turn.text.includes('| 类别 | 内容 |'));
    assert(sourceTurn, 'A previously paid complete Markdown reply with a real table is required');
    const sourceSha256 = sha(sourceTurn.text), originalProductionLedger = (await production.engine.snapshot()).ledger, exportChecks = report.exportChecks = {}, exported = report.chatExports = [];
    const extension = { word: 'docx', ppt: 'pptx', excel: 'xlsx' }, labels = { word: 'Word 文档', ppt: 'PPT 演示', excel: 'Excel 表格' };
    for (const kind of ['word', 'ppt', 'excel']) {
      const project = production.documentProjects.find(project => project.kind === kind), store = kind === 'excel' ? production.spreadsheetStore : production.editorStore, before = await store.load({ projectId: project.id, kind });
      assert.deepEqual(before, production.manualRecords[kind]);
      await click('.workspace-chat-turn:has(.chat-reply-text h1) .workspace-chat-message-actions button', '保存为文件'); await dom(`document.querySelector('.chat-file-dialog')`, 'actual file export dialog');
      if (kind !== 'word') await click('.chat-file-formats button', labels[kind]); await select('回复保存项目', project.name); await click('.chat-file-dialog footer button', '保存文件');
      let link; await until(async () => { const record = await service.read({ workspaceId, conversationId: originalId }); link = record.exports?.find(item => item.kind === kind); return !!link; }, `actual ${kind} export associated through native chat linkExport`);
      let run; await until(async () => { run = await production.engine.runDetail(link.runId); if (['failed', 'cancelled', 'interrupted'].includes(run.status)) throw Error(JSON.stringify(run)); return run.status === 'complete'; }, `real export-only ${kind} workflow completes`);
      assert.equal(run.snapshot.sourceChat.sha256, sourceSha256); assert.equal(run.snapshot.sourceChat.turnId, sourceTurn.id); assert(run.snapshot.steps.every(step => step.kind === 'export'));
      const file = run.attempts.flatMap(attempt => attempt.artifacts || []).find(file => file.kind === 'office' && file.name.endsWith('.' + extension[kind])); assert(file, `actual ${extension[kind]} file is required`);
      const actual = await production.artifactStore.read(file.id), zip = await require('jszip').loadAsync(actual.buffer, { checkCRC32: true });
      assert(actual.path.startsWith(await production.workspaceStorage.projectDirectory(project.id))); assert(actual.buffer.subarray(0, 2).equals(Buffer.from('PK')));
      if (kind === 'word') { const xml = await zip.file('word/document.xml').async('string'); assert(xml.includes('完整说明') && xml.includes('橘猫')); }
      else if (kind === 'ppt') { const pages = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)); assert(pages.length > 1); assert((await Promise.all(pages.map(name => zip.file(name).async('string')))).join('').includes('橘猫')); }
      else { const workbook = new (require('exceljs').Workbook)(); await workbook.xlsx.load(actual.buffer); assert.equal(workbook.worksheets[0].getCell('A1').value, '类别'); assert.equal(workbook.worksheets[0].getCell('B2').value, '橘猫'); }
      const selector = `.creation-production:has(footer span[title$=".${extension[kind]}"])`;
      await dom(`document.querySelector(${JSON.stringify(selector)})`, `${kind} result card uses actual linked native run`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
      await dom(`document.querySelector(${JSON.stringify(selector + ' .creation-result-preview')})?.textContent.includes('橘猫')`, `${kind} HomeProductionResult reads the exact export input`);
      await click(selector + ' [aria-label="打开编辑器"]'); await dom(`document.querySelector('.chat-fixture').dataset.editorKind===${JSON.stringify(kind)}`, `${kind} result directly enters actual editor`);
      await dom(`document.querySelector('.chat-fixture-editor')&&[document.querySelector('.chat-fixture-editor').textContent,...[...document.querySelectorAll('.chat-fixture-editor input,.chat-fixture-editor textarea')].map(e=>e.value)].join(' ').includes(${JSON.stringify('MANUAL_' + kind.toUpperCase() + '_UNCHANGED')})`, `${kind} real editor retains the saved manual draft`);
      assert.deepEqual(await store.load({ projectId: project.id, kind }), before); await click('[aria-label="验收返回聊天"]'); await dom(`document.querySelectorAll('.workspace-chat-turn').length===9`, 'back to the original conversation without an extra model turn');
      await service.linkExport({ workspaceId, conversationId: originalId, turnId: sourceTurn.id, runId: run.id, kind, sourceSha256 }); assert.equal((await service.read({ workspaceId, conversationId: originalId })).exports.filter(item => item.runId === run.id).length, 1);
      exported.push({ kind, runId: run.id, artifactId: file.id, sha256: sha(actual.buffer), bytes: actual.buffer.length }); exportChecks[kind] = true;
    }
    assert.equal((await service.read({ workspaceId, conversationId: originalId })).turns.find(turn => turn.id === sourceTurn.id).text, sourceTurn.text);
    assert.deepEqual((await production.engine.snapshot()).ledger, originalProductionLedger); await sameFees(); assert.equal(production.calls.length, 1);
    Object.assign(exportChecks, { actualOfficeBytes: true, homeResultPreviews: true, directEditors: true, draftsAndFeesPreserved: true, sourceAssociationsIdempotent: true });
  });
}
module.exports = { verifyNewChatFeatures };
