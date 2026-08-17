export type PreparationMemberPresentation = Readonly<{
  fieldLabel: "역할" | "준비 공간";
  valueLabel: "신부" | "신랑" | "구성원";
}>;

export function resolvePreparationMemberPresentation(input: {
  memberModelVersion: 1 | 2 | null;
  compatibilityRole: "bride" | "groom" | null;
}): PreparationMemberPresentation | null;
