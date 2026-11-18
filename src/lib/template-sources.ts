import type { AnimationDocument } from '../animation-types';
export function animationTemplateSourceIds(document: Pick<AnimationDocument, 'entries'> | undefined) { return new Set(document?.entries.flatMap(entry => entry.frames.filter(frame => frame.templatePlaceholder).map(frame => frame.atlasArtifactId)) || []); }
