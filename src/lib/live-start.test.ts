import { describe, expect, it, vi } from 'vitest';
import type { LiveCheckedStartResult, LiveRuntimeBridge, LiveStartRequest } from '../live-types';
import type { WorkflowRun } from '../configuration-types';
import { createLiveStartCoordinator } from './live-start';

const request = (): LiveStartRequest => ({ project: { id: 'project', workspaceId: 'workspace', name: '隔离精修', kind: 'image', description: '', status: 'review', costCents: 10, version: 1, updatedAt: '', accent: 'blue' }, workflow: { id: 'quick-edit', workspaceId: 'workspace', name: '精修', outputKind: 'image', description: '', updatedAt: '', steps: [{ id: 'edit', name: '精修原图', kind: 'image-editing', prompt: '补齐品牌，移除联系方式', inputSource: 'project', enabled: true, modelConfigId: 'model', credentialId: 'key-id', count: 1 }] }, models: [{ id: 'model', name: '隔离模型', modelId: 'fixture', connectionId: 'connection', capabilities: ['image-editing'], enabled: true, pricing: { unit: 'image', currency: 'CNY', input: '0', output: '1' } }], connections: [{ id: 'connection', name: '隔离连接', providerId: 'custom', protocol: 'image', baseUrl: 'http://127.0.0.1:9000/v1', enabled: true, status: 'configured' }], input: '保留原图主体，只修改品牌文字', variables: {}, attachmentIds: ['source'], acknowledgePaidCalls: true, acknowledgeUnknownCost: true });
function fixture() {
  const values = new Map<string, string>(), payloads: LiveStartRequest[] = [], records = new Map<string, WorkflowRun>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const admit = (input: LiveStartRequest) => { const previous = records.get(input.dispatchKey!); if (previous) return previous; const run: WorkflowRun = { id: `run-${records.size + 1}`, mode: 'live', workspaceId: input.project.workspaceId, projectId: input.project.id, workflowId: input.workflow.id, workflowName: input.workflow.name, dispatchKey: input.dispatchKey, snapshot: input.workflow, status: 'running', stepIndex: 0, attempts: [], variables: input.variables, input: input.input, createdAt: '', updatedAt: '' }; records.set(input.dispatchKey!, run); return run; };
  const startChecked = vi.fn(async (input: LiveStartRequest): Promise<LiveCheckedStartResult> => { payloads.push(structuredClone(input)); expect(values.size).toBe(1); return { status: 'started', run: admit(input) }; });
  const lookupStart = vi.fn(async (input: { dispatchKey: string }): Promise<{ status: 'started'; run: WorkflowRun } | { status: 'not-found' } | { status: 'unknown' }> => { const run = records.get(input.dispatchKey); return run ? { status: 'started', run } : { status: 'unknown' }; });
  const bridge = { startChecked, lookupStart, snapshot: vi.fn(async () => ({ runs: [...records.values()], ledger: [] })) } as unknown as LiveRuntimeBridge;
  const onRun = vi.fn();
  const coordinator = () => createLiveStartCoordinator({ storage: () => storage, bridge: () => bridge, onRun, timeoutMs: 20 });
  return { values, storage, payloads, records, admit, startChecked, lookupStart, bridge, onRun, coordinator };
}

describe('真实启动回执与冻结请求', () => {
  it('已知拒绝保留具体原因，不假称未知，也不做重试或读取', async () => {
    const f = fixture(); f.startChecked.mockResolvedValue({ status: 'rejected', code: 'PROJECT_BUSY', error: '当前项目确实仍在执行。' });
    expect(await f.coordinator().start(request())).toEqual({ status: 'rejected', code: 'PROJECT_BUSY', error: '当前项目确实仍在执行。' });
    expect(f.startChecked).toHaveBeenCalledTimes(1); expect(f.lookupStart).not.toHaveBeenCalled(); expect(f.values.size).toBe(0); expect(f.records.size).toBe(0);
  });

  it('真实受理后ACK丢失可免费关联原key，只有一份运行且不重复发送', async () => {
    const f = fixture(); f.startChecked.mockImplementation(async input => { f.payloads.push(structuredClone(input)); f.admit(input); throw Error('Owned ACK loss'); });
    const result = await f.coordinator().start(request()); expect(result).toMatchObject({ status: 'started', runId: 'run-1', recovered: true });
    expect(f.startChecked).toHaveBeenCalledTimes(1); expect(f.lookupStart).toHaveBeenCalledTimes(1); expect(f.records.size).toBe(1); expect(f.values.size).toBe(0);
  });

  it('受理后的本地状态刷新异常不改变started结果或重发请求', async () => {
    const f = fixture(); f.onRun.mockImplementation(() => { throw Error('Owned post-accept poll/merge failure'); });
    expect(await f.coordinator().start(request())).toMatchObject({ status: 'started', runId: 'run-1' }); expect(f.startChecked).toHaveBeenCalledTimes(1); expect(f.lookupStart).not.toHaveBeenCalled(); expect(f.records.size).toBe(1);
  });

  it('传输未提交时最多重试相同key和冻结参数，参数/原对象后续变化不改旧请求', async () => {
    const f = fixture(); let attempts = 0;
    f.startChecked.mockImplementation(async input => { f.payloads.push(structuredClone(input)); if (++attempts === 1) throw Error('Owned IPC send loss'); return { status: 'started', run: f.admit(input) }; });
    const original = request(), pending = f.coordinator().start(original); original.input = '用户随后改变了输入'; original.workflow.steps[0].prompt = '不属于原启动的新指令';
    expect(await pending).toMatchObject({ status: 'started' }); expect(f.payloads).toHaveLength(2); expect(f.payloads[0]).toEqual(f.payloads[1]); expect(f.payloads[0].input).toBe('保留原图主体，只修改品牌文字'); expect(f.records.size).toBe(1);
  });

  it('双击同一逻辑启动只共用一个在途请求，不同内容不能套用该请求', async () => {
    const f = fixture(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    f.startChecked.mockImplementation(async input => { await gate; return { status: 'started', run: f.admit(input) }; });
    const coordinator = f.coordinator(), first = coordinator.start(request()), second = coordinator.start(request()); expect(second).toBe(first);
    const changed = request(); changed.input = '新的不同请求'; expect(await coordinator.start(changed)).toMatchObject({ status: 'rejected', code: 'START_IN_PROGRESS' });
    release(); expect(await first).toMatchObject({ status: 'started' }); expect(f.startChecked).toHaveBeenCalledTimes(1); expect(f.records.size).toBe(1);
  });

  it('未知记录跨关闭重开保留；改需求不发新key，读取晚到原运行免费且不会生成', async () => {
    const f = fixture(); f.startChecked.mockRejectedValue(Error('Owned disconnected start'));
    const first = await f.coordinator().start(request()); expect(first.status).toBe('unknown'); expect(f.startChecked).toHaveBeenCalledTimes(2);
    const frozen = JSON.parse([...f.values.values()][0]).payload as LiveStartRequest; const coordinator = f.coordinator();
    expect((await coordinator.read('project')).status).toBe('unknown'); expect(f.startChecked).toHaveBeenCalledTimes(2);
    const changed = request(); changed.input = '另外一份全新内容'; expect((await coordinator.start(changed)).status).toBe('unknown'); expect(f.startChecked).toHaveBeenCalledTimes(2);
    f.admit(frozen); expect(await coordinator.read('project')).toMatchObject({ status: 'started', runId: 'run-1', recovered: true }); expect(f.startChecked).toHaveBeenCalledTimes(2); expect(f.values.size).toBe(0);
  });

  it('同内容重开复用原key；项目费用/版本/时间变化不被当作另一份请求', async () => {
    const f = fixture(); f.startChecked.mockRejectedValue(Error('Owned disconnect')); await f.coordinator().start(request());
    const old = JSON.parse([...f.values.values()][0]).payload as LiveStartRequest; const next = request(); next.project.costCents = 777; next.project.version = 8; next.project.updatedAt = 'later'; next.workflow.updatedAt = 'later'; next.connections[0].status = 'format-checked';
    f.startChecked.mockImplementation(async input => { expect(input.dispatchKey).toBe(old.dispatchKey); expect(input.project.costCents).toBe(old.project.costCents); return { status: 'started', run: f.admit(input) }; });
    expect(await f.coordinator().start(next)).toMatchObject({ status: 'started' }); expect(f.records.size).toBe(1);
  });

  it('权威确认未受理后，读取解除旧记录且不生成；用户可直接重试', async () => {
    const f = fixture(); f.startChecked.mockRejectedValue(Error('Owned never-received transport')); expect((await f.coordinator().start(request())).status).toBe('unknown');
    f.lookupStart.mockResolvedValue({ status: 'not-found' });
    expect(await f.coordinator().read('project')).toMatchObject({ status: 'rejected', code: 'START_NOT_FOUND' }); expect(f.values.size).toBe(0); expect(f.startChecked).toHaveBeenCalledTimes(2); expect(f.records.size).toBe(0);
  });

  it('重开后改变需求，仅在权威旧请求未受理时直接开始当前新需求', async () => {
    const f = fixture(); f.startChecked.mockRejectedValue(Error('Owned never-received transport')); await f.coordinator().start(request());
    const old = JSON.parse([...f.values.values()][0]).payload as LiveStartRequest;
    f.lookupStart.mockResolvedValue({ status: 'not-found' }); f.startChecked.mockImplementation(async input => { f.payloads.push(structuredClone(input)); return { status: 'started', run: f.admit(input) }; });
    const current = request(); current.input = '已修改的新需求'; expect(await f.coordinator().start(current)).toMatchObject({ status: 'started' }); expect(f.payloads[0].input).toBe(current.input); expect(f.payloads[0].dispatchKey).not.toBe(old.dispatchKey); expect(f.records.size).toBe(1);
  });

  it('两次传输均未受理且权威确认不存在，明确返回未开始而非永久未知', async () => {
    const f = fixture(); f.startChecked.mockRejectedValue(Error('Owned transport did not deliver')); f.lookupStart.mockResolvedValue({ status: 'not-found' });
    expect(await f.coordinator().start(request())).toMatchObject({ status: 'rejected', code: 'START_NOT_FOUND' }); expect(f.startChecked).toHaveBeenCalledTimes(2); expect(f.values.size).toBe(0); expect(f.records.size).toBe(0);
  });

  it('准备阶段去掉终态旧任务引用后，独立payload校验仍可清除ACK回执并正常重开', async () => {
    const f = fixture(), input = request(); input.replaceWaitingReviewRunId = 'finished-old';
    f.startChecked.mockImplementation(async payload => { expect(payload.replaceWaitingReviewRunId).toBeUndefined(); f.admit(payload); throw Error('Owned accepted ACK loss'); });
    expect(await f.coordinator().start(input, async value => { const next = { ...value }; delete next.replaceWaitingReviewRunId; return next; })).toMatchObject({ status: 'started', recovered: true });
    expect(f.values.size).toBe(0); expect(await f.coordinator().read('project')).toMatchObject({ status: 'rejected', code: 'NO_PENDING_START' }); expect(f.records.size).toBe(1);
  });

  it('保存只含Key编号和允许的模型元数据，不携带自定义Authorization/secret字段', async () => {
    const f = fixture(), input = request(); Object.assign(input.connections[0], { secret: 'SYNTHETIC_PRIVATE_VALUE', headers: { Authorization: 'SYNTHETIC_PRIVATE_VALUE' } }); Object.assign(input.models[0], { apiKey: 'SYNTHETIC_PRIVATE_VALUE' }); Object.assign(input.workflow, { secret: 'SYNTHETIC_PRIVATE_VALUE' });
    f.startChecked.mockImplementation(async value => { const raw = [...f.values.values()][0]; expect(raw).not.toContain('SYNTHETIC_PRIVATE_VALUE'); expect(raw).toContain('key-id'); return { status: 'started', run: f.admit(value) }; });
    expect((await f.coordinator().start(input)).status).toBe('started');
  });

  it('存储故障或损坏记录不允许新请求，作用域变化不发起第二次重试', async () => {
    const f = fixture(); f.storage.setItem = () => { throw Error('Owned quota'); }; expect(await f.coordinator().start(request())).toMatchObject({ status: 'rejected', code: 'START_STORAGE' }); expect(f.startChecked).not.toHaveBeenCalled();
    const corrupt = fixture(); corrupt.values.set('xuzuo-live-start-v1:project', '{bad'); expect((await corrupt.coordinator().start(request())).status).toBe('unknown'); expect(corrupt.startChecked).not.toHaveBeenCalled();
    const changed = fixture(); let current = true; changed.startChecked.mockImplementation(async () => { current = false; throw Error('Owned lost response after scope change'); }); expect((await changed.coordinator().start(request(), undefined, () => current)).status).toBe('unknown'); expect(changed.startChecked).toHaveBeenCalledTimes(1);
  });
});
