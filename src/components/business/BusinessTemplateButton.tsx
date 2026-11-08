import type { BusinessImportPreview } from '../../business-types';
import { downloadFile } from '../../lib/files';

export const BUSINESS_IMPORT_TEMPLATES = {
  products: { name: '商品资料模板.csv', headers: 'SKU,商品名称,材质,尺寸,售价,卖点,参考图' },
  transactions: { name: '实际收支模板.csv', headers: '流水号,类型,金额,数量,发生时间,来源,备注' },
  metrics: { name: '发布指标模板.csv', headers: '平台,版本,期间,曝光,点击,咨询,成交,收入,来源,外部流水号' },
};
export function BusinessTemplateButton({ kind }: { kind: BusinessImportPreview['kind'] }) {
  const template = BUSINESS_IMPORT_TEMPLATES[kind];
  return <button type="button" className="text-button" onClick={() => { void downloadFile(template.name, '\uFEFF' + template.headers + '\n', 'text/csv;charset=utf-8'); }}>下载空白CSV模板</button>;
}
