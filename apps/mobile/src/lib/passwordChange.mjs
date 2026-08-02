import { isStrongUserPassword } from "@hanbang/shared/security/password-policy";

const REAUTHENTICATION_CODE_PATTERN = /^\d{6,10}$/;

function normalizedReauthenticationCode(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidPasswordReauthenticationCode(value) {
  return REAUTHENTICATION_CODE_PATTERN.test(normalizedReauthenticationCode(value));
}

export async function requestPasswordChangeReauthentication(auth) {
  if (!auth || typeof auth.reauthenticate !== "function") {
    throw new Error("PASSWORD_REAUTHENTICATION_BOUNDARY_INVALID");
  }

  const result = await auth.reauthenticate();
  if (!result || result.error) {
    throw new Error("PASSWORD_REAUTHENTICATION_FAILED");
  }
}

export async function changePasswordAndRevokeSessions({
  auth,
  currentPassword,
  newPassword,
  reauthenticationCode,
  signOutAllSessions,
}) {
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    throw new Error("CURRENT_PASSWORD_REQUIRED");
  }
  if (!isStrongUserPassword(newPassword)) {
    throw new Error("PASSWORD_POLICY_REJECTED");
  }

  const nonce = normalizedReauthenticationCode(reauthenticationCode);
  if (!isValidPasswordReauthenticationCode(nonce)) {
    throw new Error("PASSWORD_REAUTHENTICATION_CODE_INVALID");
  }
  if (!auth || typeof auth.updateUser !== "function") {
    throw new Error("PASSWORD_CHANGE_BOUNDARY_INVALID");
  }
  if (typeof signOutAllSessions !== "function") {
    throw new Error("PASSWORD_SIGN_OUT_BOUNDARY_INVALID");
  }

  const result = await auth.updateUser({
    current_password: currentPassword,
    password: newPassword,
    nonce,
  });
  if (!result || result.error) {
    throw new Error("PASSWORD_CHANGE_REJECTED");
  }

  try {
    await signOutAllSessions();
  } catch {
    throw new Error("PASSWORD_CHANGED_SIGN_OUT_FAILED");
  }
}
