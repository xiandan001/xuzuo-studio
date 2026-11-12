export interface ChatScenePreferences { version: 1; favorites: string[]; recent: string[]; }
export const chatScenePreferenceKey = (workspaceId: string) => `xuzuo-chat-scenes-v1:${workspaceId}`;
const empty = (): ChatScenePreferences => ({ version: 1, favorites: [], recent: [] });
export function readChatScenePreferences(raw: string | null, available: string[]): ChatScenePreferences {
  try {
    const value = JSON.parse(raw || 'null'); if (value?.version !== 1 || !Array.isArray(value.favorites) || !Array.isArray(value.recent)) return empty();
    const allowed = new Set(available), valid = (values: unknown[], max: number) => [...new Set(values.filter((id): id is string => typeof id === 'string' && allowed.has(id)))].slice(0, max);
    return { version: 1, favorites: valid(value.favorites, 5), recent: valid(value.recent, 8) };
  } catch { return empty(); }
}
export function usedChatScene(value: ChatScenePreferences, id: string): ChatScenePreferences { return { ...value, recent: [id, ...value.recent.filter(item => item !== id)].slice(0, 8) }; }
export function favoriteChatScene(value: ChatScenePreferences, id: string): ChatScenePreferences {
  if (value.favorites.includes(id)) return { ...value, favorites: value.favorites.filter(item => item !== id) };
  if (value.favorites.length >= 5) throw Error('最多收藏5个场景，请先取消一个。');
  return { ...value, favorites: [...value.favorites, id] };
}
export function quickChatScenes(value: ChatScenePreferences, current: string): string[] { return [...new Set([...value.favorites, ...value.recent])].filter(id => id !== current).slice(0, 3); }
