import type {
  AmoraPersonalizationFieldName,
  AmoraPersonalizationPreferences,
  AmoraPersonalizationProfile,
} from "@hanbang/shared/amora-personalization";

export declare const AMORA_PERSONALIZATION_PATH: "/api/amora/personalization";

export declare const AMORA_STYLE_COPY: Readonly<{
  title: string;
  eyebrow: string;
  introTitle: string;
  introBody: string;
  loading: string;
  loadFailed: string;
  loadUnsafe: string;
  retry: string;
  noSavedProfile: string;
  savedProfilePrefix: string;
  savedDateFallback: string;
  precedence: string;
  save: string;
  saving: string;
  saved: string;
  saveFailed: string;
  saveUnverified: string;
  resetTrigger: string;
  resetConfirmBody: string;
  resetConfirm: string;
  resetCancel: string;
  resetDone: string;
  resetFailed: string;
  resetUnverified: string;
}>;

export type AmoraPersonalizationSessionState = {
  ownerId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  profile: AmoraPersonalizationProfile | null;
  draft: AmoraPersonalizationPreferences | null;
  pending: "save" | "reset" | null;
  error: string | null;
  notice: string | null;
};

export type AmoraPersonalizationView = {
  selected: AmoraPersonalizationPreferences;
  dirty: boolean;
  showChoices: boolean;
  canSelect: boolean;
  canSave: boolean;
  showReset: boolean;
  canReset: boolean;
  savedLine: string;
  saveLabel: string;
};

export type AmoraStyleSectionView = {
  key: AmoraPersonalizationFieldName;
  title: string;
  description: string;
  choices: { value: string; label: string; description: string; selected: boolean }[];
};

export type AmoraPersonalizationSession = {
  getState(): AmoraPersonalizationSessionState;
  subscribe(listener: () => void): () => void;
  setOwner(ownerId: string | null): boolean;
  dispose(): void;
  load(options?: { refreshOwner?: boolean }): Promise<boolean>;
  select(key: string, value: unknown): boolean;
  save(): Promise<boolean>;
  captureReset(): { owner: string | null; epoch: number; revision: number } | null;
  reset(confirmation?: { owner: string | null; epoch: number; revision: number } | null): Promise<boolean>;
};

export declare function formatAmoraPersonalizationDate(value: unknown): string | null;
export declare function viewAmoraPersonalization(state: AmoraPersonalizationSessionState): AmoraPersonalizationView;
export declare function buildAmoraStyleSections(selected: AmoraPersonalizationPreferences): AmoraStyleSectionView[];
export declare function createAmoraPersonalizationSession(
  request: (ownerId: string, path: string, init: RequestInit) => Promise<Response>,
  options?: {
    initialOwnerId?: string | null;
    readSessionOwner?: () => Promise<string | null>;
    timeoutMs?: number;
  },
): AmoraPersonalizationSession;
