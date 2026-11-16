import fs from 'node:fs';
import assert from 'node:assert/strict';

const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
assert.equal(lock.version, manifest.version, 'Lockfile release version must match package.json');
assert.equal(lock.packages[''].version, manifest.version, 'Lockfile root package version must match package.json');
assert.equal(lock.name, manifest.name);
assert.equal(lock.packages[''].name, manifest.name);
console.log(JSON.stringify({ passed: true, version: manifest.version, lockVersionSynchronized: true }));
