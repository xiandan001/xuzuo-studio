import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { createAutomationCenter } = require('../../electron/automation-center.cjs');
const roots = [], centers = [], releases = [], base = path.resolve('work'), stamp = '2026-11-03T00:00:00.000Z';
afterEach(async () => { for (const release of releases.splice(0)) release(); await Promise.all(centers.splice(0).map(center => center.shutdown())); for (const root of roots.splice(0)) { if (path.dirname(root) !== base || (await fs.realpath(root)).toLowerCase() !== root.toLowerCase()) throw Error('Unowned automation fixture'); await fs.rm(root, { recursive: true, force: true }); } });
async function until(read, accept) { const end = Date.now() + 2000; while (Date.now() < end) { const value = await read(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 2)); } throw Error('Fixture did not settle'); }
async function setup({ heldStart = false, runAfterAck = false, initialStatus = 'running', cancelError = false, cancelPending = false, admission } = {}) {
  const root = await fs.mkdtemp(path.join(base, 'automation-safety-')); roots.push(root); const runs = [], calls = [], controls = []; let revision = 1, clock = Date.parse(stamp), releaseStart;
  const context = { workspaces: [{ id: 'source', name: 'Source' }, { id: 'target', name: 'Target' }], projects: [1,2].map(n => ({ id: `project-${n}`, workspaceId: 'source', name: `Project${n}`, kind: 'word', description: '', costCents: 17, updatedAt: stamp })), workflows: [{ id: 'flow', workspaceId: 'source', name: 'Original frozen flow', outputKind: 'word', steps: [{ id: 'text', name: 'Write', kind: 'text', prompt: 'Retain original', modelConfigId: 'metadata-model', credentialId: 'metadata-key', inputSource: 'project', enabled: true }] }, { id: 'target-flow', workspaceId: 'target', name: 'Target flow', outputKind: 'word', steps: [] }], models: [], connections: [] };
  const makeRun = request => ({ id: 'run-' + calls.length, projectId: request.project.id, workspaceId: request.project.workspaceId, dispatchKey: request.dispatchKey, workflowId: request.workflow.id, status: initialStatus, attempts: [], stepIndex: 0, createdAt: stamp, updatedAt: stamp });
  const center = createAutomationCenter({ directory: root, clock: () => clock, liveEngine: { snapshot: async after => after >= revision ? null : { revision, runs: structuredClone(runs), ledger: [] } }, assertAdmission: admission || (async () => true), start: async request => { calls.push(structuredClone(request)); let run = runAfterAck ? undefined : makeRun(request); if (run) { runs.push(run); revision++; } if (heldStart) await new Promise(resolve => { releaseStart = resolve; releases.push(resolve); }); if (!run) { run = makeRun(request); runs.push(run); revision++; } return structuredClone(run); }, control: async input => { controls.push(structuredClone(input)); const run = runs.find(run => run.id === input.id); if (cancelError && input.action === 'cancel') throw Error('cancel transport unavailable'); if (input.action === 'cancel') { if (!cancelPending) run.status = 'cancelled'; } else { run.status = 'running'; if (input.project) run.workspaceId = input.project.workspaceId; } revision++; } }); centers.push(center); await center.syncContext(context);
  const add = changes => center.saveRule({ workspaceId: 'source', projectId: 'project-1', workflowId: 'flow', name: 'Rule', enabled: false, trigger: 'manual', input: 'Concrete goal', variables: {}, ...changes });
  const read = () => center.snapshot('source'), raw = async () => JSON.parse(await fs.readFile(path.join(root, 'automation-center-v1.json'), 'utf8'));
  return { center, root, context, runs, calls, controls, add, read, raw, release: () => releaseStart?.(), changed: () => revision++, advance: ms => { clock += ms; revision++; }, settle: async () => { for (let n=0;n<4;n++) await center.tick(); } };
}

describe('自动化取消需要绑定记录并核对终态', () => {
  it('派工编号迟到且取消失败时保留关联与待确认，不假取消、不自动重发', async () => {
    const f = await setup({ heldStart: true, runAfterAck: true, cancelError: true }), rule = await f.add(), job = await f.center.trigger({ ruleId: rule.id }); await until(() => f.calls.length, value => value === 1);
    await f.center.cancelJob(job.id); let current = (await f.read()).jobs[0]; expect(current.status).toBe('decision'); expect(current.cancellationPending).toBe(true); expect(current.runId).toBeUndefined();
    f.release(); await f.settle(); current = (await f.read()).jobs[0]; expect(current.runId).toBe('run-1'); expect(current.status).toBe('decision'); expect(current.cancellationPending).toBe(true); expect(current.error).toContain('cancel transport unavailable'); expect(f.calls).toHaveLength(1); expect(f.controls).toHaveLength(1);
    const card = (await f.read()).decisions.find(card => !card.resolvedAt); expect(card.runId).toBe('run-1'); await f.center.resolve({ id: card.id, action: 'refresh' }); await expect(f.center.resolve({ id: card.id, action: 'continue' })).rejects.toThrow('取消'); expect(f.calls).toHaveLength(1); expect(f.controls).toHaveLength(1);
    f.runs[0].status = 'cancelled'; f.changed(); await f.settle(); current = (await f.read()).jobs[0]; expect(current.status).toBe('cancelled'); expect(current.cancellationPending).toBe(false); expect((await f.read()).decisions.every(card => card.resolvedAt)).toBe(true);
  });
  it('未知runId也先按dispatchKey找到并持久绑定，再发送取消', async () => {
    const f = await setup({ heldStart: true, cancelError: true }), rule = await f.add(), job = await f.center.trigger({ ruleId: rule.id }); await until(() => f.calls.length, value => value === 1);
    await expect(f.center.cancelJob(job.id)).rejects.toThrow('取消未能确认'); expect((await f.raw()).jobs[0].runId).toBe('run-1'); f.release(); await f.settle(); expect((await f.read()).jobs[0].status).toBe('decision'); expect(f.controls).toHaveLength(1);
  });
  it('后台尚在取消时不显示已取消；完成先于取消时保持完成', async () => {
    const pending = await setup({ cancelPending: true }), rule = await pending.add(), job = await pending.center.trigger({ ruleId: rule.id }); await pending.settle(); await pending.center.cancelJob(job.id);
    expect((await pending.read()).jobs[0].status).toBe('decision'); expect(await pending.center.isProjectBusy('project-1')).toBe(true); await expect(pending.center.prepareProjectArchive({ projectId: 'project-1', workspaceId: 'source' })).rejects.toThrow(); pending.runs[0].status = 'cancelled'; pending.changed(); await pending.settle(); expect((await pending.read()).jobs[0].status).toBe('cancelled');
    const complete = await setup({ heldStart: true, runAfterAck: true, initialStatus: 'complete' }), rule2 = await complete.add(), job2 = await complete.center.trigger({ ruleId: rule2.id }); await until(() => complete.calls.length, value => value === 1); await complete.center.cancelJob(job2.id); complete.release(); await complete.settle(); const ended = (await complete.read()).jobs[0]; expect(ended.status).toBe('complete'); expect(ended.error).toContain('已经完成'); expect(complete.controls).toHaveLength(0); expect(complete.calls).toHaveLength(1);
  });
  it('曾绑定的后台记录暂时丢失时不能以找不到冒充取消成功', async () => {
    const f = await setup(), rule = await f.add(), job = await f.center.trigger({ ruleId: rule.id }); await f.settle(); f.runs.splice(0); f.changed(); await f.center.cancelJob(job.id);
    const current = (await f.read()).jobs[0]; expect(current.runId).toBe('run-1'); expect(current.status).toBe('decision'); expect(current.cancellationPending).toBe(true); expect(current.error).toContain('原记录'); expect(f.calls).toHaveLength(1);
  });
});

describe('目录操作与自动化派工使用互斥租约', () => {
  it('释放租约前按已登记owner迁移，晚到旧UI上下文不能回迁或启动旧队列', async () => {
    const f = await setup({ admission: async () => false }), rule = await f.add({ enabled: true }); await f.center.trigger({ ruleId: rule.id }); await f.settle();
    const release = await f.center.reserveProject('project-1'); await release({ workspaceId: 'target' }); await f.center.syncContext(f.context); await f.settle();
    expect(f.calls).toHaveLength(0); expect((await f.read()).jobs).toHaveLength(0); const moved = await f.center.snapshot('target'); expect(moved.jobs[0].status).toBe('cancelled'); expect(moved.rules[0]).toMatchObject({ enabled: false, originWorkspaceId: 'source' });
    expect((await f.raw()).context.projects.find(project => project.id === 'project-1').workspaceId).toBe('target');
  });
  it('持有目录租约时不能claim；准入已在途时目录租约拒绝', async () => {
    let admitted = false; const f = await setup({ admission: async () => admitted }), rule = await f.add(); await f.center.trigger({ ruleId: rule.id }); await f.settle(); expect(f.calls).toHaveLength(0);
    const release = await f.center.reserveProject('project-1'); admitted = true; await f.settle(); expect(f.calls).toHaveLength(0); expect(await f.center.isProjectBusy('project-1')).toBe(true); await release(); await f.settle(); expect(f.calls).toHaveLength(1);
    let releaseAdmission, waiting = false; const held = await setup({ admission: () => { waiting = true; return new Promise(resolve => { releaseAdmission = resolve; releases.push(() => resolve(true)); }); } }), other = await held.add(); await held.center.trigger({ ruleId: other.id }); await until(() => waiting, Boolean);
    await expect(held.center.reserveProject('project-1')).rejects.toThrow('派工'); await held.center.cancelJob((await held.read()).jobs[0].id); releaseAdmission(true); await held.settle(); expect(held.calls).toHaveLength(0); expect((await held.read()).jobs[0].status).toBe('cancelled');
  });
  it('纯待检查项目可回收，卡片和费用保留；旧active上下文不能提前复活', async () => {
    const f = await setup({ initialStatus: 'waiting-review' }), rule = await f.add({ enabled: true }); await f.center.trigger({ ruleId: rule.id }); await f.settle(); expect(await f.center.isProjectBusy('project-1')).toBe(true); await expect(f.center.reserveProject('project-1')).rejects.toThrow();
    await f.center.prepareProjectArchive({ projectId: 'project-1', workspaceId: 'source' }); expect((await f.read()).jobs).toHaveLength(0); let durable = await f.raw(); expect(durable.jobs[0].status).toBe('decision'); expect(durable.decisions[0].resolvedAt).toBeUndefined(); expect(durable.rules[0].enabled).toBe(false); expect(durable.context.projects[0].costCents).toBe(17);
    await f.center.syncContext(f.context); await expect(f.center.setEnabled({ id: rule.id, enabled: true })).rejects.toThrow('回收'); expect((await f.read()).decisions).toHaveLength(0);
    const trashed = structuredClone(f.context); trashed.projects[0].trashedAt = stamp; await f.center.syncContext(trashed);
    f.advance(1000); const restored = structuredClone(f.context); restored.projects[0].updatedAt = '2026-11-03T00:00:01.000Z'; await f.center.syncContext(restored); expect((await f.read()).decisions.filter(card => !card.resolvedAt)).toHaveLength(1); expect((await f.read()).rules[0].enabled).toBe(false); expect(f.calls).toHaveLength(1);
    await f.center.resolve({ id: (await f.read()).decisions[0].id, action: 'approve' }); await f.settle(); expect(f.controls.at(-1).action).toBe('resume'); expect(f.calls).toHaveLength(1);
  });
  it('极速回收后显式恢复不依赖中间trashed同步，迟到回收上下文不会再次隐藏', async () => {
    const f = await setup({ initialStatus:'waiting-review' }), rule=await f.add({enabled:true}); await f.center.trigger({ruleId:rule.id});await f.settle();await f.center.prepareProjectArchive({projectId:'project-1',workspaceId:'source'});
    await f.center.restoreProjectArchive({projectId:'project-1',workspaceId:'source'});expect((await f.read()).jobs).toHaveLength(1);expect((await f.read()).rules[0].enabled).toBe(false);
    const stale=structuredClone(f.context);stale.projects[0].trashedAt=stamp;await f.center.syncContext(stale);expect((await f.read()).decisions.filter(card=>!card.resolvedAt)).toHaveLength(1);expect(f.calls).toHaveLength(1);
    await f.center.prepareProjectArchive({projectId:'project-1',workspaceId:'source'});expect((await f.read()).jobs).toHaveLength(0);await expect(f.center.restoreProjectArchive({projectId:'project-1',workspaceId:'target'})).rejects.toThrow('不属于');expect((await f.raw()).context.projects[0].costCents).toBe(17);
  });
});

describe('项目移动只迁移对应自动化资料并保留冻结流程', () => {
  it('任务、事件、待办、记忆和规则跟随归属；规则默认停用，明确续跑使用冻结流程', async () => {
    const f = await setup(), rule = await f.add(); await f.center.trigger({ ruleId: rule.id }); await f.settle(); f.runs[0].status = 'failed'; f.changed(); await f.settle();
    let card = (await f.read()).decisions.find(card => !card.resolvedAt); await f.center.resolve({ id: card.id, action: 'continue', remember: true, note: '保留原来的结构和已确认事实' }); await f.settle(); f.runs[0].status = 'failed'; f.changed(); await f.settle();
    const second = await f.add({ projectId: 'project-2', name: 'Other project' }); const before = await f.raw(), original = structuredClone(before.jobs[0].workflowSnapshot);
    const moved = structuredClone(f.context); moved.projects[0].workspaceId = 'target'; moved.projects[0].name = 'Moved'; await f.center.syncContext(moved); await f.settle();
    const source = await f.read(), target = await f.center.snapshot('target'); expect(source.rules.map(rule => rule.id)).toEqual([second.id]); expect(target.rules[0]).toMatchObject({ id: rule.id, workspaceId: 'target', originWorkspaceId: 'source', enabled: false }); expect(target.jobs[0].originWorkspaceId).toBe('source'); expect(target.memories[0].workspaceId).toBe('target'); expect(target.events[0].projectId).toBe('project-1'); expect(target.decisions.every(card => card.workspaceId === 'target')).toBe(true);
    const durable = await f.raw(); expect(durable.jobs[0].workflowSnapshot).toEqual(original); expect(durable.jobs[0].ruleSnapshot.workspaceId).toBe('source'); expect(f.calls).toHaveLength(1);
    card = target.decisions.find(card => !card.resolvedAt); await f.center.resolve({ id: card.id, action: 'continue' }); expect(f.controls.at(-1).project.workspaceId).toBe('target'); expect(f.controls.at(-1).workflow.workspaceId).toBe('target'); expect(f.controls.at(-1).workflow.name).toBe('Original frozen flow'); expect(f.calls).toHaveLength(1); expect((await f.raw()).context.projects[0].costCents).toBe(17);
  });
  it('过期失败卡的后台任务已完成时仅读取，不再恢复或启动模型', async () => {
    const f = await setup(), rule = await f.add(); await f.center.trigger({ ruleId: rule.id }); await f.settle(); f.runs[0].status = 'failed'; f.changed(); await f.settle(); const card = (await f.read()).decisions.find(card => !card.resolvedAt);
    f.runs[0].status = 'complete'; f.changed(); await f.center.resolve({ id: card.id, action: 'continue' }); expect((await f.read()).jobs[0].status).toBe('complete'); expect(f.controls).toHaveLength(0); expect(f.calls).toHaveLength(1);
  });
  it('验收续跑和正常完成清旧error，但决策详情与费用仍保留', async () => {
    const f = await setup({ initialStatus: 'waiting-review' }), rule = await f.add(); await f.center.trigger({ ruleId: rule.id });
    const waiting = await until(async () => { await f.center.tick(); return f.read(); }, value => value.jobs[0]?.status === 'decision' && value.jobs[0]?.nativeStatus === 'waiting-review' && Boolean(value.jobs[0]?.error));
    const card = waiting.decisions.find(item => item.kind === 'review' && !item.resolvedAt); expect(card).toBeTruthy();
    await f.center.resolve({ id: card.id, action: 'approve' }); expect((await f.read()).jobs[0].error).toBeUndefined(); f.runs[0].status = 'complete'; f.changed(); const ended = await until(async () => { await f.center.tick(); return f.read(); }, value => value.jobs[0]?.status === 'complete'); expect(ended.jobs[0].error).toBeUndefined(); expect(ended.decisions[0].detail).toBe(card.detail); expect((await f.raw()).context.projects[0].costCents).toBe(17);
  });
  it('scoped上下文保存保留别区，all-project输入按ID去重且同ID新owner覆盖旧owner', async () => {
    const f = await setup(), context = structuredClone(f.context); context.projects[1].workspaceId = 'target'; await f.center.syncContext(context); const other = await f.add({ workspaceId: 'target', projectId: 'project-2', workflowId: 'target-flow', enabled: true, name: 'Other workspace' });
    await f.center.syncContext({ ...context, workspaceId: 'source', projects: [context.projects[0]], workflows: [context.workflows[0]] }); let state = await f.raw(); expect(state.context.projects).toHaveLength(2); expect((await f.center.snapshot('target')).rules.find(rule => rule.id === other.id).enabled).toBe(true);
    const moved = { ...context.projects[0], workspaceId: 'target' }; await f.center.syncContext({ ...context, workspaceId: 'source', projects: [moved, context.projects[1], { ...context.projects[1], name: 'Updated other' }], workflows: context.workflows }); state = await f.raw(); expect(state.context.projects).toHaveLength(2); expect(state.context.projects.find(project => project.id === moved.id).workspaceId).toBe('target'); expect(state.context.projects.find(project => project.id === 'project-2').name).toBe('Updated other'); expect((await f.center.snapshot('target')).rules.find(rule => rule.id === other.id).enabled).toBe(true);
  });
  it('两个工作区上下文并发同步不会用旧副本覆盖另一边刚保存的项目/流程', async () => {
    const f = await setup(), source = structuredClone(f.context); source.projects[1].workspaceId = 'target'; await f.center.syncContext(source);
    const a = { ...source, workspaceId: 'source', projects: [source.projects[0], { ...source.projects[0], id:'project-3', name:'New source project' }], workflows:[source.workflows[0],{...source.workflows[0],id:'new-flow'}] };
    const b = { ...source, workspaceId:'target', projects:[source.projects[1]],workflows:[source.workflows[1]] };
    await Promise.all([f.center.syncContext(a),f.center.syncContext(b)]); const state = await f.raw(); expect(state.context.projects.map(project=>project.id).sort()).toEqual(['project-1','project-2','project-3']);expect(state.context.workflows.some(flow=>flow.id==='new-flow')).toBe(true);
  });
});

describe('自动化参考输入只传真实成品且不静默截断', () => {
  const file = (id, kind = 'text', name = id + '.txt') => ({ id, kind, name, projectId: 'project-1', mimeType: kind === 'office' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : name.endsWith('.json') ? 'application/json' : 'text/plain' });
  const finished = (id, steps, attempts) => ({ id, projectId: 'project-1', workspaceId: 'source', workflowId: 'upstream', status: 'complete', snapshot: { steps }, attempts, createdAt: stamp, updatedAt: stamp, completedAt: stamp });
  it('手动与定时规则合并已登记text/office，超16明确待办而非丢输入', async () => {
    const f = await setup(), context = structuredClone(f.context); context.projects[0].referenceFiles = [file('saved-text'),file('saved-office','office')]; await f.center.syncContext(context);
    const rule = await f.add(); await f.center.trigger({ ruleId: rule.id }); await f.settle(); expect(f.calls[0].attachmentIds).toEqual(['saved-text','saved-office']);
    const tooMany = await setup(), crowded = structuredClone(tooMany.context); crowded.projects[0].referenceFiles = Array.from({ length: 17 }, (_, index) => file('ref-' + index)); await tooMany.center.syncContext(crowded); const schedule = await tooMany.add({ enabled: true, trigger: 'schedule', intervalMinutes: 1 }); tooMany.advance(60000); await tooMany.settle(); expect(tooMany.calls).toHaveLength(0); const snapshot = await tooMany.read(); expect(snapshot.jobs[0].ruleId).toBe(schedule.id); expect(snapshot.decisions[0].detail).toContain('17'); expect(snapshot.decisions[0].detail).toContain('16');
  });
  it('完成事件优先最后成功export成品，不把旧稿/planner/reviewer/check JSON作为事实', async () => {
    const f = await setup(), rule = await f.add({ enabled: true, trigger: 'run-completed', sourceWorkflowId: 'upstream' });
    const steps = [{ id:'plan',kind:'text',role:'planner',enabled:true },{ id:'make',kind:'text',enabled:true },{ id:'review',kind:'text',role:'reviewer',enabled:true },{ id:'export',kind:'export',enabled:true }];
    f.runs.push(finished('source-run',steps,[{ id:'plan-a',stepId:'plan',status:'complete',artifacts:[file('plan-file')] },{ id:'make-old',stepId:'make',status:'complete',artifacts:[file('old-file')] },{ id:'make-new',stepId:'make',status:'complete',artifacts:[file('new-file')] },{ id:'review-a',stepId:'review',status:'complete',artifacts:[file('review-file','text','检查.json')] },{ id:'export-a',stepId:'export',status:'complete',artifacts:[file('customer-office','office','客户报告.docx'),file('check-file','text','导出检查.json')] }])); f.changed(); await f.settle(); expect(f.calls).toHaveLength(1); expect(f.calls[0].attachmentIds).toEqual(['customer-office']); expect((await f.read()).jobs[0].ruleId).toBe(rule.id);
  });
  it('无export时每制作step只取最新成功；PDF不可读和17份来源均停为待办', async () => {
    const f = await setup(); await f.add({ enabled:true,trigger:'run-completed',sourceWorkflowId:'upstream' });
    f.runs.push(finished('source-run',[{id:'plan',kind:'text',role:'planner',enabled:true},{id:'make',kind:'text',enabled:true},{id:'review',kind:'text',role:'reviewer',enabled:true}],[{id:'plan-a',stepId:'plan',status:'complete',artifacts:[file('plan')]},{id:'old',stepId:'make',status:'complete',artifacts:[file('old')]},{id:'new',stepId:'make',status:'complete',artifacts:[file('actual')]},{id:'r',stepId:'review',status:'complete',artifacts:[file('verdict','text','检查.json')]}])); f.changed(); await f.settle(); expect(f.calls[0].attachmentIds).toEqual(['actual']);
    for (const candidates of [[{...file('pdf','other','客户成品.pdf'),mimeType:'application/pdf'}],Array.from({length:17},(_,index)=>file('office-'+index,'office'))]) {
      const blocked = await setup(); await blocked.add({enabled:true,trigger:'run-completed',sourceWorkflowId:'upstream'}); blocked.runs.push(finished('source-run',[{id:'export',kind:'export',enabled:true}],[{id:'a',stepId:'export',status:'complete',artifacts:candidates}])); blocked.changed(); await blocked.settle(); expect(blocked.calls).toHaveLength(0); const snapshot=await blocked.read();expect(snapshot.jobs[0].attachmentIds).toHaveLength(candidates.length);expect(snapshot.decisions[0].title).toBe('参考资料需要处理');
    }
  });
});
