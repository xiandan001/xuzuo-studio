import { useEffect, useRef, useState } from 'react';
import type { AssetLibraryBridge, StudioAsset } from '../asset-types';
import { workflowPublicError } from '../lib/studio-run';

const empty = new Map<string, boolean>();
export function useAssetAvailability(bridge: AssetLibraryBridge | undefined, workspaceId: string, ids: string[], revision: number, active = true) {
  const identity = `${workspaceId}:${revision}`, signature = ids.join('|');
  const known = useRef({ identity: '', values: new Map<string, boolean>() });
  const [state, setState] = useState({ identity: '', values: empty, error: '', errorSignature: '' });
  useEffect(() => {
    if (!active || !bridge?.probe) return;
    if (known.current.identity !== identity) known.current = { identity, values: new Map() };
    const missing = signature.split('|').filter(id => id && !known.current.values.has(id));
    if (!missing.length) return;
    let disposed = false;
    void (async () => {
      try {
        for (let offset = 0; offset < missing.length && !disposed; offset += 100) {
          const result = await bridge.probe!({ workspaceId, ids: missing.slice(offset, offset + 100) });
          if (disposed || known.current.identity !== identity) return;
          for (const item of result) known.current.values.set(item.id, item.unavailable);
          setState({ identity, values: new Map(known.current.values), error: '', errorSignature: signature });
        }
      } catch (cause) {
        if (!disposed && known.current.identity === identity) setState({ identity, values: new Map(known.current.values), error: workflowPublicError(cause, '素材状态暂时无法更新，请刷新素材后重试。'), errorSignature: signature });
      }
    })();
    return () => { disposed = true; };
  }, [active, bridge, identity, signature, workspaceId]);
  return { values: state.identity === identity ? state.values : empty, error: state.identity === identity && state.errorSignature === signature ? state.error : '' };
}

export function assetWithAvailability(asset: StudioAsset, values: ReadonlyMap<string, boolean>): StudioAsset {
  return values.has(asset.id) ? { ...asset, unavailable: values.get(asset.id) } : asset;
}
