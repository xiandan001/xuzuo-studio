import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
assert.equal(process.env.CI, 'true'); assert.equal(process.env.GITHUB_ACTIONS, 'true');
const root = await fsp.realpath(process.cwd()); assert.equal(root.toLowerCase(), (await fsp.realpath(process.env.GITHUB_WORKSPACE)).toLowerCase());
const directory = path.join(root, 'node_modules/electron'), require = createRequire(path.join(directory, 'package.json'));
const version = require('./package.json').version, locked = JSON.parse(await fsp.readFile(path.join(root, 'package-lock.json'), 'utf8')).packages['node_modules/electron'].version;
assert.equal(version, locked); assert.match(version, /^\d+\.\d+\.\d+$/);
const dist = path.join(directory, 'dist'), name = `electron-v${version}-win32-x64.zip`, expected = require('./checksums.json')[name]; assert.match(expected, /^[a-f0-9]{64}$/);
try {
  assert.equal((await fsp.readFile(path.join(dist, 'version'), 'utf8')).trim().replace(/^v/, ''), version);
  assert.equal((await fsp.readFile(path.join(dist, 'electron.exe'))).subarray(0, 2).toString(), 'MZ');
  assert.equal(await fsp.readFile(path.join(directory, 'path.txt'), 'utf8'), 'electron.exe');
  console.log(JSON.stringify({ reused: true, version })); process.exit(0);
} catch { /* A fresh npm package defers the Electron binary download. */ }
await assert.rejects(fsp.lstat(dist), { code: 'ENOENT' });
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'xuzuo-locked-runtime-preparation' };
const response = await fetch(`https://api.github.com/repos/electron/electron/releases/tags/v${version}`, { headers, signal: AbortSignal.timeout(30000) });
assert.equal(response.status, 200); const release = await response.json(); assert.equal(release.tag_name, 'v' + version);
const matches = release.assets.filter(asset => asset.name === name); assert.equal(matches.length, 1); const asset = matches[0];
assert(Number.isSafeInteger(asset.id) && asset.id > 0 && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= 256 * 1024 * 1024);
assert.equal(asset.digest, 'sha256:' + expected);
await fsp.mkdir(path.join(root, 'work'), { recursive: true });
assert.equal((await fsp.realpath(path.join(root, 'work'))).toLowerCase(), path.join(root, 'work').toLowerCase());
const temporary = await fsp.mkdtemp(path.join(root, 'work/electron-download-'));
async function downloadArchive(initial, hosts, filename) {
  const signal = AbortSignal.timeout(180000); let url = new URL(initial), response;
  for (let hop = 0; ; hop++) {
    assert.equal(url.protocol, 'https:'); assert(!url.username && !url.password && !url.port); assert(hosts.includes(url.hostname));
    response = await fetch(url, { redirect: 'manual', signal, headers: { 'User-Agent': headers['User-Agent'] } });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    assert(hop < 3); url = new URL(response.headers.get('location'), url); await response.body?.cancel();
  }
  if (response.status !== 200) { await response.body?.cancel(); throw Object.assign(Error('Runtime download HTTP ' + response.status), { code: 'DOWNLOAD_HTTP_ERROR' }); }
  const hash = createHash('sha256'); let bytes = 0;
  const meter = new Transform({ transform(chunk, _encoding, done) { bytes += chunk.length; if (bytes > asset.size) return done(Object.assign(Error('Runtime exceeded its pinned size'), { code: 'INTEGRITY_ERROR' })); hash.update(chunk); done(null, chunk); } });
  await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(filename, { flags: 'wx' }));
  assert.equal(bytes, asset.size); assert.equal(hash.digest('hex'), expected); return bytes;
}
let archive = path.join(temporary, name), bytes, downloadOrigin = 'github-api';
try {
  const response = await fetch(`https://api.github.com/repos/electron/electron/releases/assets/${asset.id}?download=${randomUUID()}`, { redirect: 'manual', headers: { ...headers, Accept: 'application/octet-stream', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
  if (response.status !== 302) { await response.body?.cancel(); throw Object.assign(Error('Official asset redirect HTTP ' + response.status), { code: 'DOWNLOAD_HTTP_ERROR' }); }
  const location = response.headers.get('location'); assert(typeof location === 'string' && location); await response.body?.cancel();
  bytes = await downloadArchive(location, ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'], archive);
} catch (error) {
  const networkCodes = ['DOWNLOAD_HTTP_ERROR', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'];
  if (!['AbortError', 'TimeoutError'].includes(error.name) && !networkCodes.includes(error.code || error.cause?.code)) throw error;
  console.log(JSON.stringify({ officialDownloadUnavailable: true, reason: error.message }));
  downloadOrigin = 'npmmirror-checksum-verified'; archive = path.join(temporary, 'mirror-' + name);
  bytes = await downloadArchive(`https://npmmirror.com/mirrors/electron/${version}/${name}`, ['npmmirror.com', 'cdn.npmmirror.com'], archive);
}
const runtime = path.join(temporary, 'runtime'); await fsp.mkdir(runtime);
await require('@electron-internal/extract-zip').extract(archive, { dir: runtime });
assert.equal((await fsp.readFile(path.join(runtime, 'version'), 'utf8')).trim().replace(/^v/, ''), version);
assert.equal((await fsp.readFile(path.join(runtime, 'electron.exe'))).subarray(0, 2).toString(), 'MZ');
const definitions = path.join(runtime, 'electron.d.ts');
if (await fsp.lstat(definitions).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) await fsp.rename(definitions, path.join(directory, 'electron.d.ts'));
await fsp.rename(runtime, dist); await fsp.writeFile(path.join(directory, 'path.txt'), 'electron.exe');
const report = { passed: true, version, officialAssetId: asset.id, bytes, sha256: expected, downloadOrigin, checksumSource: 'locked-electron-npm-package', applicationStarted: false };
await fsp.writeFile(path.join(root, 'work/electron-runtime-preparation.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
