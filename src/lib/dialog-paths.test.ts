import { describe, expect, it } from 'vitest';
import { canCreateOriginalFolder, dialogBasename, dialogBreadcrumbs, dialogFileSize, dialogPathsEqual, isWorkspaceRootTarget, joinDialogPath } from './dialog-paths';
describe('custom dialog path presentation', () => {
  it('preserves POSIX case and literal backslashes on case-sensitive macOS volumes', () => {
    expect(dialogPathsEqual('/Volumes/Work/客户/', '/Volumes/Work/客户')).toBe(true);
    expect(isWorkspaceRootTarget('/Volumes/Work/客户', '/Volumes/work/客户')).toBe(false);
    expect(canCreateOriginalFolder('/Users/Alice', '/Users/alice/项目')).toBe(false);
    expect(canCreateOriginalFolder('/Users/alice', '/Users/alice/项目')).toBe(true);
    expect(canCreateOriginalFolder('/', '/项目')).toBe(true);
    expect(dialogPathsEqual('/', '///')).toBe(true);
    expect(dialogBreadcrumbs('/Users/alice/a\\b/作品')).toEqual([
      { name: '/', path: '/' }, { name: 'Users', path: '/Users' }, { name: 'alice', path: '/Users/alice' },
      { name: 'a\\b', path: '/Users/alice/a\\b' }, { name: '作品', path: '/Users/alice/a\\b/作品' },
    ]);
    expect(joinDialogPath('/Users/alice/a\\b', '作品.json')).toBe('/Users/alice/a\\b/作品.json');
    expect(dialogBasename('/Users/alice/a\\b')).toBe('a\\b');
    expect(dialogBasename('C:\\Users\\alice\\项目')).toBe('项目');
  });
  it('distinguishes the workspace target from its selected project child', () => {
    expect(isWorkspaceRootTarget('D:\\project\\shanye-001', 'd:/project/shanye-001/')).toBe(true);
    expect(isWorkspaceRootTarget('D:\\project\\shanye-001\\项目', 'D:/project/shanye-001')).toBe(false);
    expect(isWorkspaceRootTarget('D:/project/shanye-001-other', 'D:/project/shanye-001')).toBe(false);
    expect(isWorkspaceRootTarget('D:/project')).toBe(false);
  });
  it('only offers original-folder creation at the recorded parent, not another drive or inside the original', () => {
    expect(canCreateOriginalFolder('C:\\Users\\Administrator', 'C:\\Users\\Administrator\\Downloads')).toBe(true);
    expect(canCreateOriginalFolder('c:/users/administrator/', 'C:\\Users\\Administrator\\Downloads')).toBe(true);
    expect(canCreateOriginalFolder('D:\\project', 'C:\\Users\\Administrator\\Downloads')).toBe(false);
    expect(canCreateOriginalFolder('C:\\Users\\Administrator\\Downloads', 'C:\\Users\\Administrator\\Downloads')).toBe(false);
    expect(canCreateOriginalFolder('D:\\project')).toBe(true);
  });
  it('preserves absolute drive and shared roots while navigating nested folders', () => {
    expect(dialogBreadcrumbs('C:\\客户\\作品')).toEqual([{ name: 'C:\\', path: 'C:\\' }, { name: '客户', path: 'C:\\客户' }, { name: '作品', path: 'C:\\客户\\作品' }]);
    expect(dialogBreadcrumbs('\\\\server\\share\\项目')).toEqual([{ name: '\\\\server\\share\\', path: '\\\\server\\share\\' }, { name: '项目', path: '\\\\server\\share\\项目' }]);
    expect(dialogBreadcrumbs('/tmp/项目').at(-1)?.path).toBe('/tmp/项目');
  });
  it('keeps explicit absolute file input and uses the directory separator for filenames', () => {
    expect(joinDialogPath('C:\\客户', '交付.docx')).toBe('C:\\客户\\交付.docx');
    expect(joinDialogPath('C:/客户', 'D:/指定/交付.docx')).toBe('D:/指定/交付.docx');
    expect(joinDialogPath('/tmp', 'report.json')).toBe('/tmp/report.json');
    expect(dialogFileSize(1024)).toBe('1.0 KB'); expect(dialogFileSize(1024 * 1024)).toBe('1.0 MB');
  });
});
