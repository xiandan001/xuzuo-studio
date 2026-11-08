import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { readLocalDrives, createDialogLocations } = require('../../electron/dialog-locations.cjs');
const { macSystemPath, resolveMacSystemPath } = require('../../electron/macos-system-paths.cjs');
const { checkedDirectory, key, inside, atomicJson } = require('../../electron/workspace-paths.cjs');
const { createFileDialogSession } = require('../../electron/file-dialog-session.cjs');
const { createWorkspaceStorage } = require('../../electron/workspace-storage.cjs');
const { createOfficePreview } = require('../../electron/office-preview.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const { createLiveWorkflowEngine } = require('../../electron/live-workflow-engine.cjs');
const { createProjectBackup } = require('../../electron/project-backup.cjs');
const { backupRelative } = require('../../electron/backup-paths.cjs');
const { remap } = require('../../electron/backup-format.cjs');
const { registerOfficePreviewHandlers } = require('../../electron/office-preview-handlers.cjs');
const { createAppMaintenance } = require('../../electron/app-maintenance.cjs');
const { createAppUpdater } = require('../../electron/app-updater.cjs');
const cleanup = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });
async function fixture() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-macos-')); cleanup.push(directory); return directory; }
const entry = (name, kind = 'directory') => ({ name, isDirectory: () => kind === 'directory', isSymbolicLink: () => kind === 'link' });

it('discovers mounted macOS volumes without a Windows executable or arbitrary symlinks', async () => {
  const execute = vi.fn(), fileSystem = {
    readdir: vi.fn(async () => [entry('Macintosh HD', 'link'), entry('客户素材'), entry('Data'), entry('data'), entry('.hidden'), entry('not-a-volume', 'file'), entry('removed')]),
    lstat: vi.fn(async filename => { if (filename.endsWith('/removed')) throw Object.assign(Error('removed'), { code: 'ENOENT' }); return entry(path.basename(filename)); }),
  };
  const drives = await readLocalDrives({ platform: 'darwin', fileSystem, execute });
  expect(drives.map(item => item.path)).toEqual(['/', '/Volumes/客户素材', '/Volumes/Data', '/Volumes/data']);
  expect(fileSystem.readdir).toHaveBeenCalledWith('/Volumes', { withFileTypes: true }); expect(execute).not.toHaveBeenCalled();
  const locations = createDialogLocations({ getPath: kind => `/Users/test/${kind}` }, { platform: 'darwin', readDrives: async () => drives });
  expect((await locations('/Users/test')).locations.filter(item => item.kind === 'drive')).toEqual(drives);
});
it('retains known macOS locations with a visible warning when volume discovery fails', async () => {
  const locations = createDialogLocations({ getPath: kind => `/Users/test/${kind}` }, { platform: 'darwin', readDrives: () => Promise.reject(Error('permission')) });
  const result = await locations('/Users/test');
  expect(result.warning).toContain('刷新重试'); expect(result.locations).toContainEqual({ name: '文件系统', path: '/', kind: 'drive' });
});
it('cancels before reading macOS mounts', async () => {
  const controller = new AbortController(); controller.abort(); const fileSystem = { readdir: vi.fn() };
  await expect(readLocalDrives({ platform: 'darwin', signal: controller.signal, fileSystem })).rejects.toMatchObject({ name: 'AbortError' });
  expect(fileSystem.readdir).not.toHaveBeenCalled();
});
it('recognizes only the fixed macOS root aliases and verifies their expected destinations', async () => {
  expect(macSystemPath('/tmp/客户文件', 'darwin')).toBe('/private/tmp/客户文件');
  expect(macSystemPath('/var/folders/example', 'darwin')).toBe('/private/var/folders/example');
  expect(macSystemPath('/tmp-other/file', 'darwin')).toBe('/tmp-other/file');
  expect(macSystemPath('/tmp/file', 'linux')).toBe('/tmp/file');
  const fileSystem = { lstat: async value => ({ isSymbolicLink: () => value === '/tmp', isDirectory: () => value === '/private/tmp' }), realpath: async () => '/private/tmp' };
  await expect(resolveMacSystemPath(fileSystem, '/tmp/example', 'darwin')).resolves.toBe('/private/tmp/example');
  await expect(resolveMacSystemPath({ ...fileSystem, realpath: async () => '/other' }, '/tmp/example', 'darwin')).rejects.toThrow('系统路径别名已变化');
});
it.skipIf(process.platform !== 'darwin')('uses the real /var and /tmp aliases for workspace persistence, reconnect and file dialogs', async () => {
  const directory = await fixture(), canonical = await fs.realpath(directory), workspaceRoot = path.join(directory, '工作区');
  await fs.mkdir(workspaceRoot);
  expect(await checkedDirectory(fs, directory)).toBe(path.resolve(directory)); expect(key(directory)).toBe(key(canonical)); expect(inside('/', canonical)).toBe(true);
  const storage = createWorkspaceStorage({ directory: path.join(directory, 'profile') }); storage.setArtifactMigrator(async () => undefined);
  await storage.bindRoot({ workspaceId: 'mac-workspace', name: 'Mac 工作区', directory: workspaceRoot });
  await expect(storage.reconnectRoot({ workspaceId: 'mac-workspace', directory: await fs.realpath(workspaceRoot) })).resolves.toMatchObject({ repaired: false });
  const session = createFileDialogSession({ options: { properties: ['openDirectory', 'createDirectory'], defaultPath: workspaceRoot, allowedRoot: workspaceRoot, selectEmpty: true } });
  expect((await session.seed()).path).toBe(await fs.realpath(workspaceRoot));
  const project = await session.createFolder({ path: workspaceRoot, name: '中文项目' });
  expect((await session.accept({ directory: project.path })).paths).toEqual([project.path]);
  const json = path.join(directory, 'data.json'); await atomicJson(fs, json, { saved: true }); expect(JSON.parse(await fs.readFile(json, 'utf8'))).toEqual({ saved: true });
  await fs.symlink(project.path, path.join(workspaceRoot, '用户链接'));
  await expect(session.accept({ directory: path.join(workspaceRoot, '用户链接') })).rejects.toThrow('链接');
  await expect(checkedDirectory(fs, path.join(workspaceRoot, '用户链接'))).rejects.toThrow('链接');
});
it('accepts an executable LibreOffice.app and persists its actual renderer, while rejecting Windows executables on macOS', async () => {
  const directory = await fixture(), app = path.join(directory, 'LibreOffice.app'), executable = path.join(app, 'Contents/MacOS/soffice');
  await fs.mkdir(path.dirname(executable), { recursive: true }); await fs.writeFile(executable, 'renderer fixture', { mode: 0o755 });
  const probeRenderer = vi.fn(async () => ({ stdout: 'LibreOffice 25.8.0.1' }));
  const options = { directory: path.join(directory, 'preview'), artifactStore: {}, platform: 'darwin', probeRenderer, rendererCandidates: [executable] };
  const preview = createOfficePreview(options);
  expect((await preview.status()).available).toBe(true);
  expect((await preview.configure(app)).renderer.path).toBe(executable);
  expect(JSON.parse(await fs.readFile(path.join(options.directory, 'renderer-v1.json'), 'utf8')).path).toBe(executable);
  expect((await createOfficePreview(options).status()).available).toBe(true);
  await expect(preview.configure(path.join(directory, 'soffice.exe'))).rejects.toThrow('LibreOffice.app');
  await fs.chmod(executable, 0o644); await expect(preview.configure(app)).rejects.toThrow('执行权限');
});
it('selects a LibreOffice application bundle in the macOS file dialog', async () => {
  const directory = await fixture(), handlers = new Map(), showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: [] }));
  registerOfficePreviewHandlers({ handle: (name, fn) => handlers.set(name, fn), dialog: { showOpenDialog }, getWindow: () => 'window', artifactStore: {}, directory, platform: 'darwin' });
  await handlers.get('office-preview-choose')();
  expect(showOpenDialog).toHaveBeenCalledWith('window', { title: '选择 LibreOffice.app', properties: ['openDirectory', 'treatPackageAsDirectory'] });
});
it('explains DMG update and Finder uninstall without downloading or executing Windows maintenance tools', async () => {
  const spawnImpl = vi.fn(), fetchImpl = vi.fn(), app = { isPackaged: true, getPath: () => '/not-used', getVersion: () => '2.5.0' };
  const maintenance = createAppMaintenance({ app, appId: 'local.xuzuo.studio', platform: 'darwin', spawnImpl });
  expect(await maintenance.status()).toMatchObject({ available: false, reason: expect.stringContaining('Finder') });
  await expect(maintenance.openUninstall()).rejects.toThrow('废纸篓');
  const updater = createAppUpdater({ app, maintenance, platform: 'darwin', spawnImpl, fetchImpl });
  expect(await updater.start()).toMatchObject({ available: false, enabled: false, message: expect.stringContaining('DMG') });
  expect(await updater.prepareInstall()).toBe(false); expect(fetchImpl).not.toHaveBeenCalled(); expect(spawnImpl).not.toHaveBeenCalled();
});

it('keeps source-machine backup boundaries and converts path separators only for relocated paths', () => {
  expect(backupRelative('C:\\客户', 'c:\\客户\\中文项目')).toBe('中文项目');
  expect(backupRelative('/var/workspace', '/private/var/workspace/项目')).toBe('项目');
  for (const child of ['C:\\outside\\project', 'D:\\客户\\project', '\\\\?\\C:\\客户\\project', 'C:\\客户\\project:stream', '/Users/outside']) {
    expect(() => backupRelative('C:\\客户', child)).toThrow();
  }
  expect(remap({ path: 'C:\\客户\\项目\\files\\作品.png' }, {}, { 'C:\\客户\\项目': '/Users/test/项目' }).path).toBe('/Users/test/项目/files/作品.png');
  expect(remap({ path: '/Users/test/项目/files/作品.png' }, {}, { '/Users/test/项目': 'D:\\工作区\\项目' }).path).toBe('D:\\工作区\\项目\\files\\作品.png');
});
it.skipIf(process.platform !== 'darwin')('round-trips a mixed /var workspace and canonical project, then imports its Windows-shaped backup on macOS', async () => {
  const directory = await fixture(), workspace = path.join(directory, '客户工作区'); await fs.mkdir(workspace);
  async function profile(name) {
    const control = path.join(directory, name), storage = createWorkspaceStorage({ directory: control });
    const artifacts = createArtifactStore({ directory: path.join(control, 'artifacts-v1'), workspaceStorage: storage, loadModule: require });
    storage.setArtifactMigrator((id, target) => artifacts.migrateProject(id, target));
    const engine = createLiveWorkflowEngine({ directory: control, artifactStore: artifacts, credentials: {}, modelRuntime: {} });
    return { storage, artifacts, engine, backup: createProjectBackup({ directory: control, workspaceStorage: storage, artifactStore: artifacts, liveEngine: engine, loadModule: require }) };
  }
  const source = await profile('source-profile'), destination = await profile('destination-profile');
  try {
    await source.storage.bindRoot({ workspaceId: 'workspace-one', name: '客户工作区', directory: workspace });
    const projectDirectory = path.join(await fs.realpath(workspace), '中文项目'); await fs.mkdir(projectDirectory);
    await source.storage.claimProjectFolder({ projectId: 'project-one', workspaceId: 'workspace-one', name: '中文项目', directory: projectDirectory });
    const artifact = await source.artifacts.write({ projectId: 'project-one', name: '作品.txt', mimeType: 'text/plain', text: '必须原样保留的客户成品' });
    const meta = { workspaces: [{ id: 'workspace-one', name: '客户工作区' }], projects: [{ id: 'project-one', workspaceId: 'workspace-one', name: '中文项目', kind: 'word', costCents: 0 }], ledger: [], customPrompts: [], preferencesByWorkspace: {}, configuration: {} };
    const archive = path.join(directory, 'mac-backup.zip'); await source.backup.exportBackup({ meta, workspaceIds: ['workspace-one'], filePath: archive });
    const Zip = require('jszip'), zip = await Zip.loadAsync(await fs.readFile(archive));
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    expect(manifest.files.every(item => !item.path.includes('..'))).toBe(true);
    expect((await source.backup.inspectBackup(archive)).projects).toHaveLength(1);
    const windowsManifest = remap(manifest, {}, { [workspace]: 'C:\\客户工作区', [projectDirectory]: 'C:\\客户工作区\\中文项目' });
    zip.file('manifest.json', JSON.stringify(windowsManifest));
    const windowsArchive = path.join(directory, 'windows-backup.zip'); await fs.writeFile(windowsArchive, await zip.generateAsync({ type: 'nodebuffer' }));
    const target = path.join(directory, '恢复位置'); await fs.mkdir(target);
    const restored = await destination.backup.importBackup({ filePath: windowsArchive, directory: target });
    const saved = await destination.artifacts.read(restored.idMap[artifact.id]);
    expect(saved.buffer.toString('utf8')).toBe('必须原样保留的客户成品');
    expect(saved.path).not.toContain('\\'); expect(inside(target, saved.path)).toBe(true);
  } finally { await source.engine.flush(); await destination.engine.flush(); }
});
