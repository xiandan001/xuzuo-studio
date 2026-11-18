import type { NewProjectDraft } from '../components/NewProjectDialog';

export type RecoveryProjectFields = Omit<NewProjectDraft, 'selection'>;
export function recoverProjectDraft(context: Pick<NewProjectDraft, 'kind' | 'promptIntent'> & { draft?: RecoveryProjectFields }, selection: NewProjectDraft['selection']): NewProjectDraft {
  return {
    selection,
    kind: context.draft?.kind || context.kind,
    name: context.draft?.name ?? selection.name.slice(0, 50),
    description: context.draft?.description ?? context.promptIntent?.template.description ?? '',
    budget: context.draft?.budget ?? '',
    promptIntent: context.draft?.promptIntent || context.promptIntent,
  };
}
