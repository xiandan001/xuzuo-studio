const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { startChecked, lookupStart } = require('../../electron/live-start.cjs');

async function createFixtureProduction({ directory, workspaceId, png, nativeImage, credential }) {
  const calls = [], project = { id: 'chat-refinement-project', workspaceId, kind: 'image', name: '离线精修验收作品', description: '真实本地成品，外部模型只使用确定性替身', status: 'draft', costCents: 0, budgetCents: null, version: 1, updatedAt: new Date().toISOString(), accent: 'blue' };
  const connection = { id: 'fixture-image-connection', name: '离线图像制作替身', providerId: 'custom', protocol: 'openai-chat', baseUrl: 'https://image-offline.invalid/v1', enabled: true, status: 'configured' };
  const model = { id: 'fixture-image-model', name: '离线精修模型', modelId: 'fixture-image-edit', connectionId: connection.id, enabled: true, capabilities: ['image-editing', 'image-generation'], pricing: { unit: 'image', currency: 'CNY', input: '', output: '0.10' } };
  const key = { ...credential, id: 'fixture-image-key', connectionId: connection.id, name: '离线图片账户' };
  const artifactStore = createArtifactStore({ directory: path.join(directory, 'artifacts'), fitEngineering: async input => nativeImage.createFromBuffer(input.buffer).resize({ width: input.target.width, height: input.target.height }).toPNG() });
  const source = await artifactStore.write({ projectId: project.id, name: '已保存精修原图.png', mimeType: 'image/png', buffer: png });
  const digest = createHash('sha256').update(png).digest('hex');
  const modelRuntime = { supports: (_connection, kind) => ['image-editing', 'image-generation'].includes(kind), async execute(input) {
    assert.equal(input.projectId, project.id); assert.equal(input.kind, 'image-editing');
    const references = await Promise.all(input.attachments.map(file => artifactStore.read(file.id)));
    assert.equal(references.length, 1); assert.equal(references[0].id, source.id); assert.equal(createHash('sha256').update(references[0].buffer).digest('hex'), digest);
    calls.push({ projectId: input.projectId, runId: input.runId, sourceArtifactId: source.id, sourceSha256: digest, input: input.input, prompt: input.prompt });
    const output = await artifactStore.write({ projectId: input.projectId, runId: input.runId, name: '独立精修结果.png', mimeType: 'image/png', buffer: png });
    return { text: '已根据明确选定的原图返回独立精修成品。', artifacts: [output], usage: { images: 1 } };
  } };
  const engine = createLiveWorkflowEngine({ directory: path.join(directory, 'history'), artifactStore, modelRuntime, credentials: { list: async () => [key] } });
  const readArtifact = async input => { assert.equal(input.workspaceId, workspaceId); assert.equal(input.projectId, project.id); const file = await artifactStore.read(input.artifactId); assert.equal(file.projectId, project.id); return file; };
  return { project, source, model, connection, credential: key, calls, engine, artifactStore, readArtifact, start: input => startChecked(engine, request => engine.start(request), input), lookup: input => lookupStart(engine, input) };
}
module.exports = { createFixtureProduction };
