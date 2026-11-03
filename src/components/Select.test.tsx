import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Select, filterSelectOptions, nextSelectIndex, selectPopupPosition } from './Select';
import type { SelectOption } from './Select';
import { BusinessCategorySelect } from './BusinessCategorySelect';

const options: SelectOption[] = [
  { value: '', label: '不分类' },
  { value: 'archived', label: '旧模型', disabled: true },
  { value: 'text-model', label: '文档模型', group: 'OpenAI', description: 'gpt-text-current' },
  { value: 'image-model', label: '图片模型', group: '其他服务', description: '图像精修' },
];

describe('共享自定义选择器', () => {
  it('键盘上下移动跳过已停用选项，保留空值选项并可首尾循环', () => {
    expect(nextSelectIndex(options, -1, 1)).toBe(0);
    expect(nextSelectIndex(options, 0, 1)).toBe(2);
    expect(nextSelectIndex(options, 2, -1)).toBe(0);
    expect(nextSelectIndex(options, 0, -1)).toBe(3);
    expect(nextSelectIndex(options, 3, 1)).toBe(0);
    expect(nextSelectIndex([], -1, 1)).toBe(-1);
    expect(nextSelectIndex(options.map(option => ({ ...option, disabled: true })), 0, 1)).toBe(-1);
  });

  it('可按名称、模型ID、分组和中文说明搜索，未知关键词不显示其它项', () => {
    expect(filterSelectOptions(options, '  GPT-text  ').map(option => option.value)).toEqual(['text-model']);
    expect(filterSelectOptions(options, 'OpenAI').map(option => option.value)).toEqual(['text-model']);
    expect(filterSelectOptions(options, '精修').map(option => option.value)).toEqual(['image-model']);
    expect(filterSelectOptions(options, '不存在')).toEqual([]);
    expect(filterSelectOptions(options, '')).toBe(options);
  });

  it('靠近右边界的长控件不越界，底部空间不足时向上展开', () => {
    const right = selectPopupPosition({ left: 1000, top: 100, bottom: 144, width: 320 }, 1120, 760);
    expect(right.left).toBe(792);
    expect(right.width).toBe(320);
    expect(right.top).toBe(150);
    const above = selectPopupPosition({ left: 200, top: 650, bottom: 694, width: 260 }, 1120, 760);
    expect(above.bottom).toBe(116);
    expect(above.top).toBeUndefined();
    expect(above.maxHeight).toBeLessThanOrEqual(360);
  });

  it('窄视口仍保留安全间距，少量选项不会无故向上展开', () => {
    const narrow = selectPopupPosition({ left: -20, top: 10, bottom: 54, width: 400 }, 300, 600, 140);
    expect(narrow.left).toBe(8); expect(narrow.width).toBe(284);
    const short = selectPopupPosition({ left: 20, top: 500, bottom: 544, width: 200 }, 1120, 760, 140);
    expect(short.top).toBe(550); expect(short.bottom).toBeUndefined();
  });

  it('输出具名combobox而非原生select，保留表单值、禁用和required语义', () => {
    const html = renderToStaticMarkup(<Select id="model" name="model" aria-label="选择模型" value="text-model" options={options} onValueChange={() => undefined} required disabled />);
    expect(html).toContain('role="combobox"'); expect(html).toContain('aria-label="选择模型"');
    expect(html).toContain('文档模型'); expect(html).toContain('aria-required="true"');
    expect(html).toContain('name="model"'); expect(html).toContain('value="text-model"');
    expect(html).toContain('disabled=""'); expect(html).not.toContain('<select'); expect(html).not.toContain('<option');
  });

  it('当前归档分类仍显示名称，不把不存在或空值显示为原始内部ID', () => {
    const html = renderToStaticMarkup(<BusinessCategorySelect value="old" categories={[{ id: 'old', workspaceId: 'w', name: '旧分类', archived: true }]} onChange={() => undefined} />);
    expect(html).toContain('旧分类（已归档）'); expect(html).not.toContain('<select');
    const unavailable = renderToStaticMarkup(<Select value="secret-internal-id" options={[]} onValueChange={() => undefined} />);
    expect(unavailable).toContain('当前选项不可用，请重新选择'); expect(unavailable).not.toContain('secret-internal-id');
  });
});
