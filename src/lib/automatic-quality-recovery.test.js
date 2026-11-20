import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { fixture, request, PNG, until } = require('./production-test-fixtures.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { createRedPacketCoverExporter } = require('../../electron/red-packet-cover-export.cjs');
const failed = issue => JSON.stringify({ passed: false, score: 60, issues: [issue], summary: issue });
const passed = JSON.stringify({ passed: true, score: 93, issues: [], summary: '可交付' });
const binding = {modelConfigId: 'editor', credentialId: 'metadata-only'};
async function removeFixture(directory) {
  const owned = path.resolve(directory);
  if (path.dirname(owned) !== path.resolve(os.tmpdir()) || !path.basename(owned).startsWith('xuzuo-production-')) throw Error('Unexpected fixture directory');
  await fs.rm(owned, {recursive:true,force:true});
}

async function setup(responses, { max = 1, editBinding = binding, cover = false, budget, unknownEdit = false, composeBitmap = async()=>Buffer.alloc(957*1278*4) } = {}) {
  const f = await fixture(), input = request(), store = f.artifactStore;
  await f.engine.shutdown(); input.workflow.outputKind = input.project.kind = 'image'; input.project.budgetCents = budget;
  if (cover) input.workflow.imagePreset = '微信红包封面';
  input.models[0].capabilities = ['vision']; input.models[0].pricing = { unit: 'million-tokens', currency: 'CNY', input: '1', output: '2' };
  for (const [id, cap] of [['maker','image-generation'],['editor','image-editing']]) input.models.push({ ...input.models[0], id, capabilities: [cap], pricing: { unit: 'image', currency: 'CNY', input: '', output: '0.10' } });
  if (unknownEdit) {
    input.models[0].pricing = { unit:'image', currency:'CNY', input:'', output:'0.01' };
    input.models.at(-1).pricing.output = ''; input.acknowledgeUnknownCost = false;
  }
  input.workflow.steps = [
    { id: 'make', kind: 'image-generation', name: '制作原图', inputSource: 'project', prompt: '制作小熊', modelConfigId: 'maker', credentialId: binding.credentialId, role: 'producer', enabled: true, count: 1 },
    { id: 'check', kind: 'vision', name: '独立质检', inputSource: 'previous', prompt: '检查实际图', modelConfigId: 'model', credentialId: binding.credentialId, role: 'reviewer', enabled: true, qualityGate: { maxRepairs: max, minScore: 80, ...(max ? { repairStepId: 'make' } : {}), ...(editBinding ? {imageRepairBinding: editBinding} : {}) } },
    { id: 'deliver', kind: 'export', name: '导出实际成品', inputSource: 'previous', contentSourceStepId: 'make', enabled: true, prompt: '' },
    { id: 'manual', kind: 'manual-review', name: '人工验收', inputSource: 'previous', enabled: true, prompt: '' },
  ];
  await f.workspaceStorage.ensureProject({projectId: input.project.id, workspaceId: input.project.workspaceId, name: '图片实测'});
  let checks = 0;
  const execute = vi.fn(async task => {
    if (task.kind === 'vision') return {text: responses[Math.min(checks++, responses.length - 1)], artifacts: [], usage: {inputTokens: 200, outputTokens: 30}};
    const image = await store.write({projectId: task.projectId, runId: task.runId, name: task.kind + '.png', mimeType:'image/png', buffer:PNG});
    return {text:'已写入实际图片', artifacts:[image], usage:{images:1}};
  });
  const codec = createRedPacketCoverExporter({readArtifact:store.read, writeDelivery:store.writePreparedCover, composeBitmap,
    nativeImage:{createFromBitmap:()=>({isEmpty:()=>false,toJPEG:()=>require('./red-packet-cover-fixture.cjs')})}});
  const options = {...f.engineOptions, archiveRedPacketCover:codec.archive, modelRuntime:{supports:()=>true, execute}};
  let engine = createLiveWorkflowEngine(options); const {id} = await engine.start(input);
  return {input, execute, store, id, get engine(){ return engine; },
    terminal:()=>until(()=>engine.runDetail(id), r=>r.status!=='running'),
    reopen:async()=>{await engine.shutdown();engine=createLiveWorkflowEngine(options);},
    dispose: async()=>{await engine.shutdown(); await removeFixture(f.directory);},
  };
}

it('视觉通过但本地交付拒绝构图时：自动精修选中的原图、复检并归档新图，保留原图与账本', async()=>{
  const composeBitmap=vi.fn().mockRejectedValueOnce(Object.assign(Error('完整保留这张图会把主体缩得过小。'),{code:'COVER_LAYOUT_REJECTED'})).mockResolvedValue(Buffer.alloc(957*1278*4));
  const f=await setup([passed],{cover:true,composeBitmap});
  try {
    const run=await f.terminal(); expect(run.snapshot.steps[run.stepIndex].kind,run.error).toBe('manual-review');
    expect(f.execute.mock.calls.map(([t])=>t.kind)).toEqual(['image-generation','vision','image-editing','vision']);
    const original=run.attempts[0].artifacts[0], edited=run.attempts.find(a=>a.artifacts?.some(file=>file.id===f.execute.mock.calls[3][0].attachments[0].id))?.artifacts[0];
    expect(f.execute.mock.calls[2][0].attachments.map(a=>a.id)).toContain(original.id);
    expect(edited.id).not.toBe(original.id);
    expect(composeBitmap).toHaveBeenCalledTimes(2);expect(run.attempts.filter(a=>a.stepId==='deliver').at(-1).artifacts[0].mimeType).toBe('image/jpeg');
    expect((await f.store.read(original.id)).buffer).toEqual(PNG);expect((await f.engine.snapshot()).ledger).toHaveLength(4);
  } finally {await f.dispose()}
}, 20000);

it('用户授权后的真实构图问题自动精修当前样稿并复检，按新结果交付，重开不再派单', async()=>{
  const f=await setup([failed('猫脸太小'), passed]);
  try{
    const r=await f.terminal();
    expect(r.status,r.error).toBe('waiting-review'); expect(r.snapshot.steps[r.stepIndex].kind).toBe('manual-review');
    expect(f.execute.mock.calls.map(([task])=>task.kind)).toEqual(['image-generation','vision','image-editing','vision']);
    const old=r.attempts[0].artifacts[0], edit=r.attempts.find(a=>a.stepName==='按质检建议精修');
    expect(f.execute.mock.calls[2][0].attachments.map(a=>a.id)).toContain(old.id);
    expect(f.execute.mock.calls[3][0].attachments.map(a=>a.id)).toContain(edit.artifacts[0].id);
    expect(r.repairCounts.check).toBe(1); expect(r.qualityDispatchAttempts.check).toBe(r.qualityReviews[0].attemptId);
    const ledger=(await f.engine.snapshot()).ledger; expect(ledger).toHaveLength(4);
    expect(ledger.filter(e=>e.operation==='image-editing')[0].costCents).toBe(10);
    const image=await f.store.read(old.id); expect(image.buffer).toEqual(PNG);
    await f.reopen();expect((await f.engine.snapshot()).ledger).toEqual(ledger);expect(f.execute).toHaveBeenCalledTimes(4);
  }finally{await f.dispose()}
}, 20000);

it('旧9:16误判不随打开触发：一次明确授权，先重检原图、再按真问题精修、重新质检后交付', async()=>{
  const f=await setup([failed('小熊应改成9:16全屏'),failed('无需9:16，画面实际绘入了金色“开”按钮，请移除，题字有错别字。'),passed],{cover:true,max:0,editBinding:null});
  try{
    const old=await f.terminal();expect(f.execute).toHaveBeenCalledTimes(2);
    const oldFile=old.attempts[0].artifacts[0];await f.reopen();
    expect((await f.engine.runDetail(f.id)).status).toBe('waiting-review');expect(f.execute).toHaveBeenCalledTimes(2);
    const args={id:f.id,action:'auto-quality',reviewAttemptId:old.qualityReviews[0].attemptId,project:f.input.project,models:f.input.models,connections:f.input.connections,refinement:{...binding,sourceArtifactId:oldFile.id,instruction:''}};
    const submitted=await Promise.allSettled([f.engine.control(args),f.engine.control(args)]);expect(submitted.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    const after=await f.terminal();expect(after.status,after.error).toBe('waiting-review');expect(after.snapshot.steps[after.stepIndex].kind).toBe('manual-review');
    expect(f.execute.mock.calls.map(([t])=>t.kind)).toEqual(['image-generation','vision','vision','image-editing','vision']);
    expect(f.execute.mock.calls[2][0].attachments.map(f=>f.id)).toContain(oldFile.id);
    expect(f.execute.mock.calls[3][0].prompt).toContain('移除'); expect(f.execute.mock.calls[3][0].prompt).toContain('错别字'); expect(f.execute.mock.calls[3][0].prompt).not.toContain('9:16');
    expect(after.qualityReviews.map(r=>r.passed)).toEqual([false,false,true]);expect(after.repairCounts.check).toBe(1);
    expect(after.qualityRecheckAttempts.check).toBe(old.qualityReviews[0].attemptId);
    expect(after.attempts.slice(0,2)).toEqual(old.attempts);
    expect(after.attempts.find(a=>a.stepId==='deliver').artifacts[0].mimeType).toBe('image/jpeg');
  }finally{await f.dispose()}
}, 20000);

it.each([
  {name:'重复无效JSON',outputs:['截断的JSON'],options:{},calls:['image-generation','vision','vision']},
  {name:'重复旧规格',outputs:[failed('必须按1080×1920扩画')],options:{cover:true},calls:['image-generation','vision','vision']},
  {name:'精修后仍失败',outputs:[failed('画面文字错误')],options:{},calls:['image-generation','vision','image-editing','vision']},
  {name:'主动关闭',outputs:[failed('画面文字错误')],options:{max:0},calls:['image-generation','vision']},
  {name:'缺精修绑定',outputs:[failed('画面文字错误')],options:{editBinding:null},calls:['image-generation','vision']},
  {name:'新增编辑费用未知且原提交未授权',outputs:[failed('主体不清晰')],options:{unknownEdit:true},calls:['image-generation','vision']},
  {name:'项目剩余额度不足',outputs:[failed('主体不清晰')],options:{budget:12},calls:['image-generation','vision']},
  {name:'无效账户',outputs:[failed('画面文字错误')],options:{editBinding:{modelConfigId:'editor',credentialId:'deleted'}},calls:['image-generation','vision']},
  {name:'缺授权资料',outputs:[failed('缺少版权授权证明材料')],options:{},calls:['image-generation','vision']},
])('$name · 停止自动处理并保留人工门禁', async({outputs,options,calls})=>{
  const f=await setup(outputs,options);
  try{
    const r=await f.terminal();expect(r.status,r.error).toBe('waiting-review');expect(r.snapshot.steps[r.stepIndex].id).toBe('check');
    expect(f.execute.mock.calls.map(([task])=>task.kind)).toEqual(calls);
    expect(r.attempts.some(a=>a.stepId==='deliver')).toBe(false);
    expect((await f.engine.snapshot()).ledger).toHaveLength(calls.length);
  }finally{await f.dispose()}
});

it('明确授权两轮时，第二次精修绑定上次新图，次数耗尽后不能继续自动派发', async()=>{
  const f=await setup([failed('第一处问题'),failed('第二处问题'),failed('仍需人工确认')],{max:2});
  try {
    const run=await f.terminal(); expect(run.status,run.error).toBe('waiting-review'); expect(run.snapshot.steps[run.stepIndex].id).toBe('check');
    expect(run.repairCounts.check).toBe(2);
    const edits=run.attempts.filter(a=>a.stepName==='按质检建议精修');expect(edits).toHaveLength(2);
    expect(f.execute.mock.calls.filter(([t])=>t.kind==='image-editing')[1][0].attachments.map(a=>a.id)).toContain(edits[0].artifacts[0].id);
    expect(f.execute).toHaveBeenCalledTimes(6); expect(run.qualityReviews).toHaveLength(3);
    const control={id:f.id,action:'auto-quality',reviewAttemptId:run.qualityReviews.at(-1).attemptId,project:f.input.project,models:f.input.models,connections:f.input.connections};
    await expect(f.engine.control(control)).rejects.toThrow('上限');expect(f.execute).toHaveBeenCalledTimes(6);
  } finally { await f.dispose(); }
});

it('文稿自动修订仍沿用原稿、实际问题与已配置的原制作步骤', async()=>{
  let checks=0;
  const f=await fixture(async t=>t.prompt==='检查' ? ++checks===1 ? failed('客户希望加一句结论') : passed : '完整的客户正文');
  const input=request(), [draft,manual]=input.workflow.steps;
  input.workflow.steps=[draft,{...draft,id:'check',kind:'text',name:'文稿质检',role:'reviewer',inputSource:'previous',prompt:'检查',qualityGate:{repairStepId:draft.id,maxRepairs:1,minScore:80}},manual];
  await f.workspaceStorage.ensureProject({projectId:input.project.id,workspaceId:input.project.workspaceId,name:input.project.name});
  try {
    const {id}=await f.engine.start(input);
    const run=await until(()=>f.engine.runDetail(id),r=>r.status!=='running');expect(run.status,run.error).toBe('waiting-review');
    expect(run.snapshot.steps[run.stepIndex].kind).toBe('manual-review');expect(run.repairCounts.check).toBe(1);
    expect(f.calls).toHaveLength(4);expect(f.calls[2].input).toContain('完整的客户正文');expect(f.calls[2].input).toContain('客户希望加一句结论');
    expect(run.qualityReviews.map(r=>r.passed)).toEqual([false,true]);
  } finally {await f.engine.shutdown();await removeFixture(f.directory);}
});

it('需跨越其它付费步骤的手工文稿不会按自动修订的名义再执行它们',async()=>{
  const f=await fixture(async t=>t.prompt==='最终检查' ? failed('题字有错别字') : '完整源稿');
  const input=request(),[producer,manual]=input.workflow.steps;
  input.workflow.steps=[producer,{...producer,id:'supplement',name:'另一次独立付费制作',prompt:'附加任务'}, {...producer,id:'check',role:'reviewer',prompt:'最终检查',inputSource:'previous',qualityGate:{repairStepId:producer.id,maxRepairs:1,minScore:80}},manual];
  await f.workspaceStorage.ensureProject({projectId:input.project.id,workspaceId:input.project.workspaceId,name:input.project.name});
  try{
    const {id}=await f.engine.start(input);const run=await until(()=>f.engine.runDetail(id),r=>r.status!=='running');
    expect(run.status).toBe('waiting-review');expect(run.snapshot.steps[run.stepIndex].id).toBe('check');expect(run.error).toContain('其他步骤');expect(f.calls.map(t=>t.prompt)).toEqual([producer.prompt,'附加任务','最终检查']);
  }finally{await f.engine.shutdown();await removeFixture(f.directory)}
});

it.each([true,false])('交付连续拒绝时自动精修次数有界，重新打开不派单；明确续作只精修一次（成功：%s）', async(success)=>{
  const refusal = Object.assign(Error('主体缩得过小'),{code:'COVER_LAYOUT_REJECTED'});
  let calls = 0;
  const composeBitmap = vi.fn(async()=>{ if (++calls < 3 || !success) throw refusal; return Buffer.alloc(957*1278*4); });
  const f = await setup([passed],{cover:true,max:1,composeBitmap});
  try {
    const stopped = await f.terminal(); expect(stopped.status,stopped.error).toBe('failed');
    expect(stopped.repairCounts.check).toBe(1); expect(stopped.attempts.at(-1).errorCode).toBe(refusal.code);
    const latestId = stopped.attempts.at(-1).sourceArtifactIds[0];
    await f.reopen(); expect((await f.engine.runDetail(f.id)).status).toBe('failed');
    expect(composeBitmap).toHaveBeenCalledTimes(2); expect(f.execute).toHaveBeenCalledTimes(4);
    await f.engine.control({id:f.id,action:'continue',project:f.input.project,models:f.input.models,connections:f.input.connections});
    const result = await f.terminal(); expect(result.status,result.error).toBe(success?'waiting-review':'failed');
    expect(result.snapshot.steps[result.stepIndex].kind).toBe(success?'manual-review':'export'); expect(result.repairCounts.check).toBe(2);
    expect(f.execute.mock.calls.map(([t])=>t.kind)).toEqual(['image-generation','vision','image-editing','vision','image-editing','vision']);
    expect(f.execute.mock.calls[4][0].attachments.map(a=>a.id)).toEqual([latestId]);
    expect(composeBitmap).toHaveBeenCalledTimes(3); expect((await f.engine.snapshot()).ledger).toHaveLength(6);
  } finally { await f.dispose(); }
},20000);
