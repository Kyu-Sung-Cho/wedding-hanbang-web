import { rewriteMobileAppLink } from "@hanbang/shared";

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    return rewriteMobileAppLink(path);
  } catch {
    return "/";
  }
}
