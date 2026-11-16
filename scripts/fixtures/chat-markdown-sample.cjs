const code = 'if (x>0) value = 2**3;\nconst literal = "&amp;";';
const text = [
  '# 完整说明', '',
  '> **角色建议**：温暖 &amp; 清楚，面向&nbsp;新用户。',
  '>',
  '> **交付要求**：保留细节，不出现无意义的符号。', '',
  '**关键结论**：正文中的&#x79CD;类和实体应自然阅读。', '',
  '这是用于布局验收的长内容。', '',
  '橘猫创作需要清楚目标、动作、受众和交付尺寸。'.repeat(70), '',
  '| 类别 | 内容 |', '| --- | --- |', '| 角色 | 橘猫 |', '',
  '```javascript', code, '// ' + 'LONG_UNBROKEN_TOKEN_'.repeat(40), '```',
].join('\n');
module.exports = { code, text };
