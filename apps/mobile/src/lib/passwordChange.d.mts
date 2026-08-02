export interface PasswordChangeAuthBoundary {
  reauthenticate(): Promise<{ error: unknown | null }>;
  updateUser(attributes: {
    current_password: string;
    password: string;
    nonce: string;
  }): Promise<{ error: unknown | null }>;
}

export interface ChangePasswordInput {
  auth: PasswordChangeAuthBoundary;
  currentPassword: string;
  newPassword: string;
  reauthenticationCode: string;
  signOutAllSessions: () => Promise<void>;
}

export declare function isValidPasswordReauthenticationCode(value: unknown): boolean;

export declare function requestPasswordChangeReauthentication(
  auth: PasswordChangeAuthBoundary,
): Promise<void>;

export declare function changePasswordAndRevokeSessions(
  input: ChangePasswordInput,
): Promise<void>;
