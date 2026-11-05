import { describe, expect, it } from 'vitest';
import { stripSavedTimestamp, timestampedFilename } from './saved-filename';

describe('用户保存文件命名', () => {
  it('本地日期时间精确到毫秒，保留中文名称和 Office 扩展名', () => {
    const clock = new Date(2026, 10, 3, 19, 5, 7, 12);
    expect(timestampedFilename('客户 项目方案.docx', clock)).toBe('客户 项目方案_2026-11-03_19-05-07-012.docx');
  });
  it('同毫秒重复保存保留不同名称，不改变成品的扩展名', () => {
    const clock = new Date(2026, 10, 4, 8, 9, 10, 11);
    const names = Array.from({ length: 4 }, () => timestampedFilename('表格.xlsx', clock));
    expect(new Set(names).size).toBe(4);
    expect(names).toEqual(['表格_2026-11-04_08-09-10-011.xlsx', '表格_2026-11-04_08-09-10-011-1.xlsx', '表格_2026-11-04_08-09-10-011-2.xlsx', '表格_2026-11-04_08-09-10-011-3.xlsx']);
  });
  it('已带时间戳的成品另存时替换旧戳，用户原有日期不被误删', () => {
    expect(timestampedFilename('宣传图_2026-11-01_10-20-30-456-2.png', new Date(2026, 10, 5, 1, 2, 3, 4))).toBe('宣传图_2026-11-05_01-02-03-004.png');
    expect(stripSavedTimestamp('2026-11-03-方案-检查报告_2026-11-05_01-02-03-004.json')).toBe('2026-11-03-方案-检查报告.json');
    expect(stripSavedTimestamp('方案-2026-11-03.json')).toBe('方案-2026-11-03.json');
  });
});
