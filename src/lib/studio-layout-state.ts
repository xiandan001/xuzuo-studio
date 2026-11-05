import type { Project } from '../types';
import { readDisclosure, readStoredDisclosure, writeDisclosure } from './disclosure-state';
import { STUDIO_TOOLS } from './studio-commands';
import type { StudioTool } from './studio-commands';

export interface StudioIdentity { workspaceId: string; projectId: string; }
export interface StudioLayoutDefaults { leftOpen: boolean; rightOpen: boolean; }
const sections: Record<string, string[]> = {
  documents: ['account', 'illustrations', 'more-tools', 'custom-actions'],
  spreadsheet: ['account', 'more-tools', 'custom-actions', 'scope-tools', 'full-cell', 'formula-check', 'formula-issues', 'missing-inputs'],
  images: ['account', 'creation-settings', 'references', 'more-tools', 'source-description'],
};

export function studioPreferenceKey(scope: string, identity: StudioIdentity, name: string): string {
  return `studio:project:${encodeURIComponent(identity.workspaceId)}:${encodeURIComponent(identity.projectId)}:${encodeURIComponent(scope)}:${name}`;
}

const validTool = (value: unknown): value is StudioTool => STUDIO_TOOLS.includes(value as StudioTool);
export function readStudioLayout(scope: string, identity: StudioIdentity, defaults: StudioLayoutDefaults) {
  const key = (name: string) => studioPreferenceKey(scope, identity, name);
  const initialized = readDisclosure(key('initialized'), false);
  const legacyTool = readStoredDisclosure(`studio:${scope}:tool`);
  const storedTool = readStoredDisclosure(key('tool'));
  return {
    leftOpen: readDisclosure(key('navigation'), initialized ? defaults.leftOpen : readDisclosure(`studio:${scope}:navigation`, readDisclosure(`${scope}:files-visible`, defaults.leftOpen))),
    rightOpen: readDisclosure(key('panel-open'), initialized ? defaults.rightOpen : readDisclosure(`studio:${scope}:panel-open`, readDisclosure(`${scope}:tools-visible`, defaults.rightOpen))),
    focus: readDisclosure(key('focus'), initialized ? false : readDisclosure(`studio:${scope}:focus`, false)),
    tool: validTool(storedTool) ? storedTool : !initialized && validTool(legacyTool) ? legacyTool : 'ai' as StudioTool,
  };
}

function writeMissing(key: string, value: boolean | string) {
  const previous = readStoredDisclosure(key);
  if (typeof previous !== typeof value || typeof value === 'string' && !validTool(previous)) writeDisclosure(key, value);
}

/** Snapshot old family preferences once; scoped choices always take precedence. */
export function migrateStudioPreferences(scope: string, identity: StudioIdentity, defaults: StudioLayoutDefaults): void {
  const key = (name: string) => studioPreferenceKey(scope, identity, name);
  if (readDisclosure(key('initialized'), false)) return;
  const state = readStudioLayout(scope, identity, defaults);
  writeMissing(key('navigation'), state.leftOpen);
  writeMissing(key('panel-open'), state.rightOpen);
  writeMissing(key('focus'), state.focus);
  writeMissing(key('tool'), state.tool);
  for (const section of sections[scope] || []) {
    const legacyKey = `${scope}:${section}`, scopedKey = key(`section:${legacyKey}`);
    const previous = readStoredDisclosure(legacyKey);
    if (typeof previous === 'boolean') writeMissing(scopedKey, previous);
  }
  writeDisclosure(key('initialized'), true);
}

/** Call only after creation succeeds, before the new editor can mount. No workflow dispatch. */
export function initializeNewStudioProject(project: Pick<Project, 'id' | 'workspaceId' | 'kind'>): void {
  const scope = project.kind === 'image' ? 'images' : project.kind === 'excel' ? 'spreadsheet' : 'documents';
  const identity = { workspaceId: project.workspaceId, projectId: project.id };
  const key = (name: string) => studioPreferenceKey(scope, identity, name);
  if (readDisclosure(key('initialized'), false)) return;
  writeMissing(key('tool'), 'ai');
  writeMissing(key('panel-open'), true);
  writeMissing(key('focus'), false);
  writeDisclosure(key('initialized'), true);
}
