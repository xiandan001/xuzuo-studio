const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createCpuTasks } = require('../../electron/cpu-tasks.cjs');
const { createCommerceImages } = require('../../electron/commerce-images.cjs');
const { Worker } = require('node:worker_threads');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function pattern(nativeImage, width, height, clear) {
  const bitmap = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
    const sky = y < height * .63, sun = (x - width * .73) ** 2 + (y - height * .25) ** 2 < (height * .09) ** 2;
    const color = clear ? checker ? [32, 48, 64] : [236, 240, 242] : sun ? [245, 219, 137] : sky ? [153 + Math.round(y / height * 30), 116 + Math.round(y / height * 25), 73] : [92, 126, 88];
    bitmap[offset] = color[0]; bitmap[offset + 1] = color[1]; bitmap[offset + 2] = color[2]; bitmap[offset + 3] = 255;
  }
  return nativeImage.createFromBitmap(bitmap, { width, height }).toPNG();
}
async function createImageSettingsFixture({ directory, nativeImage, BrowserWindow, ownerFile, ownerNonce }) {
  const workspaceId = 'image-settings-browser-workspace', projectId = 'image-settings-browser-project';
  const workspaceStorage = createWorkspaceStorage({ directory: path.join(directory, 'registration') });
  const artifactStore = createArtifactStore({ directory: path.join(directory, 'artifacts'), workspaceStorage });
  workspaceStorage.setArtifactMigrator((id, target, options) => artifactStore.migrateProject(id, target, options));
  const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace);
  await workspaceStorage.bindRoot({ workspaceId, name: '独立UI验收', directory: workspace, projects: [] });
  await workspaceStorage.ensureProject({ projectId, workspaceId, name: '本地图片工具' });
  const source = await artifactStore.write({ projectId, runId: 'fixture-wallpaper', name: '壁纸界面样例.png', mimeType: 'image/png', buffer: pattern(nativeImage, 1920, 1080, false) });
  const clearSource = await artifactStore.write({ projectId, name: '4K高清棋盘格.png', mimeType: 'image/png', buffer: pattern(nativeImage, 3840, 2160, true) });
  const original = new Map(); for (const file of [source, clearSource]) original.set(file.id, hash((await artifactStore.read(file.id)).buffer));
  const calls = { previews: 0, commerceReads: 0, commercePreviews: 0, commerceSaves: 0, commerceExports: 0, provider: 0 };
  const clearPreviews = [];
  const workers = [];
  const cpuTasks = createCpuTasks({ workerFile: path.join(__dirname, 'image-settings-cpu-worker.cjs'), createWorker: (file, options) => {
    const worker = new Worker(file, { ...options, workerData: { ...options.workerData, testOwnerFile: ownerFile, testOwnerNonce: ownerNonce } });
    const row = { task: options.workerData.task, threadId: worker.threadId, dependencyBootstrapVerified: false, exited: false }; workers.push(row);
    worker.once('message', message => { row.dependencyBootstrapVerified = message.fixtureDependencyBootstrapVerified === true; }); worker.once('exit', () => { row.exited = true; }); return worker;
  } });
  const commerce = createCommerceImages({ workspaceStorage, artifactStore, nativeImage, cpuTasks, BrowserWindow, onExport: async () => { calls.commerceExports++; } });
  const stamp = new Date().toISOString();
  const project = { id: projectId, workspaceId, kind: 'image', name: '本地图片工具', description: '独立样例资料；本轮只验证界面、本地保存和图层操作。', status: 'review', costCents: 0, budgetCents: null, version: 1, updatedAt: stamp, accent: 'blue' };
  const run = { id: 'fixture-wallpaper', workspaceId, projectId, workflowId: 'fixture-wallpaper', workflowName: '隔离壁纸样例', mode: 'live', status: 'complete', stepIndex: 1, variables: {}, input: '隔离UI壁纸样例', createdAt: stamp, updatedAt: stamp,
    snapshot: { id: 'fixture-wallpaper', workspaceId, name: '隔离壁纸样例', description: 'Explicit fixed UI metadata, not a provider run', outputKind: 'image', updatedAt: stamp, steps: [{ id: 'export', name: '保存壁纸样例', kind: 'export', inputSource: 'project', enabled: true, prompt: '', wallpaperTarget: { width: 1920, height: 1080, fit: 'cover' } }] },
    attempts: [{ id: 'fixture-wallpaper-attempt', stepId: 'export', stepName: '保存壁纸样例', modelLabel: '本地界面样例', status: 'complete', costCents: 0, summary: '', input: '', prompt: '', action: '本地导出', artifacts: [source] }],
  };
  async function preview(id) {
    const file = await artifactStore.read(id); assert.equal(file.projectId, projectId); calls.previews++;
    const originalImage = nativeImage.createFromBuffer(file.buffer), size = originalImage.getSize(); assert(!originalImage.isEmpty());
    const scale = Math.min(1, 768 / Math.max(size.width, size.height));
    const image = originalImage.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale) });
    return { mimeType: 'image/png', dataUrl: image.toDataURL(), width: image.getSize().width, height: image.getSize().height, originalWidth: size.width, originalHeight: size.height, sourceSha256: hash(file.buffer) };
  }
  async function snapshot() {
    const sources = [];
    for (const file of [source, clearSource]) sources.push({ id: file.id, sha256: hash((await artifactStore.read(file.id)).buffer), unchanged: hash((await artifactStore.read(file.id)).buffer) === original.get(file.id) });
    return { calls: { ...calls }, workers: workers.map(row => ({ ...row })), sources, sourceUnchanged: sources.every(file => file.unchanged), clearPreviews: [...clearPreviews], providerCalls: 0, ledger: [] };
  }
  return { project, source, clearSource, run, calls, clearPreviews, artifactStore, commerce, preview, snapshot,
    context: { workspaceId, project, source, clearSource, run, workspaceDirectory: workspace, ledger: [], configuration: { version: 1, models: [], connections: [], credentials: [], workflows: [], categories: [], studioActions: [], useTemplates: [], vaultStatus: { available: false } } },
    async close() { await commerce.prepareClose(); await commerce.shutdown(); await Promise.all([cpuTasks.drain(), artifactStore.drain()]); const end = Date.now() + 2500; while (workers.some(row => !row.exited) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 25)); assert(workers.every(row => row.exited), 'Owned CPU worker remains after teardown'); },
  };
}
module.exports = { createImageSettingsFixture };
