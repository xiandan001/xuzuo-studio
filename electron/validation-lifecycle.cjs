const fs = require('node:fs');
const path = require('node:path');
const MARKER = '.xuzuo-validation-profile.json';
function readValidationOwner(directory) {
  try {
    const filename = path.join(directory, MARKER), stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return null;
    const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    if (value.version !== 1 || value.kind !== 'xuzuo-owned-validation' || !Number.isInteger(value.ownerPid) || value.ownerPid <= 0 || typeof value.directory !== 'string' || normalize(value.directory) !== normalize(directory)) return null;
    return { ownerPid: value.ownerPid, maxAgeMs: 600000 };
  } catch { return null; }
}
function startValidationLifecycle({ ownerPid, maxAgeMs = 600000, isAlive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } }, requestExit, forceExit, pollMs = 2000, closeTimeoutMs = 5000 }) {
  const started = Date.now(); let stopping = false, timeout;
  const timer = setInterval(() => {
    if (stopping || isAlive(ownerPid) && Date.now() - started < maxAgeMs) return;
    stopping = true; clearInterval(timer);
    timeout = setTimeout(forceExit, closeTimeoutMs); timeout.unref?.();
    Promise.resolve().then(requestExit).catch(() => undefined);
  }, pollMs);
  timer.unref?.();
  return () => { clearInterval(timer); clearTimeout(timeout); };
}
module.exports = { MARKER, readValidationOwner, startValidationLifecycle };
