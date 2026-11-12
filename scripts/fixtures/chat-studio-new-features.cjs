const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const sha = value => createHash('sha256').update(value).digest('hex');
async function verifyNewChatFeatures({ service, workspaceId, production, inputFiles, calls, report, evaluate, dom, click, fill, select, chooseScenario, until, step }) {
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
}
module.exports = { verifyNewChatFeatures };
