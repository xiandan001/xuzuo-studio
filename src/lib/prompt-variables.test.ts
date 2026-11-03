import { describe, expect, it } from 'vitest';
import { extractVariables, resolvePrompt } from './prompt-variables';

describe('提示词变量', () => {
  it('同名变量去重，保留首次出现顺序并去掉变量名周边空白', () => {
    expect(extractVariables('为{{主题}}制作{{风格}}内容，{{ 主题 }}面向{{受众}}。')).toEqual(['主题', '风格', '受众']);
  });

  it('替换同名变量的全部出现位置', () => {
    expect(resolvePrompt('{{主题}}：关于{{ 主题 }}，面向{{受众}}。', { 主题: ' 咖啡品牌 ', 受众: '年轻消费者' })).toEqual({
      content: '咖啡品牌：关于咖啡品牌，面向年轻消费者。', missing: [], complete: true,
    });
  });

  it('未填写、空白填写保留占位符，不假装解析完成', () => {
    expect(resolvePrompt('{{主题}}/{{风格}}/{{主题}}', { 风格: '   ' })).toEqual({
      content: '{{主题}}/{{风格}}/{{主题}}', missing: ['主题', '风格'], complete: false,
    });
  });

  it('替换值里的美元符号和花括号保持字面含义，不递归展开', () => {
    expect(resolvePrompt('内容：{{说明}}', { 说明: '$& 与 {{另外一个变量}}' }).content).toBe('内容：$& 与 {{另外一个变量}}');
  });

  it('没有变量时可以直接应用，不要求无关字段', () => {
    expect(resolvePrompt('只检查已提供的文字。', {})).toEqual({ content: '只检查已提供的文字。', missing: [], complete: true });
  });

  it('继承属性不能冒充已填写的变量', () => {
    const values = Object.create({ 主题: '继承内容' }) as Record<string, string>;
    expect(resolvePrompt('{{主题}}', values).missing).toEqual(['主题']);
  });
});
