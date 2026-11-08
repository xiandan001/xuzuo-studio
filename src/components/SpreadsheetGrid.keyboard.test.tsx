// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptySpreadsheet } from '../lib/spreadsheet-ui';
import { SpreadsheetGrid } from './SpreadsheetGrid';

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('macOS spreadsheet keyboard navigation', () => {
  it('supports Command arrows and Command Shift selection, and leaves cell text editing alone', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(960);
    const select = vi.fn(), range = vi.fn(), fill = vi.fn();
    const sheet = { ...emptySpreadsheet('键盘测试').sheets[0], rowCount: 10, columnCount: 4 };
    function Fixture() {
      const [address, setAddress] = useState('B5');
      return <SpreadsheetGrid sheet={sheet} selectedAddress={address} onSelect={value => { select(value); setAddress(value); }} onRangeChange={range} onFillDown={fill} onCellInput={vi.fn()} onPasteBlock={vi.fn()} />;
    }
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => { root.render(<Fixture />); });
      const grid = host.querySelector('[role="grid"]')!;
      async function key(target: Element, key: string, shiftKey = false, metaKey = true) {
        let allowed = true;
        await act(async () => { allowed = target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, metaKey, bubbles: true, cancelable: true })); });
        return allowed;
      }
      expect(await key(grid, 'ArrowUp')).toBe(false); expect(select).toHaveBeenLastCalledWith('B1');
      expect(await key(grid, 'ArrowDown')).toBe(false); expect(select).toHaveBeenLastCalledWith('B10');
      expect(await key(grid, 'ArrowRight', true)).toBe(false); expect(range).toHaveBeenLastCalledWith('B10:D10');
      expect(await key(grid, 'ArrowLeft')).toBe(false); expect(select).toHaveBeenLastCalledWith('A10');
      expect(await key(grid, 'd')).toBe(false); expect(fill).toHaveBeenCalledOnce();
      await key(grid, 'Enter', false, false); const input = host.querySelector('textarea')!; expect(input).not.toBeNull();
      select.mockClear(); expect(await key(input, 'ArrowUp')).toBe(true); expect(select).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); }
  });
});
