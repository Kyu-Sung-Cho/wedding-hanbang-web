export interface ProfileAvatarEmoji {
  readonly emoji: string;
  readonly label: string;
}

export const PROFILE_AVATAR_EMOJIS: readonly ProfileAvatarEmoji[];

export function getProfileInitial(name: unknown): string;

export function isProfileAvatarEmoji(value: unknown): value is string;
