export const USER_PASSWORD_MIN_LENGTH: 8;
export const ADMIN_PASSWORD_MIN_LENGTH: 12;

export interface PasswordPolicyChecks {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
}

export function getPasswordPolicyChecks(
  value: unknown,
  minLength?: number,
): PasswordPolicyChecks;
export function satisfiesPasswordPolicy(value: string, minLength?: number): boolean;
export function satisfiesPasswordPolicy(value: unknown, minLength?: number): value is string;
export function isStrongUserPassword(value: string): boolean;
export function isStrongUserPassword(value: unknown): value is string;
export function isStrongAdminPassword(value: string): boolean;
export function isStrongAdminPassword(value: unknown): value is string;
