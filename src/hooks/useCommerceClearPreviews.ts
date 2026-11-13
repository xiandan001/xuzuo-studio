import { useEffect, useRef, useState } from 'react';
import type { CommerceImagePreview, CommerceImagesBridge } from '../commerce-image-types';
import type { CommercePreviewPlan } from '../lib/commerce-viewport';

const MAX_BYTES = 12 * 1024 * 1024;
const bytes = (value: CommerceImagePreview) => value.dataUrl.length * 2;
function usable(value: CommerceImagePreview, plan: CommercePreviewPlan) {
  const a = value.crop, b = plan.region, tolerance = .000002;
  if (a.x > b.x + tolerance || a.y > b.y + tolerance || a.x + a.width < b.x + b.width - tolerance || a.y + a.height < b.y + b.height - tolerance) return false;
  const wanted = Math.min(1, plan.maxSide / Math.max(b.width * value.sourceWidth, b.height * value.sourceHeight), Math.sqrt(2000000 / (b.width * value.sourceWidth * b.height * value.sourceHeight)));
  return value.width / (a.width * value.sourceWidth) >= wanted * .95 && value.height / (a.height * value.sourceHeight) >= wanted * .95;
}
function valid(value: CommerceImagePreview, artifactId: string) {
  const crop = value?.crop;
  return value?.artifactId === artifactId && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.dataUrl || '') && value.dataUrl.length <= 6 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(value.sha256 || '') && [value.width, value.height, value.sourceWidth, value.sourceHeight].every(side => Number.isSafeInteger(side) && side > 0 && side <= 8192) && value.sourceWidth * value.sourceHeight <= 16000000 && value.width <= 2048 && value.height <= 2048 && value.width * value.height <= 2000000 && crop && [crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) && crop.x >= 0 && crop.y >= 0 && crop.x < 1 && crop.y < 1 && crop.width > 0 && crop.height > 0 && crop.x + crop.width <= 1.000001 && crop.y + crop.height <= 1.000001;
}
export function useCommerceClearPreviews({ projectId, scope, sourceId, sourceSha256, plans, bridge, enabled }: { projectId: string; scope: string; sourceId: string; sourceSha256: string; plans: CommercePreviewPlan[]; bridge?: CommerceImagesBridge; enabled: boolean }) {
  const [tiles, setTiles] = useState<Record<string, CommerceImagePreview>>({}), [loading, setLoading] = useState(false), [issue, setIssue] = useState(''), [retry, setRetry] = useState(0);
  const cache = useRef(new Map<string, CommerceImagePreview>()), knownHashes = useRef(new Map<string, string>()), cacheBytes = useRef(0), currentScope = useRef(scope);
  const signature = JSON.stringify(plans.map(plan => ({ ...plan, region: Object.fromEntries(Object.entries(plan.region).map(([key, value]) => [key, Math.round(value * 100000) / 100000])) })));
  useEffect(() => {
    if (currentScope.current !== scope) { currentScope.current = scope; cache.current.clear(); knownHashes.current.clear(); cacheBytes.current = 0; setTiles({}); setIssue(''); }
    knownHashes.current.set(sourceId, sourceSha256);
    if (!enabled || !bridge?.preview || !plans.length) { setLoading(false); return; }
    let disposed = false, requestId: string | undefined;
    const available: Record<string, CommerceImagePreview> = {}, visible = new Set<CommerceImagePreview>(); let visibleBytes = 0;
    const findCached = (plan: CommercePreviewPlan) => { const found = [...cache.current.entries()].reverse().find(([, value]) => value.artifactId === plan.artifactId && usable(value, plan)); if (!found) return; cache.current.delete(found[0]); cache.current.set(found[0], found[1]); return found[1]; };
    const include = (plan: CommercePreviewPlan, value: CommerceImagePreview) => { const weight = visible.has(value) ? 0 : bytes(value); if (visibleBytes + weight > MAX_BYTES) return false; available[plan.tileId] = value; visible.add(value); visibleBytes += weight; return true; };
    for (const plan of plans) { const found = findCached(plan); if (found) include(plan, found); }
    setTiles({ ...available }); setIssue('');
    const timer = setTimeout(() => { void (async () => {
      setLoading(true);
      try {
        for (const plan of plans) {
          if (disposed || available[plan.tileId]) continue;
          const reused = findCached(plan); if (reused && include(plan, reused)) { setTiles({ ...available }); continue; }
          if (visibleBytes >= MAX_BYTES * .9) continue;
          requestId = crypto.randomUUID();
          const expectedSha256 = plan.artifactId === sourceId ? sourceSha256 : knownHashes.current.get(plan.artifactId);
          const value = await bridge.preview!({ artifactId: plan.artifactId, region: plan.region, maxSide: plan.maxSide, projectId, requestId, ...(expectedSha256 ? { expectedSha256 } : {}) });
          if (disposed) return;
          if (!valid(value, plan.artifactId) || expectedSha256 && expectedSha256 !== value.sha256) throw Error('清晰预览与原图来源不一致，请重新载入工程。');
          knownHashes.current.set(plan.artifactId, value.sha256); while (knownHashes.current.size > 64) knownHashes.current.delete(knownHashes.current.keys().next().value!);
          const weight = bytes(value); if (weight + visibleBytes > MAX_BYTES) continue;
          const key = `${value.artifactId}/${value.sha256}/${JSON.stringify(value.crop)}/${value.width}/${value.height}`, old = cache.current.get(key);
          if (old) { cacheBytes.current -= bytes(old); cache.current.delete(key); }
          while (cache.current.size >= 16 || cacheBytes.current + weight > MAX_BYTES) { const first = cache.current.keys().next().value; if (!first) break; cacheBytes.current -= bytes(cache.current.get(first)!); cache.current.delete(first); }
          cache.current.set(key, value); cacheBytes.current += weight; include(plan, value); setTiles({ ...available });
        }
      } catch (cause) { if (!disposed && !(cause instanceof Error && cause.name === 'AbortError')) setIssue(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '清晰预览暂未准备完成，原图和导出保持。'); }
      finally { requestId = undefined; if (!disposed) setLoading(false); }
    })(); }, 160);
    return () => { disposed = true; clearTimeout(timer); if (requestId) void bridge.cancelPreview?.({ projectId, requestId }).catch(() => undefined); };
  }, [projectId, scope, sourceId, sourceSha256, signature, bridge, enabled, retry]);
  return { tiles: currentScope.current === scope ? tiles : {}, loading, issue: currentScope.current === scope ? issue : '', retry: () => setRetry(value => value + 1) };
}
