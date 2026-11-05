export interface HomeFolderSendIntent { token: string; workspaceId: string; conversationId: string; inputVersion: number; text: string; modelConfigId: string; credentialId: string; projectId?: string; dispatched?: boolean; cancelled?: boolean; }
export interface HomeFolderSendContext { workspaceId: string; conversationId: string; inputVersion: number; text: string; modelConfigId?: string; credentialId?: string; }
export function homeFolderSendMatches(intent: HomeFolderSendIntent, current: HomeFolderSendContext): boolean {
  return !intent.cancelled && intent.workspaceId === current.workspaceId && intent.conversationId === current.conversationId && intent.inputVersion === current.inputVersion && intent.text === current.text.trim() && intent.modelConfigId === current.modelConfigId && intent.credentialId === current.credentialId;
}
