import type { BusinessIntakeKey } from '../business-types';

export const BUSINESS_INTAKE_FIELDS: { key: BusinessIntakeKey; label: string; example: string }[] = [
  { key: 'brief', label: '整体需求', example: '客户明确要求的内容' },
  { key: 'purpose', label: '用途／投放场景', example: '电商详情页、小红书、演示汇报' },
  { key: 'quantity', label: '交付数量', example: '5' },
  { key: 'size', label: '交付尺寸', example: '1080×1920' },
  { key: 'deadline', label: '截止日期', example: '2026-11-30' },
  { key: 'includedRevisions', label: '包含修改次数', example: '2' },
  { key: 'formats', label: '文件格式', example: 'PNG、PPTX' },
];
export const BUSINESS_INTAKE_KEYS = BUSINESS_INTAKE_FIELDS.map(row => row.key);
