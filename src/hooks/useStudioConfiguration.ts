import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CredentialInput, CredentialMetadata, StorageIssue, StudioConfiguration, VaultStatus } from '../configuration-types';
import { belongsToCategory, categoryError, connectionError, modelError } from '../lib/configuration';
import type { ConfigurationState } from '../lib/configuration';
import { CONFIGURATION_KEY, loadStoredConfiguration, resetStoredConfiguration, writeStoredConfiguration } from '../lib/configuration-storage';
import { useTemplateError } from '../lib/image-use-templates';
import { downloadFile } from '../lib/files';
import { copyWorkflow } from '../lib/workflow-copy';
type Notify = (message: string, type?: 'success' | 'info' | 'error') => void;
export function useStudioConfiguration(workspaceId: string, notify: Notify): StudioConfiguration {
  const [loaded] = useState(() => loadStoredConfiguration(() => localStorage));
  const [state, setState] = useState(loaded.state);
  const [storageIssue, setStorageIssue] = useState(loaded.issue);
  const stateRef = useRef(state), issueRef = useRef(storageIssue), originalRaw = useRef(loaded.raw);
  const updateIssue = (issue?: StorageIssue) => { issueRef.current = issue; setStorageIssue(issue); };
  const [credentials, setCredentials] = useState<CredentialMetadata[]>([]);
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>({ available: false, reason: '浏览器预览不保存真实密钥，请使用桌面版。' });
  const refreshCredentials = useCallback(async () => {
    if (!window.desktop?.credentials) return;
    try {
      const [status, metadata] = await Promise.all([window.desktop.credentials.status(), window.desktop.credentials.list()]);
      setVaultStatus(status); setCredentials(metadata);
    } catch { setVaultStatus({ available: false, reason: '桌面凭证库暂不可用，未退回明文保存。' }); }
  }, []);
  useEffect(() => { void refreshCredentials(); }, [refreshCredentials]);
  const scoped = useMemo(() => ({ categories: state.categories.filter(item => item.workspaceId === workspaceId), workflows: state.workflows.filter(item => item.workspaceId === workspaceId), studioActions: state.studioActions.filter(item => item.workspaceId === workspaceId), useTemplates: state.useTemplates.filter(item => item.workspaceId === workspaceId) }), [state.categories, state.workflows, state.studioActions, state.useTemplates, workspaceId]);
  const fail = (message: string) => { notify(message, 'error'); return false; };
  const canEdit = () => issueRef.current?.kind !== 'read' || fail('配置仍处于恢复状态，尚未保存本次修改。请先导出原始内容，再重新读取或显式重置。');
  const commit = (update: (previous: ConfigurationState) => ConfigurationState) => {
    if (!canEdit()) return false;
    const next = update(stateRef.current), saved = writeStoredConfiguration(() => localStorage, next);
    if (saved.issue) { updateIssue({ ...saved.issue, canExportOriginal: typeof originalRaw.current === 'string' }); return fail(saved.issue.message); }
    originalRaw.current = saved.raw; stateRef.current = next; setState(next); updateIssue(); return true;
  };

  return {
    ...scoped, connections: state.connections, models: state.models, credentials, vaultStatus, refreshCredentials, storageIssue,
    reloadStorage() {
      const result = loadStoredConfiguration(() => localStorage);
      if (result.raw !== undefined) originalRaw.current = result.raw;
      if (result.issue) { updateIssue({ ...result.issue, canExportOriginal: typeof originalRaw.current === 'string' }); return fail(result.issue.message); }
      stateRef.current = result.state; setState(result.state); updateIssue(); notify('模型与工作流配置已重新读取。'); return true;
    },
    async exportOriginalStorage() {
      if (typeof originalRaw.current !== 'string') return fail('没有可读取的原始配置内容，请先恢复本机存储访问。');
      try { return await downloadFile('序作-原始配置.txt', originalRaw.current, 'text/plain;charset=utf-8'); }
      catch { return fail('原始配置未能导出，原数据仍保留，请检查本机文件下载。'); }
    },
    resetStorage() {
      if (originalRaw.current === undefined) return fail('尚不能读取原始配置，未重置。请先恢复本机存储访问并重新读取。');
      const result = resetStoredConfiguration(() => localStorage, `${CONFIGURATION_KEY}.recovery.${Date.now()}-${crypto.randomUUID()}`, originalRaw.current);
      if (result.raw !== undefined) originalRaw.current = result.raw;
      if (result.issue) { updateIssue({ ...result.issue, canExportOriginal: typeof originalRaw.current === 'string' }); return fail(result.issue.message); }
      stateRef.current = result.state; setState(result.state); updateIssue(); notify('原始配置已备份，模型与工作流配置已重置；项目、产物、费用和加密密钥保持不变。'); return true;
    },
    saveUseTemplate(draft, id) {
      const error = useTemplateError(state.useTemplates, workspaceId, draft, id);
      if (error) return fail(error);
      const item = { id: id || crypto.randomUUID(), workspaceId, name: draft.name.trim(), prompt: draft.prompt.trim().replace(/\r\n?/g, '\n'), size: draft.size, background: draft.background, minReferences: draft.minReferences, enabled: draft.enabled };
      if (!commit(value => ({ ...value, useTemplates: id ? value.useTemplates.map(template => template.id === id && template.workspaceId === workspaceId ? item : template) : [...value.useTemplates, item] }))) return false;
      notify(id ? '用途模板已更新，项目中的现有描述仍保留。' : '用途模板已保存，可在当前工作区的用途下拉中选择。'); return true;
    },
    deleteUseTemplate(id) {
      if (!scoped.useTemplates.some(item => item.id === id && !item.builtin)) return fail('用途模板不属于当前工作区，不能删除内置用途。');
      if (!commit(value => ({ ...value, useTemplates: value.useTemplates.filter(item => item.id !== id || item.workspaceId !== workspaceId) }))) return false;
      notify('用途模板已删除，项目描述、参考图和产物保留。'); return true;
    },
    saveStudioAction(draft, id) {
      if (!draft.name.trim()) return fail('请给这个功能填写名称。');
      if (!scoped.workflows.some(flow => flow.id === draft.workflowId && flow.outputKind === draft.outputKind)) return fail('请选择本工作区中作品类型匹配的工作流。');
      const existing = scoped.studioActions.find(item => item.id === id);
      if (id && !existing) return fail('功能不属于当前工作区。');
      const item = { ...draft, id: id || crypto.randomUUID(), workspaceId, name: draft.name.trim() };
      if (!commit(value => ({ ...value, studioActions: existing ? value.studioActions.map(action => action.id === id ? item : action) : [...value.studioActions, item] }))) return false;
      notify('工作台功能已保存，点击功能后确认参数再执行。'); return true;
    },
    setStudioActionEnabled(id, enabled) { commit(value => ({ ...value, studioActions: value.studioActions.map(item => item.id === id && item.workspaceId === workspaceId ? { ...item, enabled } : item) })); },
    saveCategory(draft, id) {
      const error = categoryError(state.categories, workspaceId, draft, id);
      if (error) return fail(error);
      const existing = state.categories.find(item => item.id === id && item.workspaceId === workspaceId);
      const item = { id: existing?.id || crypto.randomUUID(), workspaceId, name: draft.name.trim(), parentId: draft.parentId || undefined, archived: existing?.archived || false };
      if (!commit(value => ({ ...value, categories: existing ? value.categories.map(category => category.id === id ? item : category) : [...value.categories, item] }))) return false;
      notify(existing ? '分类已更新。' : '分类已创建。'); return true;
    },
    archiveCategory(id, archived) {
      if (!commit(value => ({ ...value, categories: value.categories.map(item => item.id === id && item.workspaceId === workspaceId ? { ...item, archived } : item) }))) return;
      notify(archived ? '分类已归档，关联内容与费用保留。' : '分类已恢复。');
    },
    saveWorkflow(draft, id, options) {
      if (!draft.name.trim()) return fail('请给工作流起一个名称。');
      if (!belongsToCategory(state.categories, workspaceId, draft.businessCategoryId)) return fail('所选分类不属于当前工作区。');
      if (!draft.steps.length || draft.steps.length > 40) return fail('工作流需要 1 到 40 个步骤。');
      if (draft.steps.some(step => !step.name.trim() || step.budgetCents != null && (!Number.isSafeInteger(step.budgetCents) || step.budgetCents < 0))) return fail('请为每一步填写名称；金额上限可留空，填写时需为有效的非负金额。');
      const existing = state.workflows.find(item => item.id === id && item.workspaceId === workspaceId);
      if (id && state.workflows.some(item => item.id === id && item.workspaceId !== workspaceId)) return fail('这个工作流不属于当前工作区。');
      const item = { ...structuredClone(draft), steps: draft.steps.map(step => ({ ...structuredClone(step), budgetCents: step.budgetCents ?? undefined })), name: draft.name.trim(), id: existing?.id || id || crypto.randomUUID(), workspaceId, updatedAt: new Date().toLocaleString('zh-CN') };
      if (!commit(value => ({ ...value, workflows: existing ? value.workflows.map(flow => flow.id === id ? item : flow) : [item, ...value.workflows] }))) return false;
      if (!options?.silent) notify('工作流已保存，尚未执行或计费。'); return true;
    },
    duplicateWorkflow(id) {
      const original = scoped.workflows.find(item => item.id === id);
      if (!original) return;
      let copy: ReturnType<typeof copyWorkflow>;
      try { copy = copyWorkflow(original); } catch (cause) { fail(cause instanceof Error ? cause.message : '工作流副本未保存，原流程保留。'); return; }
      if (!commit(value => ({ ...value, workflows: [copy, ...value.workflows] }))) return; notify('工作流副本已保存。');
    },
    saveConnection(draft, id) {
      if (state.connections.some(item => item.id === id && item.demo)) return fail('本地演示连接保持独立，请新增自己的连接。');
      const error = connectionError(draft);
      if (error) return fail(error);
      const item = { ...draft, name: draft.name.trim(), baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''), id: id || crypto.randomUUID(), status: 'configured' as const };
      const previous = state.connections.find(connection => connection.id === id);
      const changedEndpoint = Boolean(previous && (previous.providerId !== item.providerId || previous.protocol !== item.protocol || previous.baseUrl.replace(/\/+$/, '') !== item.baseUrl));
      if (!commit(value => ({ ...value, connections: id ? value.connections.map(connection => connection.id === id ? item : connection) : [...value.connections, item], models: changedEndpoint ? value.models.map(model => model.connectionId === id && (model.pricing.officialUrl || model.pricing.verifiedAt) ? { ...model, pricing: { unit: model.pricing.unit, currency: model.pricing.currency, input: '', output: '', exchangeRate: model.pricing.exchangeRate } } : model) : value.models }))) return false;
      notify(changedEndpoint ? '连接已更新，相关模型的旧官方价格已清空，请重新选择或核对。' : '连接配置已保存，未发送网络请求。'); return true;
    },
    async checkConnection(id, credentialId) {
      const result = (ok: boolean, message: string) => { notify(message, ok ? 'success' : 'error'); return { ok, message }; };
      const item = state.connections.find(connection => connection.id === id);
      if (!item || item.demo) return result(false, '这是本地演示连接，不连接网络。');
      const error = connectionError(item);
      if (error) return result(false, error);
      if (!window.desktop?.runtime || !credentialId) return result(false, '请在新版桌面应用中选择一条凭证后检查。');
      try { const checked = await window.desktop.runtime.probe({ connection: item, credentialId }); return result(checked.ok, checked.message); }
      catch { return result(false, '认证检查未完成，请检查凭证与接口配置。'); }
    },
    setConnectionEnabled(id, enabled) { commit(value => ({ ...value, connections: value.connections.map(item => item.id === id && !item.demo ? { ...item, enabled } : item) })); },
    saveModel(draft, id) {
      if (state.models.some(item => item.id === id && item.demo)) return fail('请新增自己的模型，本地演示模型保持独立。');
      const error = modelError(draft, state.connections);
      if (error) return fail(error);
      const item = { ...structuredClone(draft), name: draft.name.trim(), modelId: draft.modelId.trim(), id: id || crypto.randomUUID() };
      if (!commit(value => ({ ...value, models: id ? value.models.map(model => model.id === id ? item : model) : [...value.models, item] }))) return false;
      notify('模型配置已保存，能力由你声明，尚未经过真实调用验证。'); return true;
    },
    setModelEnabled(id, enabled) { commit(value => ({ ...value, models: value.models.map(item => item.id === id && !item.demo ? { ...item, enabled } : item) })); },
    async saveCredential(input: CredentialInput) {
      if (!canEdit()) return false;
      if (!window.desktop?.credentials || !vaultStatus.available) return fail(vaultStatus.reason || '请在桌面版添加密钥。');
      if (!state.connections.some(item => item.id === input.connectionId && !item.demo)) return fail('请先选择自己的模型连接。');
      try { await window.desktop.credentials.save(input); await refreshCredentials(); notify('密钥已由系统加密保存，仅显示掩码。'); return true; }
      catch { return fail('密钥保存失败；请检查系统加密和本地存储状态。'); }
    },
    async setCredentialEnabled(id, enabled) {
      if (!canEdit()) return;
      if (!window.desktop?.credentials) return;
      try { await window.desktop.credentials.setEnabled({ id, enabled }); await refreshCredentials(); }
      catch { notify('未能更新凭证状态。', 'error'); }
    },
  };
}
