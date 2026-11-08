const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { CredentialStoreError } = require('./credential-errors.cjs');

const MAX_SECRET_LENGTH = 8192;

function publicMetadata(entry) {
  return { id: entry.id, name: entry.name, connectionId: entry.connectionId, lastFour: entry.lastFour, enabled: entry.enabled, updatedAt: entry.updatedAt };
}

function validText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}

function validateInput(input) {
  if (!input || !validText(input.name, 80) || !validText(input.connectionId, 160) || (input.id !== undefined && !validText(input.id, 160)) || typeof input.secret !== 'string' || input.secret.length > MAX_SECRET_LENGTH) {
    throw new Error('请填写有效的密钥名称、连接和密钥内容。');
  }
}

function validateEntries(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.entries)) throw new Error('invalid');
  const ids = new Set();
  return value.entries.map(entry => {
    if (!entry || !validText(entry.id, 160) || ids.has(entry.id) || !validText(entry.name, 80) || !validText(entry.connectionId, 160) || typeof entry.lastFour !== 'string' || entry.lastFour.length > 4 || typeof entry.enabled !== 'boolean' || !validText(entry.updatedAt, 80) || typeof entry.ciphertext !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(entry.ciphertext)) throw new Error('invalid');
    ids.add(entry.id);
    return { ...publicMetadata(entry), ciphertext: entry.ciphertext };
  });
}

function isTrustedCredentialSender(event, webContents, applicationUrl) {
  return Boolean(webContents && event.sender === webContents && event.senderFrame && event.senderFrame === webContents.mainFrame && event.senderFrame.url === applicationUrl);
}

function createCredentialStore({ directory, safeStorage, fileSystem = fs, uuid = randomUUID, now = () => new Date().toISOString(), platform = process.platform }) {
  const filename = path.join(path.resolve(directory), 'credentials-v1.json');
  let queue = Promise.resolve();
  const serial = action => {
    const operation = queue.then(action);
    queue = operation.catch(() => undefined);
    return operation;
  };

  let encryptionReady = false;
  async function encryptionStatus() {
    try {
      const available = await safeStorage.isAsyncEncryptionAvailable();
      encryptionReady = available;
      return available ? { available: true } : { available: false, reason: '系统加密暂不可用，无法保存真实 API Key。' };
    } catch { return { available: false, reason: '系统加密暂不可用，无法保存真实 API Key。' }; }
  }
  async function status() {
    if (platform !== 'darwin') return encryptionStatus();
    // This API initializes the macOS key provider and may prompt for Keychain
    // access. Startup, refresh and metadata browsing must remain read-only.
    const available = ['isAsyncEncryptionAvailable', 'encryptStringAsync', 'decryptStringAsync'].every(name => typeof safeStorage?.[name] === 'function');
    if (!available) return { available: false, reason: '当前桌面运行时不支持系统密钥加密。' };
    return encryptionReady ? { available: true } : { available: true, requiresAuthorization: true, reason: '保存或使用密钥时，macOS 将按需请求钥匙串授权。' };
  }

  async function readEntries() {
    try { return validateEntries(JSON.parse(await fileSystem.readFile(filename, 'utf8'))); }
    catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw new CredentialStoreError('CREDENTIAL_STORE_UNREADABLE');
    }
  }

  async function persist(entries) {
    const temporary = `${filename}.${uuid()}.tmp`;
    try {
      await fileSystem.mkdir(path.dirname(filename), { recursive: true });
      await fileSystem.writeFile(temporary, `${JSON.stringify({ version: 1, entries })}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await fileSystem.rename(temporary, filename);
    } catch {
      try { await fileSystem.unlink(temporary); } catch { /* A failed write may not have created a temporary file. */ }
      throw new Error('本机凭证保存失败，已有密钥保持不变。');
    }
  }

  async function encrypt(secret) {
    if (!(await encryptionStatus()).available) throw new Error('系统加密暂不可用，未保存密钥。');
    try { return (await safeStorage.encryptStringAsync(secret)).toString('base64'); }
    catch { encryptionReady = false; throw new Error('系统加密失败，未保存密钥。'); }
  }

  function save(input) {
    return serial(async () => {
      validateInput(input);
      const entries = await readEntries();
      const existing = input.id ? entries.find(entry => entry.id === input.id) : undefined;
      if (input.id && !existing) throw new Error('找不到这条密钥，请重新选择。');
      const secret = input.secret.trim();
      if (/[\r\n]/.test(secret)) throw new Error('API Key 不能包含换行，请逐条录入。');
      if (!secret && !existing) throw new Error('新建密钥时需要填写 API Key。');
      const ciphertext = secret ? await encrypt(secret) : existing.ciphertext;
      const entry = { id: existing?.id || uuid(), name: input.name.trim(), connectionId: input.connectionId.trim(), lastFour: secret ? secret.length > 4 ? secret.slice(-4) : '' : existing.lastFour, enabled: existing?.enabled ?? true, updatedAt: now(), ciphertext };
      await persist(existing ? entries.map(item => item.id === entry.id ? entry : item) : [...entries, entry]);
      return publicMetadata(entry);
    });
  }

  function setEnabled(input) {
    return serial(async () => {
      if (!input || !validText(input.id, 160) || typeof input.enabled !== 'boolean') throw new Error('请选择有效的密钥状态。');
      const entries = await readEntries();
      const existing = entries.find(entry => entry.id === input.id);
      if (!existing) throw new Error('找不到这条密钥，请重新选择。');
      const entry = { ...existing, enabled: input.enabled, updatedAt: now() };
      await persist(entries.map(item => item.id === entry.id ? entry : item));
      return publicMetadata(entry);
    });
  }

  async function withSecret(id, connectionId, action) {
    if (!validText(id, 160) || !validText(connectionId, 160) || typeof action !== 'function') throw new CredentialStoreError('CREDENTIAL_INVALID');
    const entries = await serial(readEntries);
    const entry = entries.find(item => item.id === id && item.connectionId === connectionId && item.enabled);
    if (!entry) throw new CredentialStoreError('CREDENTIAL_NOT_FOUND');
    let secret;
    try { secret = (await safeStorage.decryptStringAsync(Buffer.from(entry.ciphertext, 'base64'))).result; }
    catch { encryptionReady = false; throw new CredentialStoreError('CREDENTIAL_DECRYPT_FAILED'); }
    if (typeof secret !== 'string' || !secret.trim()) { encryptionReady = false; throw new CredentialStoreError('CREDENTIAL_DECRYPT_FAILED'); }
    encryptionReady = true;
    try { return await action(secret); }
    finally { secret = undefined; }
  }

  return { status, list: () => serial(async () => (await readEntries()).map(publicMetadata)), save, setEnabled, withSecret };
}

module.exports = { createCredentialStore, isTrustedCredentialSender };
