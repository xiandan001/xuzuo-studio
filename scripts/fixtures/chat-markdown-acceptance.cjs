const assert = require('node:assert/strict');
const { code, text } = require('./chat-markdown-sample.cjs');

async function verifyMarkdownReply({ service, workspaceId, calls, report, evaluate, click, dom, step }) {
  await step('markdown-quotation-emphasis-entities-and-clean-copy-without-resend', async () => {
    const beforeCalls = calls.length, beforeLedger = await service.ledger(workspaceId), records = await service.list(workspaceId);
    let original;
    for (const record of records) { const value = await service.read({ workspaceId, conversationId: record.id }); if (value.turns[5]?.text === text) { original = value; break; } }
    assert(original, 'The genuine long SSE answer must remain saved verbatim');
    await click('[aria-label="聊天历史"]'); await click('.chat-history-open', original.title);
    await dom(`document.querySelectorAll('.workspace-chat-turn').length===9`, 'original source chat visible for Markdown copy acceptance');
    const rendered = await evaluate(`(()=>{const answer=document.querySelectorAll('.workspace-chat-turn')[5].querySelector('.is-assistant');return {quotation:answer.querySelector('blockquote')?.textContent,strong:[...answer.querySelectorAll('strong')].map(node=>node.textContent),code:[...answer.querySelectorAll('pre code')].map(node=>node.textContent),body:answer.querySelector('.workspace-chat-bubble').textContent,tables:answer.querySelectorAll('table').length}})()`);
    assert(rendered.quotation?.replace(/\u00a0/g, ' ').includes('角色建议：温暖 & 清楚，面向 新用户。')); assert(rendered.quotation.includes('交付要求：保留细节')); assert(rendered.strong.includes('角色建议')); assert(rendered.strong.includes('交付要求'));
    assert(!/^\s*>/m.test(rendered.quotation) && !rendered.quotation.includes('**') && !/&(amp|nbsp|#x79CD);/.test(rendered.quotation));
    assert(rendered.body.includes('正文中的种类和实体应自然阅读。')); assert(rendered.code.some(value => value.includes(code))); assert.equal(rendered.tables, 1);
    const copies = await evaluate(`Number(document.documentElement.dataset.chatCopyCount||'0')`);
    await evaluate(`(()=>{const button=document.querySelectorAll('.workspace-chat-turn')[5].querySelector('[aria-label="复制这条回复"]');button.scrollIntoView({block:'center'});button.click()})()`);
    await dom(`Number(document.documentElement.dataset.chatCopyCount||'0')===${copies + 1}`, 'actual Copy reply button reached the isolated clipboard capture');
    const copied = await evaluate(`document.documentElement.dataset.chatCopiedText`), outsideCode = copied.replace(code, '');
    assert(copied.includes('角色建议：温暖 & 清楚，面向')); assert(copied.includes('交付要求：保留细节')); assert(copied.includes('正文中的种类和实体应自然阅读。')); assert(copied.includes(code));
    assert(!/^\s*>/m.test(copied) && !outsideCode.includes('**') && !outsideCode.includes('&amp;') && !outsideCode.includes('&nbsp;') && !copied.includes('```'));
    const after = await service.read({ workspaceId, conversationId: original.id }); assert.deepEqual(after, original); assert.deepEqual(await service.ledger(workspaceId), beforeLedger); assert.equal(calls.length, beforeCalls); assert.equal(beforeCalls, 9);
    report.markdownChecks = { semanticQuotation: true, emphasisAndEntitiesReadable: true, cleanCopyThroughActualButton: true, codeOperatorsPreserved: true, sourceTextAndLedgerUnchanged: true, noAdditionalModelRequests: true, systemClipboardUntouched: true };
  });
}
module.exports = { verifyMarkdownReply };
