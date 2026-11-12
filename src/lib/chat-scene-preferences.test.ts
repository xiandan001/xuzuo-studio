import { expect, it } from 'vitest';
import { favoriteChatScene, quickChatScenes, readChatScenePreferences, usedChatScene } from './chat-scene-preferences';
import { compactModelName } from './model-display';
it('keeps only available unique scenes and a bounded favorite/recent list', () => {
  const value = readChatScenePreferences(JSON.stringify({ version: 1, favorites: ['poster', 'poster', 'removed'], recent: ['word', 'poster'] }), ['poster', 'word']);
  expect(value.favorites).toEqual(['poster']); expect(quickChatScenes(value, 'word')).toEqual(['poster']);
  expect(usedChatScene(value, 'word').recent).toEqual(['word', 'poster']); expect(favoriteChatScene(value, 'poster').favorites).toEqual([]);
  expect(readChatScenePreferences('{broken', ['poster'])).toEqual({ version: 1, favorites: [], recent: [] });
});
it('preserves custom names while shortening known catalog metadata', () => {
  expect(compactModelName({ name: 'GPT-6.1 Terra · 官方全球 API · USD', modelId: 'gpt-6.1-terra' })).toBe('GPT-6.1 Terra');
  expect(compactModelName({ name: '工作用模型 · 上海低延迟', modelId: 'custom' })).toBe('工作用模型 · 上海低延迟');
});
