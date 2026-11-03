import type { CredentialMetadata, ModelConfiguration, ModelConnection } from '../configuration-types';

export function connectionCredentials(credentials: CredentialMetadata[], connectionId: string) {
  return credentials.filter(item => item.enabled && item.connectionId === connectionId);
}

export function selectedConnectionCredential(credentials: CredentialMetadata[], connectionId: string, selected = '') {
  const candidates = connectionCredentials(credentials, connectionId);
  return candidates.some(item => item.id === selected) ? selected : candidates.length === 1 ? candidates[0].id : '';
}

export function modelSetupSummary(connections: ModelConnection[], models: ModelConfiguration[], credentials: CredentialMetadata[]) {
  const realConnections = connections.filter(item => !item.demo), enabledConnections = realConnections.filter(item => item.enabled);
  const realModels = models.filter(item => !item.demo), enabledModels = realModels.filter(item => item.enabled && enabledConnections.some(connection => connection.id === item.connectionId));
  const enabledKeys = credentials.filter(item => item.enabled && enabledConnections.some(connection => connection.id === item.connectionId));
  const readyModels = enabledModels.filter(item => enabledKeys.some(key => key.connectionId === item.connectionId));
  const missingKeyConnectionId = enabledModels.find(item => !enabledKeys.some(key => key.connectionId === item.connectionId))?.connectionId;
  return { realConnections, enabledConnections, realModels, enabledModels, enabledKeys, readyModels, missingKeyConnectionId };
}
