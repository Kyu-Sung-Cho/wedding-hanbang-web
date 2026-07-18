export const TURNSTILE_TOKEN_MAX_LENGTH = 2_048;
export const TURNSTILE_TOKEN_MIN_LENGTH = 20;
export const TURNSTILE_BASE_ORIGIN = "https://hanbang.ai";

const TURNSTILE_TOKEN_PATTERN = /^[A-Za-z0-9._-]+$/;
const TURNSTILE_SITE_KEY_PATTERN = /^[A-Za-z0-9_-]{20,32}$/;
const TURNSTILE_ACTION_PATTERN = /^[a-z0-9_]{1,32}$/;
const TURNSTILE_BRIDGE_MAX_MESSAGE_LENGTH = 2_200;

export type TurnstileBridgeMessage =
  | { type: "ready" }
  | { type: "success"; token: string }
  | { type: "expired" }
  | { type: "error" };

export type MobileAuthMode = "signup" | "forgot";

export function isValidTurnstileToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= TURNSTILE_TOKEN_MIN_LENGTH &&
    value.length <= TURNSTILE_TOKEN_MAX_LENGTH &&
    TURNSTILE_TOKEN_PATTERN.test(value)
  );
}

export function parseTurnstileMessage(raw: string): TurnstileBridgeMessage | null {
  if (raw.length > TURNSTILE_BRIDGE_MAX_MESSAGE_LENGTH) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;

  if (message.type === "success") {
    return isValidTurnstileToken(message.token)
      ? { type: "success", token: message.token }
      : null;
  }
  if (message.type === "ready") return { type: "ready" };
  if (message.type === "expired") return { type: "expired" };
  if (message.type === "error") return { type: "error" };
  return null;
}

function serializeInlineScriptString(value: string): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

export function hasValidTurnstileSiteKey(value: unknown): value is string {
  return typeof value === "string" && TURNSTILE_SITE_KEY_PATTERN.test(value);
}

export function buildTurnstileHtml(siteKey: string, action: string): string | null {
  if (!hasValidTurnstileSiteKey(siteKey) || !TURNSTILE_ACTION_PATTERN.test(action)) {
    return null;
  }

  const safeSiteKey = serializeInlineScriptString(siteKey);
  const safeAction = serializeInlineScriptString(action);

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://challenges.cloudflare.com 'unsafe-inline'; connect-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://challenges.cloudflare.com" />
    <style>
      html, body { margin: 0; min-height: 100%; background: #fdfcfa; color: #1a1a1f; }
      body { display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
      #turnstile { min-height: 70px; }
    </style>
    <script>
      (function () {
        function post(type, token) {
          var payload = { type: type };
          if (typeof token === "string") payload.token = token;
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
        window.onTurnstileLoad = function () {
          try {
            window.turnstile.render("#turnstile", {
              sitekey: ${safeSiteKey},
              action: ${safeAction},
              theme: "light",
              retry: "never",
              callback: function (token) { post("success", token); },
              "expired-callback": function () { post("expired"); },
              "error-callback": function () { post("error"); return true; },
              "timeout-callback": function () { post("expired"); },
              "unsupported-callback": function () { post("error"); }
            });
            post("ready");
          } catch (_) {
            post("error");
          }
        };
      })();
    </script>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&amp;render=explicit" async defer></script>
  </head>
  <body>
    <main aria-label="사람인지 확인">
      <div id="turnstile"></div>
    </main>
  </body>
</html>`;
}

export function getTurnstileWebFallbackUrl(
  mode: MobileAuthMode,
  configuredSiteUrl: string | undefined,
): string {
  let origin = TURNSTILE_BASE_ORIGIN;
  try {
    const configured = new URL(configuredSiteUrl || TURNSTILE_BASE_ORIGIN);
    if (
      configured.origin === TURNSTILE_BASE_ORIGIN &&
      configured.username === "" &&
      configured.password === ""
    ) {
      origin = configured.origin;
    }
  } catch {
    // 잘못된 빌드 환경 변수는 신뢰하지 않고 고정 운영 origin으로 닫는다.
  }

  const fallback = new URL("/login", origin);
  fallback.searchParams.set("mode", mode);
  return fallback.toString();
}

export function isAllowedTurnstileNavigation(url: string): boolean {
  if (url === "about:blank" || url === "about:srcdoc") return true;

  try {
    const candidate = new URL(url);
    if (candidate.username || candidate.password) return false;
    return (
      candidate.protocol === "https:" &&
      (candidate.origin === TURNSTILE_BASE_ORIGIN ||
        candidate.origin === "https://challenges.cloudflare.com")
    );
  } catch {
    return false;
  }
}
