/**
 * Push registration is an external-notification side effect. Keep it disabled
 * unless the release environment opts in with the exact public value `true`.
 */
export function isPushRegistrationEnabled(value) {
  return value === "true";
}
