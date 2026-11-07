import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { RunReferenceRecovery } from './RunReferenceRecovery';

it('具名引用错误同时提供来源文件、只读刷新和返回工作台入口，不自动继续或收费', () => {
  const show = vi.fn(), refresh = vi.fn(), returnToStudio = vi.fn();
  const html = renderToStaticMarkup(<RunReferenceRecovery issue={{ sourceStepId: 'producer', artifactId: 'missing-picture', reason: 'missing' }} message={'引用文件“独立动画.gif”在磁盘上找不到。已有费用保留，本次未继续调用模型。'} onShowFiles={show} onRefreshFiles={refresh} onReturnToStudio={returnToStudio} />);
  expect(html).toContain('role="alert"'); expect(html).toContain('独立动画.gif'); expect(html).toContain('查看来源文件'); expect(html).toContain('刷新文件清单'); expect(html).toContain('返回工作台'); expect(html).toContain('刷新不会调用模型');
  expect(show).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled(); expect(returnToStudio).not.toHaveBeenCalled();
});
