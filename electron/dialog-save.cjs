const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { checkedDirectory } = require('./workspace-paths.cjs');

const SAVE_AUTHORITY = Symbol('studio-save-authority');
function authorizeSave(result, session) {
  Object.defineProperty(result, SAVE_AUTHORITY, { value: session }); return result;
}
async function assertSaveAuthority(result, destination) {
  const session = result?.[SAVE_AUTHORITY];
  if (!session || typeof destination !== 'string' || result.filePath !== destination) throw new Error('保存位置尚未确认，请重新选择文件。');
  await session.assertSaveTarget(destination);
}
async function writeDialogFile(result, bytes, fileSystem = fs) {
  if (result?.canceled || !result?.filePath) return { saved: false };
  const destination = result.filePath;
  await checkedDirectory(fileSystem, path.dirname(destination));
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await fileSystem.writeFile(temporary, bytes, { flag: 'wx' });
    await assertSaveAuthority(result, destination);
    await fileSystem.rename(temporary, destination);
  } catch (error) {
    await fileSystem.unlink(temporary).catch(() => undefined);
    const messages = { ENOSPC: '磁盘空间不足，请选择其他位置保存。', EACCES: '没有权限保存到此位置，请选择其他文件夹。', EPERM: '目标文件无法替换，请关闭正在使用它的程序或选择其他位置。', EBUSY: '目标文件正在使用，请关闭后重新保存。', ENOENT: '保存位置已不可用，请重新选择文件夹。' };
    if (messages[error.code]) throw Object.assign(new Error(messages[error.code]), { code: error.code, cause: error });
    throw error;
  }
  return { saved: true, path: destination };
}
module.exports = { authorizeSave, assertSaveAuthority, writeDialogFile };
