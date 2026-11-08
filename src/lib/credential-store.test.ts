import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CredentialInput, CredentialMetadata, CredentialsBridge } from '../configuration-types';

interface FileSystemMock {
  files: Map<string, string>;
  readFile: (filename: string, encoding: string) => Promise<string>;
  mkdir: (directory: string, options: object) => Promise<void>;
  writeFile: (filename: string, contents: string, options: object) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  unlink: (filename: string) => Promise<void>;
}
interface EncryptionMock {
  isAsyncEncryptionAvailable: () => Promise<boolean>;
  encryptStringAsync: (value: string) => Promise<Buffer>;
  decryptStringAsync: (value: Buffer) => Promise<{ result: string; shouldReEncrypt: boolean }>;
}
interface CreateStoreOptions { directory: string; safeStorage: EncryptionMock; fileSystem: FileSystemMock; uuid?: () => string; now?: () => string; platform?: string; }
interface Frame { url: string; }
interface Contents { mainFrame: Frame; }
interface SenderEvent { sender: Contents; senderFrame: Frame | null; }
const require = createRequire(import.meta.url);
const { createCredentialStore, isTrustedCredentialSender } = require('../../electron/credential-store.cjs') as {
  createCredentialStore: (options: CreateStoreOptions) => CredentialsBridge & { withSecret: <T>(id: string, connectionId: string, action: (secret: string) => Promise<T>) => Promise<T> };
  isTrustedCredentialSender: (event: SenderEvent, contents: Contents, applicationUrl: string) => boolean;
};
const { CredentialStoreError, credentialErrorMessage } = require('../../electron/credential-errors.cjs') as {
  CredentialStoreError: new (code: string) => Error & { code: string };
  credentialErrorMessage: (code: unknown) => string | undefined;
};

function fixtures() {
  const files = new Map<string, string>();
  const fileSystem: FileSystemMock = {
    files,
    readFile: async filename => { if (!files.has(filename)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return files.get(filename)!; },
    mkdir: async () => undefined,
    writeFile: async (filename, contents) => { files.set(filename, contents); },
    rename: async (from, to) => { files.set(to, files.get(from)!); files.delete(from); },
    unlink: async filename => { files.delete(filename); },
  };
  const safeStorage: EncryptionMock = { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async value => Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`), decryptStringAsync: async value => ({ result: Buffer.from(value.toString().replace(/^encrypted:/, ''), 'base64').toString(), shouldReEncrypt: false }) };
  const directory = path.resolve('test-only-vault');
  let sequence = 0;
  const options: CreateStoreOptions = { directory, fileSystem, safeStorage, platform: 'win32', uuid: () => `id-${++sequence}`, now: () => '2026-10-29T12:00:00Z' };
  const filename = path.join(directory, 'credentials-v1.json');
  return { files, fileSystem, safeStorage, options, filename, store: createCredentialStore(options) };
}
const input = (name = '测试凭证'): CredentialInput => ({ name, connectionId: 'test-connection', secret: 'fake-credential-used-only-in-tests-7159' });

describe('桌面凭证库', () => {
  it('macOS启动和重复刷新状态不初始化钥匙串，保存密钥时才请求系统加密', async () => {
    const { options, safeStorage } = fixtures(); let availabilityCalls = 0;
    safeStorage.isAsyncEncryptionAvailable = async () => { availabilityCalls++; return true; };
    const store = createCredentialStore({ ...options, platform: 'darwin' });
    for (let index = 0; index < 5; index++) { expect(await store.status()).toMatchObject({ available: true, requiresAuthorization: true }); expect(await store.list()).toEqual([]); }
    expect(availabilityCalls).toBe(0);
    const entry = await store.save(input()); expect(availabilityCalls).toBe(1);
    expect(await store.status()).toEqual({ available: true });
    await store.save({ ...input(), id: entry.id, name: '只修改名称', secret: '' });
    await store.setEnabled({ id: entry.id, enabled: false });
    expect(availabilityCalls).toBe(1);
  });

  it('macOS拒绝授权后不会在状态轮询中再次申请，也不会保存明文', async () => {
    const { options, safeStorage, files } = fixtures(); let availabilityCalls = 0;
    safeStorage.isAsyncEncryptionAvailable = async () => { availabilityCalls++; return false; };
    const store = createCredentialStore({ ...options, platform: 'darwin' });
    await expect(store.save(input())).rejects.toThrow('系统加密暂不可用');
    for (let index = 0; index < 5; index++) await store.status();
    expect(availabilityCalls).toBe(1); expect(files.size).toBe(0);
  });
  it('真实调用只可在主进程回调解密本连接的启用凭证', async () => {
    const { store } = fixtures(); const entry = await store.save(input());
    expect(await store.withSecret(entry.id, 'test-connection', async secret => ({ matched: secret === input().secret }))).toEqual({ matched: true });
    await expect(store.withSecret(entry.id, 'other-connection', async () => true)).rejects.toThrow();
    await store.setEnabled({ id: entry.id, enabled: false });
    await expect(store.withSecret(entry.id, 'test-connection', async () => true)).rejects.toThrow();
  });

  it('解密失败保留固定原因，不执行生成回调，也不泄露原生错误或在刷新时重复申请授权', async () => {
    const { options, safeStorage, files, filename } = fixtures();
    const store = createCredentialStore({ ...options, platform: 'darwin' });
    const entry = await store.save(input()), original = files.get(filename);
    let decryptions = 0, callbacks = 0;
    const privateDetail = `native-error-${input().secret}-private-file-path`;
    safeStorage.decryptStringAsync = async () => { decryptions++; throw Object.assign(new Error(privateDetail), { code: -128 }); };
    const failure = await store.withSecret(entry.id, 'test-connection', async () => { callbacks++; return true; }).then(
      () => { throw new Error('Expected credential decryption failure'); },
      error => error as Error & { code: string; cause?: unknown },
    );
    expect(failure).toBeInstanceOf(CredentialStoreError);
    expect(failure.code).toBe('CREDENTIAL_DECRYPT_FAILED');
    expect(failure.message).toBe(credentialErrorMessage('CREDENTIAL_DECRYPT_FAILED'));
    expect(failure.message).toContain('钥匙串'); expect(failure.message).toContain('本次生成请求未发送');
    expect(failure.cause).toBeUndefined(); expect(failure.stack).not.toContain(privateDetail);
    expect(JSON.stringify(failure)).not.toContain(input().secret);
    for (let index = 0; index < 5; index++) expect(await store.status()).toMatchObject({ requiresAuthorization: true });
    expect(decryptions).toBe(1); expect(callbacks).toBe(0); expect(files.get(filename)).toBe(original);
  });

  it.each(['', '   ', null, 42])('解密返回不可用结果 %j 时不派发请求或改写凭证', async result => {
    const { store, safeStorage, files, filename } = fixtures();
    const entry = await store.save(input()), original = files.get(filename); let callbacks = 0;
    safeStorage.decryptStringAsync = async () => ({ result: result as string, shouldReEncrypt: false });
    await expect(store.withSecret(entry.id, 'test-connection', async () => { callbacks++; return true; })).rejects.toMatchObject({ code: 'CREDENTIAL_DECRYPT_FAILED', message: credentialErrorMessage('CREDENTIAL_DECRYPT_FAILED') });
    expect(callbacks).toBe(0); expect(files.get(filename)).toBe(original);
  });

  it('凭证缺失、停用及连接不匹配和凭证库损坏分别报告，不触发系统解密', async () => {
    const { store, safeStorage, files, filename } = fixtures(); const entry = await store.save(input());
    let decryptions = 0, callbacks = 0;
    safeStorage.decryptStringAsync = async () => { decryptions++; throw new Error('must not decrypt'); };
    const action = async () => { callbacks++; return true; };
    await expect(store.withSecret('missing', 'test-connection', action)).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
    await expect(store.withSecret(entry.id, 'other-connection', action)).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
    await store.setEnabled({ id: entry.id, enabled: false });
    await expect(store.withSecret(entry.id, 'test-connection', action)).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
    const broken = '{broken-vault'; files.set(filename, broken);
    await expect(store.withSecret(entry.id, 'test-connection', action)).rejects.toMatchObject({ code: 'CREDENTIAL_STORE_UNREADABLE' });
    expect(files.get(filename)).toBe(broken); expect(decryptions).toBe(0); expect(callbacks).toBe(0);
  });

  it('只有固定错误码可产生公开文案，不接收任意原生错误文本', () => {
    expect(credentialErrorMessage('unknown-native-secret')).toBeUndefined();
    expect(credentialErrorMessage('__proto__')).toBeUndefined();
    expect(credentialErrorMessage(null)).toBeUndefined();
    const error = new CredentialStoreError(input().secret);
    expect(error.code).toBe('CREDENTIAL_INVALID'); expect(error.message).not.toContain(input().secret);
    expect(error.message).toBe(credentialErrorMessage('CREDENTIAL_INVALID'));
  });

  it('成功解密后的生成回调错误保持原身份，不误判为钥匙串失败', async () => {
    const { store } = fixtures(); const entry = await store.save(input()); const providerFailure = new Error('synthetic-provider-failure');
    await expect(store.withSecret(entry.id, 'test-connection', async () => { throw providerFailure; })).rejects.toBe(providerFailure);
  });
  it('磁盘与返回值都不包含明文密钥，列表仅含约定元数据', async () => {
    const { store, files, filename } = fixtures();
    const metadata = await store.save(input());
    expect(metadata.lastFour).toBe('7159');
    expect(Object.keys(metadata).sort()).toEqual(['connectionId', 'enabled', 'id', 'lastFour', 'name', 'updatedAt']);
    expect(JSON.stringify(metadata)).not.toContain(input().secret);
    expect(files.get(filename)).not.toContain(input().secret);
    expect(JSON.parse(files.get(filename)!).entries[0].ciphertext).toEqual(expect.any(String));
    expect(await store.list()).toEqual([metadata]);
  });

  it('重建store仍可读取元数据，修改名称时空密钥保留原密文', async () => {
    const { store, files, filename, options } = fixtures();
    const original = await store.save(input());
    const ciphertext = JSON.parse(files.get(filename)!).entries[0].ciphertext;
    const reopened = createCredentialStore(options);
    const updated = await reopened.save({ ...input(), id: original.id, name: '更名后的凭证', secret: '' });
    expect(updated.id).toBe(original.id);
    expect(updated.lastFour).toBe('7159');
    expect(updated.name).toBe('更名后的凭证');
    expect(JSON.parse(files.get(filename)!).entries[0].ciphertext).toBe(ciphertext);
  });

  it('较短凭证不会通过末四位元数据暴露完整内容', async () => {
    const { store } = fixtures();
    const metadata = await store.save({ ...input(), secret: 'abcd' });
    expect(metadata.lastFour).toBe('');
    expect(JSON.stringify(metadata)).not.toContain('abcd');
  });

  it('系统加密不可用时不创建任何文件，也不降级明文', async () => {
    const { store, safeStorage, files } = fixtures();
    safeStorage.isAsyncEncryptionAvailable = async () => false;
    expect((await store.status()).available).toBe(false);
    await expect(store.save(input())).rejects.toThrow('系统加密暂不可用');
    expect(files.size).toBe(0);
  });

  it('加密操作失败不会产生新的凭证文件', async () => {
    const { store, safeStorage, files } = fixtures();
    safeStorage.encryptStringAsync = async () => { throw new Error(input().secret); };
    await expect(store.save(input())).rejects.toThrow('系统加密失败，未保存密钥。');
    expect(files.size).toBe(0);
  });

  it('原子替换失败时保留旧文件，后续保存仍能成功', async () => {
    const { store, fileSystem, files, filename } = fixtures();
    const original = await store.save(input());
    const previous = files.get(filename);
    const originalRename = fileSystem.rename;
    fileSystem.rename = async () => { throw new Error('disk failure'); };
    await expect(store.save({ ...input(), id: original.id, secret: 'new-test-credential-1234' })).rejects.toThrow('已有密钥保持不变');
    expect(files.get(filename)).toBe(previous);
    expect([...files.keys()]).toEqual([filename]);
    fileSystem.rename = originalRename;
    expect((await store.save({ ...input(), id: original.id, secret: 'new-test-credential-1234' })).lastFour).toBe('1234');
  });

  it('并发保存多条凭证不会互相覆盖', async () => {
    const { store } = fixtures();
    const [first, second] = await Promise.all([store.save(input('凭证一')), store.save(input('凭证二'))]);
    expect(first.id).not.toBe(second.id);
    expect((await store.list()).map(item => item.name)).toEqual(['凭证一', '凭证二']);
  });

  it('损坏文件读取或保存均失败，原始内容不被覆盖', async () => {
    const { store, files, filename } = fixtures();
    files.set(filename, '{broken');
    await expect(store.list()).rejects.toThrow('原文件已保留');
    await expect(store.save(input())).rejects.toThrow('原文件已保留');
    expect(files.get(filename)).toBe('{broken');
  });

  it('停用、启用和替换密钥不改变凭证ID', async () => {
    const { store } = fixtures();
    const original: CredentialMetadata = await store.save(input());
    expect((await store.setEnabled({ id: original.id, enabled: false })).enabled).toBe(false);
    const replaced = await store.save({ ...input(), id: original.id, secret: 'replacement-test-only-8822' });
    expect(replaced).toMatchObject({ id: original.id, lastFour: '8822', enabled: false });
    expect((await store.setEnabled({ id: original.id, enabled: true })).enabled).toBe(true);
    expect(await store.list()).toHaveLength(1);
  });

  it('新建空密钥、未知ID和畸形输入不会建立凭证', async () => {
    const { store, files } = fixtures();
    await expect(store.save({ ...input(), secret: '  ' })).rejects.toThrow('需要填写 API Key');
    await expect(store.save({ ...input(), id: 'missing' })).rejects.toThrow('找不到这条密钥');
    await expect(store.save({ ...input(), name: ' ' })).rejects.toThrow('请填写有效');
    await expect(store.save({ ...input(), secret: 'x'.repeat(8193) })).rejects.toThrow('请填写有效');
    expect(files.size).toBe(0);
  });

  it('IPC只接受可信窗口的应用入口主frame', () => {
    const applicationUrl = 'file:///C:/application/dist/index.html';
    const frame = { url: applicationUrl };
    const contents = { mainFrame: frame };
    expect(isTrustedCredentialSender({ sender: contents, senderFrame: frame }, contents, applicationUrl)).toBe(true);
    expect(isTrustedCredentialSender({ sender: { mainFrame: frame }, senderFrame: frame }, contents, applicationUrl)).toBe(false);
    expect(isTrustedCredentialSender({ sender: contents, senderFrame: { url: applicationUrl } }, contents, applicationUrl)).toBe(false);
    expect(isTrustedCredentialSender({ sender: contents, senderFrame: null }, contents, applicationUrl)).toBe(false);
    expect(isTrustedCredentialSender({ sender: contents, senderFrame: frame }, contents, 'file:///other.html')).toBe(false);
  });
});
