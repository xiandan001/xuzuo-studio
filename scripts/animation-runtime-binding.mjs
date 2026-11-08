import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export async function verifyAnimationRuntimeBinding(root, managedFiles) {
  const directory = path.join(root, 'work/animation-runtime/xuzuo-animation'), cache = JSON.parse(await fsp.readFile(path.join(root, 'work/animation-runtime-build.json'), 'utf8'));
  assert.equal(cache.version, 1); assert.equal(cache.type, 'onedir'); assert.equal(cache.status?.available, true); assert.equal(cache.status?.protocol, 1); assert.equal(cache.status?.offline, true);
  assert.equal(path.resolve(cache.directory).toLowerCase(), directory.toLowerCase()); assert.equal((await fsp.realpath(directory)).toLowerCase(), directory.toLowerCase()); assert(!(await fsp.lstat(directory)).isSymbolicLink());
  assert(Array.isArray(cache.files) && cache.files.length > 5 && cache.files.length < 512);
  const prefix = 'resources/animation-tool/', files = [], seen = new Set();
  for (const file of cache.files) {
    assert(typeof file.path === 'string' && !file.path.includes('\\') && !path.isAbsolute(file.path) && file.path.split('/').every(part => part && part !== '.' && part !== '..'));
    assert(!seen.has(file.path.toLowerCase())); seen.add(file.path.toLowerCase()); assert(Number.isSafeInteger(file.bytes) && file.bytes > 0 && /^[a-f0-9]{64}$/.test(file.sha256));
    const filename = path.resolve(directory, ...file.path.split('/')), relative = path.relative(directory, filename); assert(relative && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
    const before = await fsp.lstat(filename); assert(before.isFile() && !before.isSymbolicLink()); assert.equal((await fsp.realpath(filename)).toLowerCase(), filename.toLowerCase());
    let bytes = 0; const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(filename)) { bytes += chunk.length; hash.update(chunk); }
    const after = await fsp.lstat(filename); assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(bytes, file.bytes); assert.equal(hash.digest('hex'), file.sha256);
    const packaged = managedFiles.get(prefix + file.path); assert(packaged, 'Animation runtime resource missing: ' + file.path); assert.equal(packaged.bytes, file.bytes); assert.equal(packaged.sha256, file.sha256);
    files.push({ path: prefix + file.path, bytes: file.bytes, sha256: file.sha256 });
  }
  for (const required of ['xuzuo-animation.exe', 'licenses/Python.txt', 'licenses/Pillow-1.txt', 'licenses/PyInstaller-1.txt', 'licenses/gif-factory.txt']) assert(files.some(file => file.path === prefix + required), 'Required animation runtime/notice missing: ' + required);
  assert(files.some(file => /^resources\/animation-tool\/_internal\/python3\d+\.dll$/i.test(file.path)), 'Bundled Python interpreter missing');
  assert.deepEqual([...managedFiles.keys()].filter(name => name.startsWith(prefix)).sort(), files.map(file => file.path).sort(), 'Animation runtime file set differs from its controlled build');
  return { passed: true, sourceMatches: true, type: cache.type, buildSignature: cache.signature, files };
}
