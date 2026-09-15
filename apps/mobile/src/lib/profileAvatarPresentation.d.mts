export type ProfileAvatarKind = "initial" | "emoji" | "photo";

export type ProfileAvatarDisplay =
  | { kind: "initial"; initial: string }
  | { kind: "emoji"; emoji: string }
  | { kind: "photo"; path: string; initial: string };

export interface ProfileAvatarState {
  avatar_url: string | null;
  revision: string | null;
}

export interface ProfileAvatarPhotoUpload {
  uri: string;
  name: string;
  type: "image/jpeg" | "image/png" | "image/webp";
}

export declare const PROFILE_AVATAR_MAX_PHOTO_BYTES: number;
export declare const PROFILE_AVATAR_PHOTO_TYPES: readonly string[];

export declare function parseProfileAvatarUrl(value: unknown, ownerId: unknown): string | null;

export declare function profileAvatarDisplay(input: {
  name: string | null | undefined;
  avatarUrl: string | null | undefined;
  ownerId: string | null | undefined;
}): ProfileAvatarDisplay;

export declare function parseProfileAvatarResponse(
  value: unknown,
  ownerId: string,
  requireRevision?: boolean,
): ProfileAvatarState | null;

export declare function profileAvatarKind(avatarUrl: string | null | undefined): ProfileAvatarKind;

export declare function buildProfileAvatarJsonBody(input: {
  kind: "initial" | "emoji";
  emoji?: string | null;
  expectedRevision: string | null;
  ownerId: string;
}): Record<string, string | null>;

export declare function isSavedProfileAvatarSelection(
  selection: { kind: ProfileAvatarKind; emoji?: string | null },
  saved: ProfileAvatarState | null,
): boolean;

export declare function readProfileAvatarPhotoAsset(
  asset: unknown,
): { ok: true; photo: ProfileAvatarPhotoUpload } | { ok: false; message: string };

export declare function profileAvatarSaveErrorMessage(code: unknown): string;

export declare const PROFILE_AVATAR_REFRESHED_MESSAGE: string;
export declare const PROFILE_AVATAR_DISPLAY_READ_TIMEOUT_MS: number;

export type ProfileAvatarDisplayRead =
  | { ok: true; avatarUrl: string | null; revision: string | null }
  | { ok: false };

export declare function readProfileAvatarForDisplay(
  ownerId: string,
  request: (signal: AbortSignal) => Promise<Response>,
  timeoutMs?: number,
): Promise<ProfileAvatarDisplayRead>;

export type ProfileAvatarSaveOutcome =
  | { type: "saved"; avatarUrl: string | null; revision: string | null }
  | { type: "refreshed"; avatarUrl: string | null; revision: string | null; message: string }
  | { type: "failed"; message: string };

export declare function saveProfileAvatarSelection(input: {
  selection: { kind: ProfileAvatarKind; emoji?: string | null };
  expectedRevision: string | null;
  ownerId: string;
  send: () => Promise<Response>;
  reread: () => Promise<ProfileAvatarDisplayRead>;
}): Promise<ProfileAvatarSaveOutcome>;
