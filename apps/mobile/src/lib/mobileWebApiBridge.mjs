/* global AbortController, Response, TextDecoder, URL, clearTimeout, setTimeout */

export const MOBILE_WEB_API_PROTOCOL = "hanbang.mobile.api.v1";
export const MOBILE_WEB_API_NONCE_PROPERTY = "__HANBANG_MOBILE_API_NONCE__";
export const MOBILE_WEB_API_RESPONSE_BYTES_HEADER = "x-hanbang-response-bytes";
export const MAX_MOBILE_WEB_API_REQUEST_BODY_BYTES = 64 * 1024;
export const MAX_MOBILE_WEB_API_RESPONSE_BODY_BYTES = 256 * 1024;
export const MAX_MOBILE_WEB_API_INFLIGHT_REQUESTS = 8;
export const MAX_MOBILE_WEB_API_REQUESTS_PER_WEBVIEW = 1024;
export const MOBILE_WEB_API_REQUEST_TIMEOUT_MS = 15_000;

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE_PATTERN = REQUEST_ID_PATTERN;
const COMBO_RESTORE_PATH_PATTERN = /^\/api\/price\/combos\?restore=[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// JSON escaping can make a valid 64 KiB request body several times larger than
// its decoded UTF-8 body. Bound the envelope independently before JSON.parse.
const MAX_MESSAGE_BYTES = (MAX_MOBILE_WEB_API_REQUEST_BODY_BYTES * 6) + (8 * 1024);
const ALLOWED_OPERATIONS = new Map([
  ["/api/favorites", new Set(["GET", "POST", "DELETE"])],
  ["/api/price/combos", new Set(["GET", "POST"])],
  ["/api/price/alerts", new Set(["GET", "POST", "DELETE"])],
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function utf8ByteLength(value) {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x7f) length += 1;
    else if (codePoint <= 0x7ff) length += 2;
    else if (codePoint <= 0xffff) length += 3;
    else length += 4;
  }
  return length;
}

function parseHeaders(value) {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const result = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== "string") return null;
    const name = rawName.toLowerCase();
    if (name === "content-type") {
      if (rawValue.toLowerCase() !== "application/json") return null;
      result[name] = "application/json";
      continue;
    }
    if (name === "idempotency-key") {
      if (!REQUEST_ID_PATTERN.test(rawValue)) return null;
      result[name] = rawValue.toLowerCase();
      continue;
    }
    return null;
  }
  return result;
}

function canonicalDocumentUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "") return null;
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export function parseMobileWebApiRequest(raw, expectedNonce, expectedDocumentUrl) {
  if (
    typeof raw !== "string"
    || utf8ByteLength(raw) > MAX_MESSAGE_BYTES
    || typeof expectedNonce !== "string"
    || !NONCE_PATTERN.test(expectedNonce)
  ) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.protocol !== MOBILE_WEB_API_PROTOCOL) return null;
  if (value.nonce !== expectedNonce) return null;
  const requestDocumentUrl = canonicalDocumentUrl(value.documentUrl);
  if (
    requestDocumentUrl === null
    || requestDocumentUrl !== canonicalDocumentUrl(expectedDocumentUrl)
  ) return null;
  if (typeof value.id !== "string" || !REQUEST_ID_PATTERN.test(value.id)) return null;
  if (typeof value.path !== "string") return null;
  const method = typeof value.method === "string" ? value.method.toUpperCase() : "";
  const isComboRestore = method === "GET" && COMBO_RESTORE_PATH_PATTERN.test(value.path);
  if (!ALLOWED_OPERATIONS.get(value.path)?.has(method) && !isComboRestore) return null;
  const headers = parseHeaders(value.headers);
  if (headers === null) return null;
  const body = value.body === undefined || value.body === null ? undefined : value.body;
  if (
    body !== undefined
    && (
      typeof body !== "string"
      || utf8ByteLength(body) > MAX_MOBILE_WEB_API_REQUEST_BODY_BYTES
    )
  ) return null;
  if ((method === "GET") !== (body === undefined)) return null;

  return {
    id: value.id.toLowerCase(),
    path: value.path,
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  };
}

export function isMobileWebApiBridgeSourceUrl(value, siteOrigin) {
  if (typeof value !== "string" || typeof siteOrigin !== "string") return false;
  try {
    const url = new URL(value);
    return url.origin === siteOrigin
      && url.username === ""
      && url.password === ""
      && (url.pathname === "/price" || url.pathname.startsWith("/price/"));
  } catch {
    return false;
  }
}

export function createMobileWebApiRequestGate({
  maxInflight = MAX_MOBILE_WEB_API_INFLIGHT_REQUESTS,
  maxRequests = MAX_MOBILE_WEB_API_REQUESTS_PER_WEBVIEW,
} = {}) {
  if (!Number.isSafeInteger(maxInflight) || maxInflight < 1) {
    throw new Error("MOBILE_WEB_API_INFLIGHT_LIMIT_INVALID");
  }
  if (!Number.isSafeInteger(maxRequests) || maxRequests < maxInflight) {
    throw new Error("MOBILE_WEB_API_REQUEST_LIMIT_INVALID");
  }

  const accepted = new Set();
  const inflight = new Set();
  return {
    begin(id) {
      if (accepted.has(id)) return "replay";
      if (accepted.size >= maxRequests) return "exhausted";
      if (inflight.size >= maxInflight) return "capacity";
      accepted.add(id);
      inflight.add(id);
      return "accepted";
    },
    finish(id) {
      inflight.delete(id);
    },
  };
}

export function createMobileWebApiAuthRedirectGate() {
  let claimed = false;
  return {
    claim() {
      if (claimed) return false;
      claimed = true;
      return true;
    },
  };
}

export function buildMobileWebApiUnauthorizedResponse() {
  const body = JSON.stringify({ error: "로그인이 필요합니다." });
  return new Response(body, {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8",
      [MOBILE_WEB_API_RESPONSE_BYTES_HEADER]: String(utf8ByteLength(body)),
    },
  });
}

function normalizeMobileWebApiSession(value) {
  if (!isRecord(value)) return null;
  const userId = value.userId;
  const accessToken = value.accessToken;
  if (
    typeof userId !== "string"
    || userId.length === 0
    || userId.length > 512
    || typeof accessToken !== "string"
    || accessToken.length === 0
    || accessToken.length > 64 * 1024
  ) return null;
  return { userId, accessToken };
}

export function createMobileWebApiSessionRefreshGate() {
  let active = null;
  return {
    refresh(initialSession, operation) {
      const expected = normalizeMobileWebApiSession(initialSession);
      if (!expected || typeof operation !== "function") {
        return Promise.resolve(null);
      }
      const key = JSON.stringify([expected.userId, expected.accessToken]);
      if (active) {
        return active.key === key ? active.promise : Promise.resolve(null);
      }

      const operationPromise = Promise.resolve()
        .then(operation)
        .then((result) => {
          const refreshed = normalizeMobileWebApiSession(result);
          return refreshed?.userId === expected.userId ? refreshed : null;
        })
        .catch(() => null);
      const guardedPromise = operationPromise.finally(() => {
        if (active?.promise === guardedPromise) active = null;
      });
      active = { key, promise: guardedPromise };
      return guardedPromise;
    },
  };
}

export async function fetchMobileWebApiWithSession({
  expectedUserId,
  initialSession,
  fetchWithAccessToken,
  refreshSession,
}) {
  if (typeof fetchWithAccessToken !== "function" || typeof refreshSession !== "function") {
    throw new Error("MOBILE_WEB_API_SESSION_FETCH_INVALID");
  }
  const initial = normalizeMobileWebApiSession(initialSession);
  if (
    expectedUserId !== undefined
    && (
      typeof expectedUserId !== "string"
      || expectedUserId.length === 0
      || initial?.userId !== expectedUserId
    )
  ) {
    throw new Error("MOBILE_WEB_API_SESSION_OWNER_MISMATCH");
  }
  if (!initial) {
    return buildMobileWebApiUnauthorizedResponse();
  }

  const initialResponse = await fetchWithAccessToken(initial.accessToken);
  if (initialResponse?.status !== 401) return initialResponse;

  let refreshed = null;
  try {
    refreshed = normalizeMobileWebApiSession(await refreshSession());
  } catch {
    return buildMobileWebApiUnauthorizedResponse();
  }
  if (
    !refreshed
    || refreshed.userId !== initial.userId
    || (expectedUserId !== undefined && refreshed.userId !== expectedUserId)
  ) {
    return buildMobileWebApiUnauthorizedResponse();
  }

  // One retry only. A second 401 is authoritative and must reach the native
  // login redirect instead of starting a refresh loop.
  return fetchWithAccessToken(refreshed.accessToken);
}

export async function runMobileWebApiRequestWithTimeout(
  operation,
  timeoutMs = MOBILE_WEB_API_REQUEST_TIMEOUT_MS,
) {
  if (typeof operation !== "function") {
    throw new Error("MOBILE_WEB_API_OPERATION_INVALID");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error("MOBILE_WEB_API_TIMEOUT_INVALID");
  }

  const controller = new AbortController();
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new Error("MOBILE_WEB_API_REQUEST_TIMEOUT"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      timeout,
    ]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function parseBoundedByteHeader(response, name) {
  const raw = response.headers?.get?.(name);
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) return { ok: false, value: null };
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return { ok: false, value: null };
  return { ok: value <= MAX_MOBILE_WEB_API_RESPONSE_BODY_BYTES, value };
}

async function decodeBoundedBytes(bytes) {
  if (typeof TextDecoder === "function") {
    return new TextDecoder("utf-8").decode(bytes);
  }
  return new Response(bytes).text();
}

export async function readMobileWebApiResponseBody(response) {
  const contentLength = parseBoundedByteHeader(response, "content-length");
  if (!contentLength.ok) return { ok: false, reason: "content-length" };
  const sourceBodyBytes = parseBoundedByteHeader(response, MOBILE_WEB_API_RESPONSE_BYTES_HEADER);
  if (!sourceBodyBytes.ok) return { ok: false, reason: "response-bytes" };

  const reader = response.body?.getReader?.();
  if (reader) {
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, reason: "stream" };
        }
        totalBytes += value.byteLength;
        if (totalBytes > MAX_MOBILE_WEB_API_RESPONSE_BODY_BYTES) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, reason: "stream" };
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock?.();
    }

    if (sourceBodyBytes.value !== null && sourceBodyBytes.value !== totalBytes) {
      return { ok: false, reason: "response-bytes" };
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, body: await decodeBoundedBytes(bytes) };
  }

  // Some React Native fetch implementations do not expose a ReadableStream.
  // Without a stream, reading an undeclared response would allocate the whole
  // body before the cap can be enforced. Fail closed unless the trusted origin
  // declares a bounded Content-Length, then verify the decoded size as well.
  if (contentLength.value === null && sourceBodyBytes.value === null) {
    return { ok: false, reason: "content-length-required" };
  }
  const body = await response.text();
  const actualBodyBytes = utf8ByteLength(body);
  if (
    actualBodyBytes > MAX_MOBILE_WEB_API_RESPONSE_BODY_BYTES
    || (sourceBodyBytes.value !== null && sourceBodyBytes.value !== actualBodyBytes)
  ) {
    return { ok: false, reason: "body" };
  }
  return { ok: true, body };
}

function safeJavaScriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function buildMobileWebApiResponseScript(response) {
  const payload = safeJavaScriptJson(response);
  return `window.dispatchEvent(new CustomEvent("hanbang-mobile-api-response",{detail:${payload}}));true;`;
}
