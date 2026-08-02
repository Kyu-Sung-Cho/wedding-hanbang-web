export const USER_PASSWORD_MIN_LENGTH = 8;
export const ADMIN_PASSWORD_MIN_LENGTH = 12;

export function getPasswordPolicyChecks(value, minLength = USER_PASSWORD_MIN_LENGTH) {
  const password = typeof value === "string" ? value : "";
  return {
    minLength: password.length >= minLength,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: /[^A-Za-z0-9]/.test(password),
  };
}

export function satisfiesPasswordPolicy(value, minLength = USER_PASSWORD_MIN_LENGTH) {
  if (typeof value !== "string") return false;
  const checks = getPasswordPolicyChecks(value, minLength);
  return Object.values(checks).every(Boolean);
}

export function isStrongUserPassword(value) {
  return satisfiesPasswordPolicy(value, USER_PASSWORD_MIN_LENGTH);
}

export function isStrongAdminPassword(value) {
  return satisfiesPasswordPolicy(value, ADMIN_PASSWORD_MIN_LENGTH);
}
