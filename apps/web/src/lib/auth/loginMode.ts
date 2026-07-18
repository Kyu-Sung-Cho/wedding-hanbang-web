export type LoginMode = "login" | "signup" | "forgot";

export function loginModeFromSearch(search: string): LoginMode {
  const value = new URLSearchParams(search).get("mode");
  return value === "signup" || value === "forgot" || value === "login"
    ? value
    : "login";
}
