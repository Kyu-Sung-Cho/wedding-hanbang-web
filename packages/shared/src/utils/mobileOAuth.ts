const DEFAULT_APP_CALLBACK_URL = "hanbang://auth/callback";

export function extractMobileOAuthAuthorizationCode(callbackUrl: string): string {
  const callback = new URL(callbackUrl);
  const fragment = new URLSearchParams(callback.hash.replace(/^#/, ""));

  if (
    callback.searchParams.has("access_token")
    || callback.searchParams.has("refresh_token")
    || fragment.has("access_token")
    || fragment.has("refresh_token")
  ) {
    throw new Error("OAuth session tokens must not be transported in callback URLs");
  }

  const code = callback.searchParams.get("code")?.trim();

  if (!code) {
    throw new Error("OAuth authorization code is missing");
  }

  return code;
}

export function buildMobileOAuthAppCallbackUrl(
  callbackUrl: string,
  appCallbackUrl = DEFAULT_APP_CALLBACK_URL,
): string {
  const code = extractMobileOAuthAuthorizationCode(callbackUrl);

  const appCallback = new URL(appCallbackUrl);
  appCallback.search = new URLSearchParams({ code }).toString();
  appCallback.hash = "";
  return appCallback.toString();
}
