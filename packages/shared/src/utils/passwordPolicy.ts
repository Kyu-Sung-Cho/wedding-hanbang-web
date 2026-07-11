export interface PasswordPolicyChecks {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
}

export function checkPasswordPolicy(value: string): PasswordPolicyChecks {
  return {
    minLength: value.length >= 8,
    hasUppercase: /[A-Z]/.test(value),
    hasLowercase: /[a-z]/.test(value),
    hasNumber: /[0-9]/.test(value),
    hasSpecial: /[^A-Za-z0-9]/.test(value),
  };
}

export function isStrongPassword(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return Object.values(checkPasswordPolicy(value)).every(Boolean);
}
