export const BEAD_WORKSPACE_NOTICE = '拼豆图纸需先选择一张底图，在拼豆工作台按真实色卡生成网格、色号与采购表。本地制图不收费。';

const bead = /拼豆|\bperler\b|\b(?:fuse[ds]?\s+)?beads?\b/i;
const technical = /图纸|图样|网格|格子|格数|底板|色号|用量|采购(?:表|清单)?|\bpattern\b|\bpegboard\b|\b(?:colou?r\s*codes?|quantit(?:y|ies)|procurement|shopping\s*list)\b/i;
const marketing = /宣传|海报|营销|广告|文案|招牌|店招|经营|开店|商业计划|\bppt\b|\bpresentation\b|\bposter\b|\bmarketing\b|\badvertis\w*\b|\bcopywriting\b/i;
const explanatory = /^(?:请|帮我|为我|给我)?\s*(?:介绍|讲解|说明|描述|提及|宣传|推广|展示|文案|标题|口号|写上|标明|讲讲|explain\b|describe\b|about\b)/i;
const style = /拼豆\s*(?:风|风格)|\b(?:perler|bead)\s*[- ]?style\b/i;
const action = /做|制作|生成|绘制|设计|转(?:成|为|换)?|制成|拼成|想要|需要|\b(?:make|create|generate|convert|turn)\b/i;
const negated = /(?:不要|不需要|不用|无需|不必|不再|禁止|别|不想|不是要|不做|不制作|不生成)\s*(?:(?:把|将)(?:这|那)?(?:一)?(?:张)?(?:原图|参考图|图片|照片|图)\s*)?(?:(?:帮我|为我|给我|再|继续|进行|设计|做|制作|生成|转换|转成|转为|制成|要|任何|一个|一份|一套|一张|新的|实际的|真的|的)\s*)*(?:\d{1,3}\s*[×xX*]\s*\d{1,3}\s*(?:格|的)?\s*)?(?:拼豆|perler\b|(?:fuse[ds]?\s+)?beads?\b|hama\b)|\b(?:do\s+not|don['’]t|never|no|not)\s+(?:(?:make|create|generate|convert|a|an|any|new|actual|real)\s+)*(?:perler|(?:fuse[ds]?\s+)?beads?|hama)\b|拼豆(?:图纸|图样|网格)?\s*(?:不要|不用|不需要|无需|不必)\s*(?:再)?(?:做|制作|生成|转换)/i;
const join = /\s*(?:和|以及|及|加上|加|[+&]|\band\b)\s*/i;
const contentModifier = /(?:以|用).*(?:为|作)(?:主题|标题|卖点|口号)|介绍|讲解|描述|文案|标题|口号|写上|标明|展示/i;

function actualBeadClause(clause: string): boolean {
  if (!bead.test(clause) || negated.test(clause) || explanatory.test(clause)) return false;
  if (!marketing.test(clause)) {
    if (technical.test(clause)) return true;
    if (style.test(clause)) return false;
    if (!/拼豆|\bperler\b|\bfuse[ds]?\s+beads?\b/i.test(clause)) return false;
    return action.test(clause) || /^(?:请)?\s*(?:拼豆|perler(?:\s+beads?)?|(?:fuse[ds]?\s+)?beads?)\s*$/i.test(clause);
  }
  // A poster about patterns stays a poster. Separate requested products may include both.
  if (contentModifier.test(clause)) return false;
  const parts = clause.split(join);
  return parts.length > 1 && action.test(clause) && parts.some(part => bead.test(part) && technical.test(part) && !marketing.test(part) && !negated.test(part) && !style.test(part));
}

export function isBeadPatternRequest(text: string): boolean {
  if (typeof text !== 'string' || !text.trim() || !bead.test(text)) return false;
  const content = marketing.test(text) ? text.replace(/“[^”]*”|"[^"]*"|「[^」]*」|『[^』]*』|《[^》]*》/g, '') : text;
  return content.split(/[，,。；;\n!?？！]|但是|不过|而是|然后|另外|并且|同时|(?=(?:再|另|并)(?:做|制作|生成|绘制|转成))/).some(part => actualBeadClause(part.trim()));
}
