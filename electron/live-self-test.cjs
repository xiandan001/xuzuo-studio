// Explicit local integration test: isolated profile, dummy key, loopback HTTP only.
const { app, net, safeStorage } = require('electron');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const backendDirectory = process.env.XUZUO_VERIFY_ASAR ? path.join(process.env.XUZUO_VERIFY_ASAR, 'electron') : __dirname;
const { createCredentialStore } = require(path.join(backendDirectory, 'credential-store.cjs'));
const { createArtifactStore } = require(path.join(backendDirectory, 'artifact-store.cjs'));
const { createModelRuntime } = require(path.join(backendDirectory, 'model-runtime.cjs'));
const { createLiveWorkflowEngine } = require(path.join(backendDirectory, 'live-workflow-engine.cjs'));
const { probeConnection } = require(path.join(backendDirectory, 'connection-probe.cjs'));
const { extractReferenceText } = require(path.join(backendDirectory, 'reference-text.cjs'));

const directory = fsSync.mkdtempSync(path.join(os.tmpdir(), 'xuzuo-live-integration-'));
app.setName('Xuzuo Live Integration Test');
app.setPath('userData', directory);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');

app.whenReady().then(async () => {
  const testSecret = 'local-integration-dummy-credential-9281';
  const received = [];
  const server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (request.headers.authorization !== `Bearer ${testSecret}`) { response.writeHead(401); response.end('{}'); return; }
    received.push({ url: request.url, multipart: (request.headers['content-type'] || '').includes('multipart/form-data') });
    response.setHeader('content-type', 'application/json'); response.setHeader('x-request-id', `local-request-${received.length}`);
    if (request.url === '/v1/models') response.end(JSON.stringify({ data: [{ id: 'local-text' }] }));
    else if (request.url === '/v1/chat/completions') response.end(JSON.stringify({ choices: [{ message: { content: '# 茶园交付\n这是真实HTTP返回的业务正文，用于验证结果贯通与文件导出。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }));
    else if (request.url === '/v1/images/generations' || request.url === '/v1/images/edits') {
      if (request.url.endsWith('/edits') && !body.includes(Buffer.from('image'))) { response.writeHead(400); response.end('{}'); return; }
      response.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }));
    } else { response.writeHead(404); response.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const root = path.resolve(__dirname, '..');
  const runtimeManifest = path.join(root, 'work/ui-build/package.json');
  const loadModule = createRequire(process.env.XUZUO_VERIFY_ASAR ? path.join(process.env.XUZUO_VERIFY_ASAR, 'package.json') : fsSync.existsSync(runtimeManifest) ? runtimeManifest : path.join(root, 'package.json'));
  const credentials = createCredentialStore({ directory, safeStorage });
  const credential = await credentials.save({ name: '独立集成测试', connectionId: 'local-connection', secret: testSecret });
  const artifacts = createArtifactStore({ directory: path.join(directory, 'artifacts'), loadModule });
  const modelRuntime = createModelRuntime({ credentialStore: credentials, artifactStore: artifacts, fetchImpl: (url, options) => net.fetch(url, options) });
  const engine = createLiveWorkflowEngine({ directory, credentials, artifactStore: artifacts, modelRuntime });
  const connection = { id: 'local-connection', name: '本机测试服务', providerId: 'custom', protocol: 'openai-chat', baseUrl, enabled: true, status: 'configured' };
  check((await probeConnection({ connection, credentialId: credential.id }, credentials, (url, options) => net.fetch(url, options))).ok, 'Local credential probe failed');
  const models = [
    { id: 'text-model', name: '测试文本', modelId: 'local-text', connectionId: connection.id, enabled: true, capabilities: ['text'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '2', output: '8' } },
    { id: 'image-model', name: '测试图片', modelId: 'local-image', connectionId: connection.id, enabled: true, capabilities: ['image-generation', 'image-editing'], pricing: { unit: 'image', currency: 'CNY', input: '', output: '0.10' } },
  ];
  const steps = [
    { id: 'text', name: '实际文本', kind: 'text', modelConfigId: 'text-model', credentialId: credential.id, prompt: '请生成{{主题}}的内容', inputSource: 'project', budgetCents: 1000, enabled: true },
    { id: 'image', name: '实际图片', kind: 'image-generation', modelConfigId: 'image-model', credentialId: credential.id, prompt: '按上文生成图片', inputSource: 'previous', budgetCents: 1000, enabled: true, imageBackground: 'transparent' },
    { id: 'edit', name: '实际图片精修', kind: 'image-editing', modelConfigId: 'image-model', credentialId: credential.id, prompt: '保留原图主体，精修边缘', inputSource: 'previous', budgetCents: 1000, enabled: true },
    { id: 'human', name: '人工确认', kind: 'manual-review', prompt: '', inputSource: 'previous', budgetCents: 0, enabled: true },
    { id: 'export', name: '实际Word导出', kind: 'export', prompt: '', inputSource: 'previous', budgetCents: 0, enabled: true },
  ];
  const project = { id: 'project', workspaceId: 'workspace', name: '完整链路测试', kind: 'word', description: '', status: 'draft', costCents: 0, budgetCents: 10000, version: 0, updatedAt: '', accent: 'blue' };
  const workflow = { id: 'flow', workspaceId: 'workspace', name: '真实通信集成测试', description: '', outputKind: 'word', steps, updatedAt: '' };
  const start = await engine.start({ project, workflow, connections: [connection], models, input: '这次验证仅访问本机测试服务，不访问任何外部模型。', variables: { 主题: '茶园' }, attachmentIds: [], acknowledgePaidCalls: true, acknowledgeUnknownCost: true });
  async function wait(status) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const snapshot = await engine.snapshot(); const run = snapshot.runs.find(item => item.id === start.id);
      if (run.status === status) return { run, snapshot };
      if (run.status === 'failed') throw new Error(`Integration step failed: ${run.error}`);
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('Integration timed out');
  }
  const waiting = await wait('waiting-review');
  check(waiting.run.attempts[1].input.includes('真实HTTP返回'), 'Model output was not forwarded');
  check(received.some(item => item.url === '/v1/images/edits' && item.multipart), 'Image edit did not use multipart');
  await engine.control({ id: start.id, action: 'resume' });
  const completed = await wait('complete');
  const office = completed.run.attempts.flatMap(attempt => attempt.artifacts || []).find(artifact => artifact.name.endsWith('.docx'));
  check(office, 'No DOCX generated');
  const bytes = (await artifacts.read(office.id)).buffer;
  const zip = await loadModule('jszip').loadAsync(bytes);
  check((await zip.file('word/document.xml').async('string')).includes('真实HTTP返回的业务正文'), 'DOCX did not contain current response');
  check((await extractReferenceText(await artifacts.read(office.id), loadModule)).includes('真实HTTP返回的业务正文'), 'Office reference text extraction failed');
  const generatedImages = completed.run.attempts.flatMap(attempt => attempt.artifacts || []).filter(artifact => artifact.kind === 'image');
  // Unplaced references must not be silently appended. Verify actual embedding
  // with an explicit image block, matching the editable document contract.
  const illustrated = await artifacts.exportOffice({ kind: 'word', title: '显式配图验收', text: JSON.stringify({ blocks: [{ id: 'paragraph', type: 'paragraph', text: '这是真实HTTP返回的业务正文。', bold: false, italic: false }, { id: 'illustration', type: 'image', text: '生成插图', imageId: generatedImages[0].id, bold: false, italic: false }] }), assets: generatedImages, runId: start.id, projectId: project.id });
  const illustratedWord = illustrated.find(artifact => artifact.name.endsWith('.docx'));
  const illustratedZip = await loadModule('jszip').loadAsync((await artifacts.read(illustratedWord.id)).buffer);
  check(Object.keys(illustratedZip.files).some(name => /^word\/media\/.+\.png$/.test(name)), 'Explicit DOCX image embedding missing');
  const otherFormats = {};
  for (const [kind, extension] of [['ppt', '.pptx'], ['excel', '.xlsx']]) {
    const content = kind === 'ppt' ? '# 网络返回的项目说明\n这是真实HTTP返回的业务正文。' : JSON.stringify({ sheets: [{ name: '验证数据', columns: ['说明', '数值'], rows: [['这是真实HTTP返回的业务正文', 2], ['第二行', 3], ['合计', { formula: 'SUM(B2:B3)' }]] }] });
    const exported = await artifacts.exportOffice({ kind, title: '打包依赖核验', text: content, assets: generatedImages, runId: start.id, projectId: project.id });
    const file = exported.find(artifact => artifact.name.endsWith(extension)); check(file, `Missing ${extension}`);
    const fileBytes = (await artifacts.read(file.id)).buffer; check(fileBytes.subarray(0, 2).toString() === 'PK', `Invalid ${extension}`);
    check((await extractReferenceText(await artifacts.read(file.id), loadModule)).includes('真实HTTP返回'), `Packaged ${extension} extraction failed`);
    otherFormats[kind] = fileBytes.length;
  }
  check(!(await fs.readFile(path.join(directory, 'credentials-v1.json'), 'utf8')).includes(testSecret), 'Plaintext in credential store');
  check(!JSON.stringify(completed.snapshot).includes(testSecret), 'Plaintext in runtime snapshot');
  await engine.shutdown(); await new Promise(resolve => server.close(resolve));
  const report = { passed: true, packagedModules: Boolean(process.env.XUZUO_VERIFY_ASAR), externalProviderCalls: 0, actualLoopbackRequests: received.length, encryption: true, electronNetFetch: true, textToImageToEditToHumanToDocx: true, explicitWordImageEmbedding: true, actualDocxBytes: bytes.length, otherOfficeFormats: otherFormats, knownCostCents: completed.snapshot.ledger.reduce((sum, entry) => sum + entry.costCents, 0), directory, artifact: office.path };
  const reportPath = path.join(root, 'outputs', process.env.XUZUO_VERIFY_ASAR ? 'packaged-live-self-test.json' : 'live-workflow-self-test.json'); await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report)); app.exit(0);
}).catch(error => { console.error(`Local integration failed: ${String(error.message).slice(0, 500)}`); app.exit(1); });
