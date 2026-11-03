import type { ProjectKind } from '../types';

export function assetUsageLabel(kind: ProjectKind, image = true): string {
  if (!image || kind === 'excel') return '加入参考资料';
  return kind === 'word' ? '插入 Word 文档' : kind === 'ppt' ? '新增 PPT 图片页' : '作为精修参考';
}
