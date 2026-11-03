import type { BusinessCategory } from '../configuration-types';
import { activeCategories } from '../lib/configuration';
import { Select } from './Select';

export function BusinessCategorySelect({ categories, value = '', onChange, label = '业务分类', includeAll = false }: { categories: BusinessCategory[]; value?: string; onChange: (value: string) => void; label?: string; includeAll?: boolean }) {
  const active = activeCategories(categories);
  const selected = categories.find(item => item.id === value);
  const options = [
    ...(includeAll ? [{ value: 'all', label: '全部业务分类' }] : []), { value: '', label: '未分类' },
    ...active.filter(item => !item.parentId).flatMap(parent => [
      { value: parent.id, label: `${parent.name} · 大分类`, group: parent.name },
      ...active.filter(item => item.parentId === parent.id).map(child => ({ value: child.id, label: `${parent.name} / ${child.name}`, group: parent.name })),
    ]),
    ...(selected && !active.some(item => item.id === value) ? [{ value, label: `${selected.name}（已归档）`, disabled: true }] : []),
  ];
  return <label className="form-label"><span>{label}</span><Select aria-label={label} className="field" value={value} onValueChange={onChange} options={options} /></label>;
}
