import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { createFileDialogSession } = createRequire(import.meta.url)('../../electron/file-dialog-session.cjs');

async function fixture(overrides = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-dialog-alias-')));
  const canonical = path.join(root, 'Long directory name'), alias = path.join(root, 'LONGDI~1'), outside = path.join(root, 'outside');
  await fs.mkdir(canonical); await fs.mkdir(outside);
  const mapped = value => {
    const relative = path.relative(alias, value);
    return !relative || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? path.join(canonical, relative) : value;
  };
  const readFile = vi.fn(() => { throw Error('Picker must not read file contents'); });
  const fileSystem = { ...fs, lstat: value => fs.lstat(mapped(value)), realpath: value => fs.realpath(mapped(value)), readdir: (value, ...args) => fs.readdir(mapped(value), ...args), mkdir: (value, ...args) => fs.mkdir(mapped(value), ...args), readFile, ...overrides };
  const session = (options = {}, blockedPaths = []) => createFileDialogSession({ options: { properties: ['openDirectory', 'createDirectory'], defaultPath: alias, allowedRoot: alias, ...options }, locations: [{ name: 'raw', path: alias }, { name: 'canonical', path: canonical }, { name: 'outside', path: outside }], blockedPaths, fileSystem });
  return { root, canonical, alias, outside, fileSystem, readFile, session };
}

describe('file picker physical path aliases', () => {
  it('accepts same-object directory aliases without losing the independent-project boundary', async () => {
    const f = await fixture(), session = f.session({ selectEmpty: true }), seed = await session.seed();
    expect(seed.path).toBe(f.canonical); expect(seed.allowedRoot).toBe(f.canonical);
    expect(seed.locations.map(item => item.path)).toEqual([f.alias, f.canonical]);
    expect((await session.list({ path: f.alias })).parentPath).toBeNull();
    await expect(session.accept({ directory: f.canonical })).rejects.toThrow('工作区根目录');
    const child = await session.createFolder({ path: f.canonical, name: '客户项目' });
    expect(child.path).toBe(path.join(f.canonical, '客户项目'));
    expect((await session.accept({ directory: path.join(f.alias, '客户项目') })).paths).toEqual([child.path]);
    await expect(session.list({ path: f.outside })).rejects.toThrow('范围');
    expect(f.readFile).not.toHaveBeenCalled();
  });
  it('projects a missing exact reconnect directory without authorizing its parent or a sibling', async () => {
    const f = await fixture(), wanted = path.join(f.alias, '原项目');
    const session = f.session({ allowedRoot: undefined, exactPath: wanted, defaultPath: wanted });
    expect((await session.seed()).exactPath).toBe(path.join(f.canonical, '原项目'));
    await expect(session.createFolder({ path: f.canonical, name: '别的项目' })).rejects.toThrow('原登记');
    const child = await session.createFolder({ path: f.canonical, name: '原项目' });
    await expect(session.accept({ directory: f.canonical })).rejects.toThrow('原位置');
    expect((await session.accept({ directory: child.path })).paths).toEqual([child.path]);
  });
  it('hides and rejects existing and initially missing private paths under canonical directories', async () => {
    const f = await fixture(), existing = path.join(f.canonical, 'private.json'), future = path.join(f.canonical, 'future');
    await fs.writeFile(existing, 'private bytes');
    const blocked = [path.join(f.alias, 'private.json'), path.join(f.alias, 'future', 'locked.json')];
    const session = f.session({ properties: ['openFile'] }, blocked); await session.seed();
    expect((await session.list({ path: f.canonical })).entries).toEqual([]);
    await expect(session.accept({ paths: [existing] })).rejects.toThrow('受保护');
    await fs.mkdir(future); await fs.writeFile(path.join(future, 'locked.json'), 'protected later bytes');
    expect((await session.list({ path: future })).entries).toEqual([]);
    await expect(session.accept({ paths: [path.join(future, 'locked.json')] })).rejects.toThrow('受保护');
    const save = f.session({ mode: 'save', properties: ['openFile'] }, blocked);
    await expect(save.accept({ directory: future, filename: 'locked.json' })).rejects.toThrow('受保护');
    expect(f.readFile).not.toHaveBeenCalled();
    expect(await fs.readFile(existing, 'utf8')).toBe('private bytes');
    expect(await fs.readFile(path.join(future, 'locked.json'), 'utf8')).toBe('protected later bytes');
  });
  it('rejects a policy realpath redirect to a different physical directory', async () => {
    const f = await fixture(); f.fileSystem.realpath = value => value === f.alias ? Promise.resolve(f.outside) : fs.realpath(value);
    await expect(f.session().seed()).rejects.toThrow('位置已变化');
    expect(await fs.readdir(f.outside)).toEqual([]);
  });
  it('does not turn a link into an authorized root', async () => {
    const f = await fixture(), native = f.fileSystem.lstat;
    f.fileSystem.lstat = async value => { const stat = await native(value); return value === f.alias ? Object.assign(Object.create(stat), { isSymbolicLink: () => true }) : stat; };
    await expect(f.session().seed()).rejects.toThrow('链接');
    expect(await fs.readdir(f.canonical)).toEqual([]);
  });
  it('rejects an alias whose object changes during canonicalization', async () => {
    const f = await fixture(), native = f.fileSystem.lstat; let aliasStats = 0;
    f.fileSystem.lstat = async value => { const stat = await native(value); return value === f.alias && ++aliasStats > 1 ? Object.assign(Object.create(stat), { ino: stat.ino + 1 }) : stat; };
    await expect(f.session().seed()).rejects.toThrow('位置已变化');
    expect(await fs.readdir(f.canonical)).toEqual([]);
  });
  it('rejects an ordinary ancestor replaced by a link during alias resolution', async () => {
    const f = await fixture(), nativeStat = f.fileSystem.lstat, nativeRealpath = f.fileSystem.realpath; let resolved = false;
    f.fileSystem.realpath = async value => { const canonical = await nativeRealpath(value); if (value === f.alias) resolved = true; return canonical; };
    f.fileSystem.lstat = async value => { const stat = await nativeStat(value); return resolved && value === f.root ? Object.assign(Object.create(stat), { isSymbolicLink: () => true }) : stat; };
    await expect(f.session().seed()).rejects.toThrow('链接');
    expect(await fs.readdir(f.canonical)).toEqual([]);
  });
  it.each(['scope', 'protected'])('rejects a %s policy whose alias mapping changes after opening', async kind => {
    const f = await fixture();
    await fs.writeFile(path.join(f.canonical, 'private.json'), 'original private bytes');
    await fs.writeFile(path.join(f.outside, 'private.json'), 'other private bytes');
    const session = kind === 'scope' ? f.session() : f.session({ allowedRoot: undefined }, [path.join(f.alias, 'private.json')]);
    await session.seed();
    const redirected = value => { const relative = path.relative(f.alias, value); return !relative || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? path.join(f.outside, relative) : value; };
    f.fileSystem.lstat = value => fs.lstat(redirected(value));
    f.fileSystem.realpath = value => fs.realpath(redirected(value));
    await expect(session.list({ path: f.canonical })).rejects.toThrow('位置已变化');
    await expect(session.createFolder({ path: f.canonical, name: 'must-not-create' })).rejects.toThrow('位置已变化');
    expect(await fs.readdir(f.canonical)).toEqual(['private.json']);
    expect(await fs.readdir(f.outside)).toEqual(['private.json']);
    expect(f.readFile).not.toHaveBeenCalled();
  });
});
