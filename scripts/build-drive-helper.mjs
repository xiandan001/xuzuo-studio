import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'scripts/native/windows-drive-info.cs');
const target = path.join(root, 'assets/windows-drive-info.exe');
const cacheFile = path.join(root, 'work/windows-drive-helper-build.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
if (process.platform !== 'win32') throw new Error('Windows 磁盘助手必须在 Windows 上构建，不能省略此发布资源。');
const framework = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET');
const compiler = ['Framework64', 'Framework'].map(name => path.join(framework, name, 'v4.0.30319/csc.exe')).find(file => fs.existsSync(file));
if (!compiler) throw new Error('未找到 Windows .NET Framework C# 编译器，无法生成磁盘助手，请安装或修复 .NET Framework。');
const flags = ['/nologo', '/noconfig', '/target:winexe', '/optimize+', '/platform:anycpu', '/utf8output'];
const signature = sha256(Buffer.concat([fs.readFileSync(source), Buffer.from(JSON.stringify({ compiler, modified: fs.statSync(compiler).mtimeMs, flags }))]));
let cached;
try { cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { /* A missing build cache is rebuilt from source. */ }
if (cached?.signature === signature && fs.existsSync(target) && sha256(fs.readFileSync(target)) === cached.sha256) {
  console.log(`Windows drive helper unchanged (${cached.sha256.slice(0, 12)}).`);
} else {
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(root, `work/windows-drive-info-${process.pid}.exe`);
  try {
    execFileSync(compiler, [...flags, `/out:${temporary}`, source], { windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 262144 });
    const binary = fs.readFileSync(temporary);
    if (binary.subarray(0, 2).toString() !== 'MZ') throw new Error('磁盘助手构建结果无效。');
    fs.renameSync(temporary, target);
    const sha = sha256(binary);
    fs.writeFileSync(cacheFile, JSON.stringify({ version: 1, signature, sha256: sha, bytes: binary.length }, null, 2) + '\n', 'utf8');
    console.log(`Built Windows drive helper (${binary.length} bytes, ${sha.slice(0, 12)}).`);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* Remove only this build's temporary helper. */ }
    throw new Error(`Windows 磁盘助手构建失败：${error.message}`, { cause: error });
  }
}
