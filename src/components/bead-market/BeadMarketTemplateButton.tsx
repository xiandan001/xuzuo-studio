import { downloadFile } from '../../lib/files';
export function BeadMarketTemplateButton() {
  return <button type="button" className="text-button" onClick={() => { void downloadFile('拼豆材料报价模板.csv', '\uFEFF平台,商品链接,商品名称,店铺名称,店铺ID,品牌,系列,珠径,色号,珠种,每包粒数,每包价格,起订包数,运费,包邮门槛,采集时间\n', 'text/csv;charset=utf-8'); }}>下载空白报价表模板</button>;
}
