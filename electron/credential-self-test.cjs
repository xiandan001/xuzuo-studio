// Run explicitly with Electron. Ordinary application startup does not import this file.
const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createCredentialStore } = require('./credential-store.cjs');

const temporaryDirectory = fsSync.mkdtempSync(path.join(os.tmpdir(), 'xuzuo-credential-self-test-'));
app.setName('Xuzuo Credential Self Test');
app.setPath('userData', temporaryDirectory);

app.whenReady().then(async () => {
  const store = createCredentialStore({ directory: temporaryDirectory, safeStorage });
  assert.equal((await store.status()).available, true);
  const fakeSecret = 'fake-test-only-credential-5471';
  const first = await store.save({ name: '加密自测凭证', connectionId: 'self-test-connection', secret: fakeSecret });
  const filename = path.join(temporaryDirectory, 'credentials-v1.json');
  const saved = await fs.readFile(filename, 'utf8');
  assert.equal(saved.includes(fakeSecret), false);
  const ciphertext = JSON.parse(saved).entries[0].ciphertext;
  const decrypted = await safeStorage.decryptStringAsync(Buffer.from(ciphertext, 'base64'));
  assert.equal(decrypted.result, fakeSecret);
  const reopened = createCredentialStore({ directory: temporaryDirectory, safeStorage });
  assert.equal((await reopened.list())[0].id, first.id);
  assert.equal((await reopened.setEnabled({ id: first.id, enabled: false })).enabled, false);
  const renamed = await reopened.save({ id: first.id, name: '更名后的自测凭证', connectionId: 'self-test-connection', secret: '' });
  assert.equal(renamed.lastFour, '5471');
  assert.equal(renamed.enabled, false);
  console.log(JSON.stringify({ credentialSelfTest: 'passed', encryptedRoundTrip: true, metadataPersisted: true, plaintextAbsent: true, temporaryUserData: temporaryDirectory }));
  app.exit(0);
}).catch(() => {
  console.error('Credential self-test failed. No real keys or network requests were used.');
  app.exit(1);
});
