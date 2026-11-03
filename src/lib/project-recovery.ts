import type { NewProjectDraft } from '../components/NewProjectDialog';
import type { ProjectFolderSelection } from '../workspace-types';

export type RecoveryProjectFields = Omit<NewProjectDraft, 'selection'>;
export function recoverProjectDraft(context: Pick<NewProjectDraft, 'kind' | 'promptIntent'> & { draft?: RecoveryProjectFields }, selection: ProjectFolderSelection): NewProjectDraft {
  return {
    selection,
    kind: context.draft?.kind || context.kind,
    name: context.draft?.name ?? selection.name.slice(0, 50),
    description: context.draft?.description ?? context.promptIntent?.template.description ?? '',
    budget: context.draft?.budget ?? '',
    promptIntent: context.draft?.promptIntent || context.promptIntent,
  };
}
