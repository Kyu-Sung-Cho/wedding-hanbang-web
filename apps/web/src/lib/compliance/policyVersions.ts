export {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@hanbang/shared/constants";

export function formatPolicyVersionKorean(version: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(version);
  if (!match) {
    throw new Error("Invalid policy version");
  }

  return `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일`;
}
