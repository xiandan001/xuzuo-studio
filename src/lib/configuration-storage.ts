import type { StorageIssue } from '../configuration-types';
import { initialConfiguration, readConfigurationResult } from './configuration';
import type { ConfigurationState } from './configuration';

export const CONFIGURATION_KEY = 'xuzuo-configuration-v1';
type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = StorageReader & Pick<Storage, 'setItem'>;
type StorageSource<T> = T | (() => T);
export interface StoredConfiguration { state: ConfigurationState; raw?: string | null; issue?: StorageIssue; }
export function loadStoredConfiguration(storage: StorageSource<StorageReader>): StoredConfiguration {
  let raw: string | null;
  try { raw = (typeof storage === 'function' ? storage() : storage).getItem(CONFIGURATION_KEY); }
  catch { return { state: initialConfiguration(), issue: { kind: 'read', message: '暂时无法读取本机模型与工作流配置，未创建默认内容覆盖它。请检查本机存储后重新读取。', canExportOriginal: false } }; }
  const result = readConfigurationResult(raw);
  return { state: result.state, raw, ...(result.issue ? { issue: { kind: 'read' as const, message: result.issue.message, canExportOriginal: raw !== null } } : {}) };
}
export function writeStoredConfiguration(storage: StorageSource<StorageWriter>, state: ConfigurationState): { raw?: string; issue?: StorageIssue } {
  try { const raw = JSON.stringify(state); (typeof storage === 'function' ? storage() : storage).setItem(CONFIGURATION_KEY, raw); return { raw }; }
  catch { return { issue: { kind: 'write', message: '模型与工作流配置未能保存，本次修改没有替换已有配置。请检查磁盘或浏览器存储后重试。', canExportOriginal: false } }; }
}
export function resetStoredConfiguration(source: StorageSource<StorageWriter>, backupKey: string, expectedRaw?: string | null): StoredConfiguration {
  let raw: string | null;
  let storage: StorageWriter;
  try { storage = typeof source === 'function' ? source() : source; raw = storage.getItem(CONFIGURATION_KEY); }
  catch { return { state: initialConfiguration(), issue: { kind: 'read', message: '尚不能读取原始配置，未重置。请恢复本机存储访问后重试。', canExportOriginal: false } }; }
  const state = initialConfiguration();
  if (expectedRaw !== undefined && raw !== expectedRaw) return { state, raw: expectedRaw, issue: { kind: 'read', message: '配置已被其他窗口更新，请先重新读取；尚未重置任何内容。', canExportOriginal: expectedRaw !== null } };
  try {
    if (raw !== null) storage.setItem(backupKey, raw);
    if (storage.getItem(CONFIGURATION_KEY) !== raw) return { state, raw, issue: { kind: 'read', message: '备份期间配置已被其他窗口更新，请先重新读取；新配置没有被覆盖。', canExportOriginal: raw !== null } };
    const saved = JSON.stringify(state); storage.setItem(CONFIGURATION_KEY, saved);
    return { state, raw: saved };
  } catch { return { state, raw, issue: { kind: 'read', message: '无法完成原始配置备份及重置，原配置没有被清空。请先导出原始内容并检查本机存储空间。', canExportOriginal: raw !== null } }; }
}
