import { ArrowUpRight, Files, PackageCheck, ShoppingBag } from 'lucide-react';
import type { PageProps } from '../types';
import type { BusinessRecipe } from '../business-types';
import './business-launch.css';

export const BUSINESS_RECIPES: { id: BusinessRecipe; title: string; description: string; Icon: typeof Files }[] = [
  { id: 'merchant', title: '商家商品套餐', description: '商品原图与参数，一次做成一套上新素材。', Icon: ShoppingBag },
  { id: 'digital', title: '数字商品上架包', description: '把图纸、壁纸与素材，整理成能展示、能交付的商品。', Icon: PackageCheck },
  { id: 'documents', title: '客户资料套件', description: '确认一份资料，制作配套的 PPT、Word 与 Excel。', Icon: Files },
];
export function BusinessLaunchCards({ props, compact = false }: { props: Pick<PageProps, 'onOpenBusiness' | 'navigate'>; compact?: boolean }) {
  return <section className={`business-launch${compact ? ' is-compact' : ''}`} aria-label="选择业务制作套餐"><header><h2>按一套业务来制作</h2><span>资料只填一次，后续继续返修与复用</span></header><div>{BUSINESS_RECIPES.map(({ id, title, description, Icon }) => <button type="button" key={id} onClick={() => props.onOpenBusiness ? props.onOpenBusiness(id) : props.navigate('business')}><span className={`business-launch-icon is-${id}`}><Icon size={22} /></span><strong>{title}</strong><p>{description}</p><ArrowUpRight size={17} /></button>)}</div></section>;
}
