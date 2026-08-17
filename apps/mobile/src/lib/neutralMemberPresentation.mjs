export function resolvePreparationMemberPresentation({
  memberModelVersion,
  compatibilityRole,
}) {
  if (memberModelVersion === 2) {
    if (compatibilityRole !== "bride" && compatibilityRole !== "groom") return null;
    return Object.freeze({
      fieldLabel: "준비 공간",
      valueLabel: "구성원",
    });
  }
  if (memberModelVersion !== 1) return null;
  if (compatibilityRole === "bride") {
    return Object.freeze({ fieldLabel: "역할", valueLabel: "신부" });
  }
  if (compatibilityRole === "groom") {
    return Object.freeze({ fieldLabel: "역할", valueLabel: "신랑" });
  }
  return null;
}
