export const AMORA_HIDDEN_INTERNAL_TEXT_NOTICE: string;
export function stripAmoraInternalArtifacts(text: string): string;
export function hasAmoraInternalArtifactPrefix(text: string): boolean;
export function getAmoraVisibleText(text: string, options?: { streaming?: boolean }): string;
