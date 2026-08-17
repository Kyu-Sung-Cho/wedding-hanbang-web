const LEGACY_OPTIONS = Object.freeze([
  Object.freeze({ value: "couple", label: "두 사람" }),
  Object.freeze({ value: "bride_parents", label: "예비 신부 가족" }),
  Object.freeze({ value: "groom_parents", label: "예비 신랑 가족" }),
  Object.freeze({ value: "both_parents", label: "두 가족" }),
]);

const NEUTRAL_OPTIONS_BY_VIEWER = Object.freeze({
  bride: Object.freeze([
    Object.freeze({ value: "couple", label: "두 사람" }),
    Object.freeze({ value: "bride_parents", label: "내 가족" }),
    Object.freeze({ value: "groom_parents", label: "파트너 가족" }),
    Object.freeze({ value: "both_parents", label: "두 가족" }),
  ]),
  groom: Object.freeze([
    Object.freeze({ value: "couple", label: "두 사람" }),
    Object.freeze({ value: "bride_parents", label: "파트너 가족" }),
    Object.freeze({ value: "groom_parents", label: "내 가족" }),
    Object.freeze({ value: "both_parents", label: "두 가족" }),
  ]),
});

export function resolveBudgetPayerOptions({ memberModelVersion, viewerRole }) {
  if (memberModelVersion === 1) return LEGACY_OPTIONS;
  if (memberModelVersion !== 2) return null;
  return NEUTRAL_OPTIONS_BY_VIEWER[viewerRole] ?? null;
}
