import { useCallback, useEffect, useRef, useState } from 'react';
import type { DialogDirectory, DialogEntry, FileDialogSeed, OverwriteRequest, StudioDialogBridge } from '../dialog-types';
import { dialogError, joinDialogPath } from '../lib/dialog-paths';

export function useFileDialog(bridge: StudioDialogBridge, seed: FileDialogSeed) {
  const [listing, setListing] = useState<DialogDirectory>();
  const [selected, setSelected] = useState<DialogEntry[]>([]), [filename, setFilename] = useState(seed.defaultFilename || '');
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [operation, setOperation] = useState(''), [search, setSearch] = useState('');
  const [history, setHistory] = useState({ paths: [seed.path], index: 0 });
  const [overwrite, setOverwrite] = useState<OverwriteRequest>();
  const [locations, setLocations] = useState(seed.locations), [locationWarning, setLocationWarning] = useState(seed.locationWarning || ''), [locationsLoading, setLocationsLoading] = useState(false);
  const locationAlive = useRef(true), locationRequest = useRef<Promise<void> | undefined>(undefined), lastLocationFocus = useRef(Date.now());
  const current = useRef({ listing, history, search }); current.current = { listing, history, search };
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const browseTarget = useRef(seed.path);
  const busy = operation || (loading ? 'browse' : '');
  const epoch = useRef(0), queryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), action = useRef(false);
  const load = useCallback(async (path: string, query = '', page = 0, historyIndex?: number) => {
    const generation = ++epoch.current; browseTarget.current = path; setLoading(true); setError('');
    try {
      const result = await bridge.list({ path, search: query, page, pageSize: 100 });
      if (generation !== epoch.current) return false;
      browseTarget.current = result.path; setListing(result); selectedRef.current = []; setSelected([]); if (seed.mode === 'open' && !seed.directoryOnly) setFilename('');
      setHistory(previous => historyIndex !== undefined ? { ...previous, index: historyIndex } : previous.paths[previous.index] === result.path ? previous : { paths: [...previous.paths.slice(0, previous.index + 1), result.path], index: previous.index + 1 });
      return true;
    } catch (cause) { if (generation === epoch.current) { browseTarget.current = current.current.listing?.path || seed.path; setError(dialogError(cause)); } return false; }
    finally { if (generation === epoch.current) setLoading(false); }
  }, [bridge, seed.mode, seed.directoryOnly, seed.path]);
  useEffect(() => { void load(seed.path); return () => { epoch.current++; clearTimeout(queryTimer.current); }; }, [load, seed.path]);
  useEffect(() => { locationAlive.current = true; return () => { locationAlive.current = false; }; }, []);
  const refreshLocations = useCallback((force = false) => {
    if (locationRequest.current) return locationRequest.current;
    setLocationsLoading(true);
    const request = Promise.resolve().then(() => bridge.refreshLocations({ force })).then(result => {
      if (!locationAlive.current) return;
      setLocations(result.locations); setLocationWarning(result.warning || '');
    }).catch(cause => {
      if (locationAlive.current) setLocationWarning(`磁盘列表未能更新：${dialogError(cause)} 可点击刷新重试。`);
    }).finally(() => {
      if (locationAlive.current) setLocationsLoading(false);
      locationRequest.current = undefined;
    });
    locationRequest.current = request; return request;
  }, [bridge]);
  useEffect(() => { if (seed.locationsPending) void refreshLocations(); }, [seed.locationsPending, refreshLocations]);
  useEffect(() => {
    const focus = (event: FocusEvent) => {
      if (event.target !== window || Date.now() - lastLocationFocus.current < 15000) return;
      lastLocationFocus.current = Date.now(); void refreshLocations();
    };
    window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus);
  }, [refreshLocations]);
  function navigate(path: string, historyIndex?: number) { clearTimeout(queryTimer.current); setSearch(''); void load(path, '', 0, historyIndex); }
  function searchDirectory(value: string) {
    setSearch(value); clearTimeout(queryTimer.current);
    queryTimer.current = setTimeout(() => { void load(browseTarget.current, value); }, 180);
  }
  function select(entry: DialogEntry, additive = false, range?: DialogEntry[]) {
    if (entry.kind === 'link') return;
    const previous = selectedRef.current, files = range || [entry];
    const base = additive ? previous.filter(item => item.kind === 'file') : [];
    const next = !seed.multiSelections || entry.kind !== 'file' ? [entry] : range ? [...new Map([...base, ...files.filter(item => item.kind === 'file')].map(item => [item.path, item])).values()] : additive && base.some(item => item.path === entry.path) ? base.filter(item => item.path !== entry.path) : [...base, entry];
    if (next.length > (seed.maxSelections || 20)) { setError(`每次最多选择 ${seed.maxSelections || 20} 个文件。`); return; }
    selectedRef.current = next; setSelected(next); setError('');
    if (entry.kind === 'file') setFilename(entry.name);
  }
  async function createFolder(name: string) {
    if (action.current || !listing) return undefined;
    action.current = true; setOperation('create'); setError('');
    try { const result = await bridge.createFolder({ path: listing.path, name }); if (!await load(result.path)) return undefined; return { name, path: result.path, kind: 'directory' as const }; }
    catch (cause) { setError(dialogError(cause)); return undefined; }
    finally { action.current = false; setOperation(''); }
  }
  async function accept(override?: DialogEntry) {
    if (action.current || !listing) return;
    const choice = override ? [override] : selected;
    if (!seed.directoryOnly && choice.length === 1 && choice[0].kind === 'directory') { navigate(choice[0].path); return; }
    action.current = true; setOperation('accept'); setError('');
    try {
      const result = await bridge.accept(seed.mode === 'save' ? { directory: listing.path, filename, ...(overwrite ? { overwriteToken: overwrite.token } : {}) } : seed.directoryOnly ? { directory: choice[0]?.path || listing.path } : { paths: choice.length ? choice.map(item => item.path) : filename.trim() ? [joinDialogPath(listing.path, filename.trim())] : [] });
      if ('overwriteRequired' in result) { setOverwrite(result); setOperation(''); }
    } catch (cause) { setError(dialogError(cause)); setOverwrite(undefined); setOperation(''); }
    finally { action.current = false; }
  }
  const folderSelected = !seed.directoryOnly && selected.length === 1 && selected[0].kind === 'directory';
  return { listing, selected, filename, setFilename, error, setError, busy, loading, search, history, overwrite, locations, locationWarning, locationsLoading, refreshLocations,
    navigate, searchDirectory, select, createFolder, accept,
    clearSelection: () => { selectedRef.current = []; setSelected([]); setFilename(seed.defaultFilename || ''); },
    dismissOverwrite: () => { setOverwrite(undefined); setError(''); },
    back: () => { const value = current.current.history; if (value.index > 0) navigate(value.paths[value.index - 1], value.index - 1); },
    up: () => { if (listing?.parentPath) navigate(listing.parentPath); },
    reload: () => { if (listing) void load(listing.path, search, listing.page); void refreshLocations(true); },
    page: (value: number) => { if (listing) void load(listing.path, search, value); },
    target: seed.directoryOnly ? selected[0]?.path || listing?.path || seed.path : seed.mode === 'save' ? joinDialogPath(listing?.path || seed.path, filename) : selected.length > 1 ? `已选择 ${selected.length} 个文件` : selected[0]?.path || filename || '请选择文件',
    actionLabel: folderSelected ? '打开文件夹' : seed.buttonLabel,
    canAccept: !!listing && !busy && (seed.directoryOnly || folderSelected || !!filename.trim() || selected.length > 0),
  };
}
