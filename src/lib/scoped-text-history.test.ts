import { describe, expect, it } from 'vitest';
import { applyScopedText, emptyScopedTextHistory, inspectScopedText, recordScopedText, SCOPED_TEXT_HISTORY_CHARACTERS, SCOPED_TEXT_HISTORY_LIMIT } from './scoped-text-history';
import { textDeltas } from './text-delta';

const key = 'word:block-1:text';
const initial = (before: string, after: string) => recordScopedText(emptyScopedTextHistory(), key, before, after);
const undo = (history: ReturnType<typeof initial>, value: string, start = 0, end = value.length) => applyScopedText(history, 'undo', key, value, start, end);
const redo = (history: ReturnType<typeof initial>, value: string, start = 0, end = value.length) => applyScopedText(history, 'redo', key, value, start, end);
describe('精确选中文字的局部撤销与重做', () => {
  it('撤销甲句的AI改写，保留同一段落中后来编辑的乙句，重做仍保留乙句', () => {
    const before = '甲原句\n乙原句', generated = '甲AI改写\n乙原句', current = '甲AI改写\n乙用户新增';
    const history = recordScopedText(initial(before, generated), key, generated, current);
    const applied = undo(history, current, 0, 5);
    expect(applied.result.value).toBe('甲原句\n乙用户新增');
    const replayed = redo(applied.history, applied.result.value!, 0, 3);
    expect(replayed.result.value).toBe(current);
  });
  it('同一AI变更含多个独立改动，只撤销所选岛，另一处仍可独立撤销', () => {
    const history = initial('第一段：原文。第二段：保留。第三段：原文。', '第一段：新稿。第二段：保留。第三段：新稿。');
    const first = undo(history, history.past[0].after, 4, 6);
    expect(first.result.value).toBe('第一段：原文。第二段：保留。第三段：新稿。');
    const remaining = first.result.value!, last = remaining.lastIndexOf('新稿');
    expect(undo(first.history, remaining, last, last + 2).result.value).toBe('第一段：原文。第二段：保留。第三段：原文。');
  });
  it('不同字段的修改互相隔离，不需要把文档对象或费用账本写入历史', () => {
    const history = recordScopedText(initial('原句', '修改句'), 'ppt:slide-2:notes', '旧备注', '新备注');
    expect(undo(history, '修改句').result.value).toBe('原句');
    expect(inspectScopedText(history, 'undo', 'excel:sheet:cell', '修改句', 0, 3).available).toBe(false);
    expect(history.past[0]).not.toHaveProperty('ledger'); expect(history.past[0]).not.toHaveProperty('document');
  });
  it('纯插入允许只删除鼠标选中的子串，左右剩余插入内容仍可独立撤销', () => {
    const history = initial('首尾', '首ABCDEFG尾');
    const middle = undo(history, '首ABCDEFG尾', 3, 6);
    expect(middle.result.value).toBe('首ABFG尾');
    expect(middle.result.selectionStart).toBe(3); expect(middle.result.selectionEnd).toBe(3);
    const left = undo(middle.history, middle.result.value!, 1, 3);
    expect(left.result.value).toBe('首FG尾');
    const right = undo(left.history, left.result.value!, 1, 3);
    expect(right.result.value).toBe('首尾');
  });
  it('纯插入的局部子串可在删除后原光标位置重做，不重放其他字符', () => {
    const middle = undo(initial('首尾', '首ABCDEFG尾'), '首ABCDEFG尾', 3, 6);
    const replayed = redo(middle.history, middle.result.value!, 3, 3);
    expect(replayed.result.value).toBe('首ABCDEFG尾');
    expect(replayed.result.selectionStart).toBe(3); expect(replayed.result.selectionEnd).toBe(6);
  });
  it('只选替换的一部分时拒绝扩大范围，返回原因且不改历史或文字', () => {
    const history = initial('甲：原稿；乙：未改', '甲：新方案；乙：未改');
    const applied = undo(history, '甲：新方案；乙：未改', 3, 4);
    expect(applied.result.available).toBe(false); expect(applied.result.reason).toContain('只覆盖');
    expect(applied.history).toBe(history); expect(applied.result.value).toBeUndefined();
  });
  it('新普通编辑清除所有局部重做分支，已有不同区域内容不倒退', () => {
    const first = undo(initial('甲旧，乙旧', '甲新，乙旧'), '甲新，乙旧', 1, 2);
    const branch = recordScopedText(first.history, key, first.result.value!, '甲旧，乙新');
    expect(branch.future).toHaveLength(0); expect(redo(branch, '甲旧，乙新').result.available).toBe(false);
    expect(undo(branch, '甲旧，乙新', 4, 5).result.value).toBe('甲旧，乙旧');
  });
  it('目标前面后来添加文字时重定位，保留前缀及所选范围外的后续修改', () => {
    const history = recordScopedText(initial('甲旧，乙旧', '甲新，乙旧'), key, '甲新，乙旧', '前缀甲新，乙新');
    const applied = undo(history, '前缀甲新，乙新', 3, 4);
    expect(applied.result.value).toBe('前缀甲旧，乙新');
  });
  it('未知外部编辑覆盖目标时禁用，不猜测重复字符串的对应位置', () => {
    const history = initial('first A last', 'first B last');
    const applied = undo(history, 'first C last', 6, 7);
    expect(applied.result.available).toBe(false); expect(applied.result.reason).toContain('无法安全定位');
    const repeated = initial('a foo', 'b foo');
    expect(undo(repeated, 'b foo b foo', 0, 1).result.available).toBe(false);
  });
  it('删除产生的零宽变化可在原位置恢复，重做后只删除恢复的文字', () => {
    const history = initial('甲被删除乙', '甲乙');
    const applied = undo(history, '甲乙', 1, 1);
    expect(applied.result.value).toBe('甲被删除乙');
    expect(redo(applied.history, applied.result.value!, 1, 4).result.value).toBe('甲乙');
  });
  it('恢复一段删除文字后，重做也可只删其中所选子串，剩余重做分支仍可用', () => {
    const applied = undo(initial('首ABCDEFG尾', '首尾'), '首尾', 1, 1);
    const middle = redo(applied.history, applied.result.value!, 3, 6);
    expect(middle.result.value).toBe('首ABFG尾');
    const left = redo(middle.history, middle.result.value!, 1, 3);
    expect(left.result.value).toBe('首FG尾');
    expect(redo(left.history, left.result.value!, 1, 3).result.value).toBe('首尾');
  });
  it('中文和Emoji按完整Unicode字符对齐，DOM的半个代理字符选择会拒绝', () => {
    const history = initial('欢迎🙂来到这里', '欢迎🌟来到这里');
    expect(undo(history, '欢迎🌟来到这里', 2, 4).result.value).toBe('欢迎🙂来到这里');
    expect(undo(history, '欢迎🌟来到这里', 2, 3).result.available).toBe(false);
    expect(undo(history, '欢迎🌟来到这里', -1, 3).result.available).toBe(false);
  });
  it('家庭Emoji、旗帜和组合重音保持完整可见字符，不拆开连接符序列', () => {
    const before = '人物👨‍👩‍👧和e\u0301', after = '人物👨‍👩‍👦和e\u0300';
    const history = initial(before, after), familyEnd = after.indexOf('和');
    expect(undo(history, after, 2, familyEnd).result.value).toBe('人物👨‍👩‍👧和e\u0300');
    expect(undo(history, after, 2, 4).result.available).toBe(false);
    expect(undo(history, after, familyEnd + 1, after.length - 1).result.available).toBe(false);
    expect(undo(initial('旗🇨🇳', '旗🇺🇸'), '旗🇺🇸', 1, 3).result.available).toBe(false);
  });
  it('超预算的整段改写成为明确边界，之后小修改仍可撤销，不跨界重放旧历史', () => {
    const before = '甲'.repeat(1200), after = '乙'.repeat(1200);
    const blocked = initial(before, after);
    expect(undo(blocked, after).result.reason).toContain('超出局部对比范围');
    const newer = recordScopedText(blocked, key, after, `${after}尾`), applied = undo(newer, `${after}尾`, 1200, 1201);
    expect(applied.result.value).toBe(after); expect(undo(applied.history, after).result.reason).toContain('超出局部对比范围');
  });
  it('历史条数、字符串预算有界，重置后没有局部撤销或重做', () => {
    let history = emptyScopedTextHistory();
    for (let index = 0; index < 80; index++) history = recordScopedText(history, `field:${index}`, `旧${'正文'.repeat(1000)}`, `新${'正文'.repeat(1000)}`);
    expect(history.past.length + history.future.length).toBeLessThanOrEqual(SCOPED_TEXT_HISTORY_LIMIT);
    const weight = history.past.reduce((sum, item) => sum + item.before.length + item.after.length + item.changes.reduce((total, change) => total + change.before.length + change.after.length, 0), 0);
    expect(weight).toBeLessThanOrEqual(SCOPED_TEXT_HISTORY_CHARACTERS);
    expect(undo(emptyScopedTextHistory(), '新正文').result.available).toBe(false);
  });
  it('其他字段大量超预算更新也不会移除仍有旧历史字段的安全边界', () => {
    let history = recordScopedText(initial('旧', '新'), key, '新', '复杂'.repeat(20000));
    for (let index = 0; index < 60; index++) history = recordScopedText(history, `other:${index}`, '甲'.repeat(1200), '乙'.repeat(1200));
    expect(undo(history, '新').result.available).toBe(false);
    expect(undo(history, '新').result.reason).toContain('超出局部对比范围');
    expect(Object.keys(history.barriers).length).toBeLessThanOrEqual(SCOPED_TEXT_HISTORY_LIMIT * 2);
  });
  it('inspect是只读操作，不消耗历史，不影响后续重做', () => {
    const history = initial('旧', '新'), snapshot = JSON.stringify(history);
    expect(inspectScopedText(history, 'undo', key, '新', 0, 1).available).toBe(true);
    expect(inspectScopedText(history, 'undo', key, '新', 0, 1).available).toBe(true);
    expect(JSON.stringify(history)).toBe(snapshot);
  });
  it('preview使用的纯apply计算不修改输入栈，外部验证拒绝后仍可再次撤销', () => {
    const history = initial('旧句', '新句'), snapshot = JSON.stringify(history);
    const preview = undo(history, '新句');
    expect(preview.result.value).toBe('旧句'); expect(JSON.stringify(history)).toBe(snapshot);
    expect(inspectScopedText(history, 'undo', key, '新句', 0, 2).available).toBe(true);
    expect(undo(history, '新句').result.value).toBe('旧句');
  });
});

describe('有界字符diff的实际还原', () => {
  it('多处改写与换行、制表符保持准确offset，不把首尾共同文本当整个改动', () => {
    const before = '头部🙂\n甲原文\t中间不变\n乙原文\n尾部', after = '头部🙂\n甲新稿\t中间不变\n乙新稿\n尾部';
    const changes = textDeltas(before, after)!; expect(changes.length).toBeGreaterThan(1);
    let restored = after;
    for (const change of [...changes].reverse()) restored = restored.slice(0, change.afterStart) + change.before + restored.slice(change.afterEnd);
    expect(restored).toBe(before);
  });
  it('大量短字符串变化整体undo/redo可逆，包含重复字符、插入和删除', () => {
    let random = 81721;
    const pick = (max: number) => { random = (random * 48271) % 2147483647; return random % max; };
    for (let sample = 0; sample < 160; sample++) {
      const alphabet = ['甲', '乙', 'A', '🙂', '\n'];
      const before = Array.from({ length: 1 + pick(12) }, () => alphabet[pick(alphabet.length)]).join('');
      const after = Array.from({ length: pick(12) }, () => alphabet[pick(alphabet.length)]).join('');
      if (before === after) continue;
      const applied = undo(initial(before, after), after);
      expect(applied.result.value, `${before} -> ${after}`).toBe(before);
      expect(redo(applied.history, before).result.value, `${after} -> ${before}`).toBe(after);
    }
  });
  it('任意可执行的局部操作都保持选区外前后缀完全相同，并可按返回选区重做', () => {
    let seed = 3317;
    const pick = (max: number) => { seed = (seed * 16807) % 2147483647; return seed % max; };
    for (let sample = 0; sample < 300; sample++) {
      const before = Array.from({ length: 12 }, () => '甲乙丙丁'[pick(4)]).join('');
      const after = before.slice(0, 2) + Array.from({ length: 4 }, () => '戊己庚辛'[pick(4)]).join('') + before.slice(6);
      const start = pick(after.length + 1), end = start + pick(after.length - start + 1);
      const applied = undo(initial(before, after), after, start, end);
      if (!applied.result.available) continue;
      const value = applied.result.value!;
      expect(value.slice(0, start)).toBe(after.slice(0, start));
      expect(value.slice(applied.result.selectionEnd)).toBe(after.slice(end));
      expect(redo(applied.history, value, applied.result.selectionStart, applied.result.selectionEnd).result.value).toBe(after);
    }
  });
});
