export interface DocumentImageBinding { modelConfigId?: string; connectionId?: string; credentialId?: string; }
const reference = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
export const documentImageBindingKey = (workspaceId: string, projectId: string) => `xuzuo-document-image-binding-v1:${workspaceId}:${projectId}`;
function checked(value: unknown): DocumentImageBinding | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const input = value as Record<string, unknown>;
  if (input.version !== 1 || Object.keys(input).some(name => !['version', 'modelConfigId', 'connectionId', 'credentialId'].includes(name))) return;
  if (['modelConfigId', 'connectionId', 'credentialId'].some(name => input[name] !== undefined && !reference(input[name]))) return;
  return { ...(input.modelConfigId ? { modelConfigId: input.modelConfigId as string } : {}), ...(input.connectionId ? { connectionId: input.connectionId as string } : {}), ...(input.credentialId ? { credentialId: input.credentialId as string } : {}) };
}
export function readDocumentImageBinding(workspaceId: string, projectId: string, store?: Pick<Storage, 'getItem'>): DocumentImageBinding {
  try {
    const storage = store || (typeof localStorage === 'undefined' ? undefined : localStorage), raw = storage?.getItem(documentImageBindingKey(workspaceId, projectId));
    return raw && raw.length <= 2048 ? checked(JSON.parse(raw)) || {} : {};
  } catch { return {}; }
}
export function saveDocumentImageBinding(workspaceId: string, projectId: string, value: DocumentImageBinding, store?: Pick<Storage, 'setItem'>): boolean {
  try {
    const storage = store || (typeof localStorage === 'undefined' ? undefined : localStorage), safe = checked({ version: 1, modelConfigId: value.modelConfigId, connectionId: value.connectionId, credentialId: value.credentialId });
    if (!storage || !safe?.modelConfigId) return false;
    storage.setItem(documentImageBindingKey(workspaceId, projectId), JSON.stringify({ version: 1, ...safe })); return true;
  } catch { return false; }
}
