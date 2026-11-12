import type { WorkflowRun } from '../configuration-types';
import type { LiveCheckedStartResult, LiveRuntimeBridge, LiveStartRequest, LiveStartResult } from '../live-types';

interface StartStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }
interface Receipt { version: 1; signature: string; payloadSignature?: string; payload: LiveStartRequest; }
interface Options { storage: () => StartStorage; bridge: () => LiveRuntimeBridge | undefined; onRun: (run: WorkflowRun) => void; timeoutMs?: number; }
const keyFor = (projectId: string) => `xuzuo-live-start-v1:${projectId}`;
const pick = <T extends object>(value: T, keys: string[]): T => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key as keyof T]])) as T;
function cleanRequest(input: LiveStartRequest): LiveStartRequest {
  const steps = input.workflow.steps.map(step => ({ ...pick(step, ['id', 'name', 'kind', 'prompt', 'promptTemplateId', 'modelConfigId', 'credentialId', 'inputSource', 'budgetCents', 'enabled', 'maxOutputTokens', 'imageSize', 'imageBackground', 'imageOutputFormat', 'imageQuality', 'imageComplexity', 'imageFrameCount', 'imageFrameDurationMs', 'imageCompression', 'imageMarkupId', 'imageSvgModel', 'imageSvgReasoningEffort', 'voice', 'count', 'contentSourceStepId', 'contentSourceStepIds', 'documentImageSource', 'documentImageStepIds', 'imageSourceStepId', 'role', 'referenceArtifactIds', 'engineeringReferenceId', 'wallpaperTarget', 'reasoningEffort', 'animation', 'beadBaseRequestId']), ...(step.qualityGate ? { qualityGate: pick(step.qualityGate, ['repairStepId', 'maxRepairs', 'minScore']) } : {}) }));
  return structuredClone({ ...pick(input, ['purpose', 'input', 'variables', 'attachmentIds', 'dispatchKey', 'acknowledgePaidCalls', 'acknowledgeUnknownCost', 'replaceWaitingReviewRunId', 'replaceWaitingReviewAttemptId', 'refinementFork']), project: pick(input.project, ['id', 'workspaceId', 'name', 'kind', 'description', 'status', 'costCents', 'budgetCents', 'version', 'updatedAt', 'accent', 'referenceFiles', 'businessCategoryId']), workflow: { ...pick(input.workflow, ['id', 'workspaceId', 'name', 'description', 'outputKind', 'businessCategoryId', 'updatedAt', 'goalBrief', 'foundationVersion', 'sourceArtifactTarget']), steps }, connections: input.connections.map(connection => pick(connection, ['id', 'name', 'providerId', 'protocol', 'baseUrl', 'enabled', 'status', 'demo'])), models: input.models.map(model => ({ ...pick(model, ['id', 'name', 'modelId', 'connectionId', 'capabilities', 'enabled', 'demo']), pricing: pick(model.pricing, ['unit', 'currency', 'input', 'output', 'exchangeRate', 'referenceOnly', 'referenceNote', 'officialUrl', 'verifiedAt']) })) });
}
function signature(input: LiveStartRequest): string {
  const payload = cleanRequest(input);
  return JSON.stringify({ ...payload, dispatchKey: undefined, refinementFork: undefined, replaceWaitingReviewAttemptId: undefined, project: pick(payload.project, ['id', 'workspaceId', 'kind', 'name', 'budgetCents']), workflow: { ...payload.workflow, updatedAt: undefined }, connections: payload.connections.map(connection => ({ ...connection, status: undefined })) });
}
const unknown = (key: string, error = '启动结果尚未确认，请读取已有任务；不会重新生成。'): LiveStartResult => ({ status: 'unknown', dispatchKey: key, error });
const absent = (): LiveStartResult => ({ status: 'rejected', code: 'START_NOT_FOUND', error: '这次尚未开始，可直接重试。' });
type Lookup = { status: 'started'; run: WorkflowRun } | { status: 'not-found' } | { status: 'unknown' };
async function bounded<T>(task: Promise<T>, timeout: number): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([task, new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(Error('启动服务暂未返回。')), timeout); })]); } finally { clearTimeout(timer); } }

export function createLiveStartCoordinator(options: Options) {
  const flights = new Map<string, { signature: string; task: Promise<LiveStartResult> }>();
  function load(projectId: string): Receipt | undefined {
    const raw = options.storage().getItem(keyFor(projectId)); if (!raw) return;
    const value = JSON.parse(raw) as Receipt;
    if (value.version !== 1 || typeof value.signature !== 'string' || value.payload?.project?.id !== projectId || !/^[a-f0-9]{64}$/.test(value.payload.dispatchKey || '') || signature(value.payload) !== (value.payloadSignature ?? value.signature)) throw Error('启动记录暂不能可靠读取，请保留原记录并查看任务。');
    return value;
  }
  function clear(receipt: Receipt) {
    try { const current = load(receipt.payload.project.id); if (current?.payload.dispatchKey === receipt.payload.dispatchKey) options.storage().removeItem(keyFor(receipt.payload.project.id)); } catch { /* An unreadable receipt must not be overwritten. */ }
  }
  function accepted(receipt: Receipt, run: WorkflowRun, recovered = false): LiveStartResult {
    if (run.projectId !== receipt.payload.project.id || run.workspaceId !== receipt.payload.project.workspaceId || run.dispatchKey !== receipt.payload.dispatchKey) return unknown(receipt.payload.dispatchKey!, '启动回执归属不匹配，原记录保留，请查看当前任务。');
    clear(receipt); try { options.onRun(run); } catch { /* An admitted task stays started even if local state refresh fails. */ } return { status: 'started', runId: run.id, ...(recovered ? { recovered: true } : {}) };
  }
  async function lookup(receipt: Receipt): Promise<Lookup> {
    const bridge = options.bridge(); if (!bridge) throw Error('真实执行后台暂不可用。');
    if (bridge.lookupStart) return bounded(bridge.lookupStart({ projectId: receipt.payload.project.id, workspaceId: receipt.payload.project.workspaceId, dispatchKey: receipt.payload.dispatchKey! }), options.timeoutMs || 2500);
    const snapshot = await bounded(bridge.snapshot(), options.timeoutMs || 2500);
    const run = snapshot.runs.find(run => run.projectId === receipt.payload.project.id && run.workspaceId === receipt.payload.project.workspaceId && run.dispatchKey === receipt.payload.dispatchKey);
    return run ? { status: 'started', run } : { status: 'unknown' };
  }
  async function submit(receipt: Receipt, retry = true, current: () => boolean = () => true): Promise<LiveStartResult> {
    const bridge = options.bridge(); if (!bridge) return unknown(receipt.payload.dispatchKey!);
    try {
      const reply = await bounded<LiveCheckedStartResult | WorkflowRun>(bridge.startChecked ? bridge.startChecked(structuredClone(receipt.payload)) : bridge.start(structuredClone(receipt.payload)), options.timeoutMs || 8000);
      if ('id' in reply) return accepted(receipt, reply);
      if (reply.status === 'started') return accepted(receipt, reply.run, reply.recovered);
      if (reply.status === 'rejected') { clear(receipt); return reply; }
    } catch { /* A lost response is reconciled by the original key below. */ }
    try { const found = await lookup(receipt); if (found.status === 'started') return accepted(receipt, found.run, true); if (found.status === 'not-found' && (!retry || !current())) { clear(receipt); return absent(); } } catch { /* A failed free lookup does not authorize a fresh key. */ }
    return retry && current() ? submit(receipt, false, current) : unknown(receipt.payload.dispatchKey!);
  }
  async function perform(input: LiveStartRequest, prepare: (input: LiveStartRequest) => Promise<LiveStartRequest>, current: () => boolean): Promise<LiveStartResult> {
    let previous: Receipt | undefined;
    try { previous = load(input.project.id); } catch (error) { return unknown('', error instanceof Error ? error.message : undefined); }
    if (previous && previous.signature !== signature(input)) {
      try { const found = await lookup(previous); if (found.status === 'started') { accepted(previous, found.run, true); return { status: 'rejected', code: 'PREVIOUS_START_FOUND', error: '已找到上一轮启动的任务，本次修改尚未提交；请先查看该任务。' }; } if (found.status === 'not-found') { clear(previous); previous = undefined; } } catch { /* Keep the previous frozen request until it is known. */ }
      if (previous) return unknown(previous.payload.dispatchKey!, '上一轮启动仍未确认，本次修改没有提交；请读取已有任务。');
    }
    if (previous) {
      try { const found = await lookup(previous); if (found.status === 'started') return accepted(previous, found.run, true); } catch { /* The same frozen request may be retried once, never a new key. */ }
      return current() ? submit(previous, true, current) : { status: 'rejected', code: 'SCOPE_CHANGED', error: '当前项目已变化，未重新提交启动。' };
    }
    let payload: LiveStartRequest;
    try { payload = cleanRequest(await prepare(input)); } catch (error) { return { status: 'rejected', code: 'SOURCE_CHANGED', error: error instanceof Error ? error.message : '精修原图暂不可用，尚未开始。' }; }
    if (!current()) return { status: 'rejected', code: 'SCOPE_CHANGED', error: '当前项目已变化，尚未开始新的调用。' };
    const bytes = crypto.getRandomValues(new Uint8Array(32)); payload.dispatchKey = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    const receipt: Receipt = { version: 1, signature: signature(input), payloadSignature: signature(payload), payload };
    try { options.storage().setItem(keyFor(input.project.id), JSON.stringify(receipt)); } catch { return { status: 'rejected', code: 'START_STORAGE', error: '启动记录未能保存，尚未发送模型请求；请先检查本地存储。' }; }
    return submit(receipt, true, current);
  }
  return {
    start(input: LiveStartRequest, prepare: (input: LiveStartRequest) => Promise<LiveStartRequest> = async value => value, current: () => boolean = () => true): Promise<LiveStartResult> {
      const frozen = cleanRequest(input), identity = signature(frozen), prior = flights.get(frozen.project.id);
      if (prior) return prior.signature === identity ? prior.task : Promise.resolve({ status: 'rejected', code: 'START_IN_PROGRESS', error: '上一轮启动仍在核对，本次修改尚未提交。' });
      const task = perform(frozen, prepare, current).finally(() => { if (flights.get(frozen.project.id)?.task === task) flights.delete(frozen.project.id); }); flights.set(frozen.project.id, { signature: identity, task }); return task;
    },
    async read(projectId: string): Promise<LiveStartResult> {
      let receipt: Receipt | undefined; try { receipt = load(projectId); } catch (error) { return unknown('', error instanceof Error ? error.message : undefined); }
      if (!receipt) return { status: 'rejected', code: 'NO_PENDING_START', error: '没有待确认的启动记录，请查看当前项目任务。' };
      try { const found = await lookup(receipt); if (found.status === 'started') return accepted(receipt, found.run, true); if (found.status === 'not-found') { clear(receipt); return absent(); } return unknown(receipt.payload.dispatchKey!); } catch { return unknown(receipt.payload.dispatchKey!); }
    },
  };
}
