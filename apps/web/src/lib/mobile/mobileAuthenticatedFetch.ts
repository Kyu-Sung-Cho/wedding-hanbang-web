export const MOBILE_WEB_API_PROTOCOL = "hanbang.mobile.api.v1";
export const MOBILE_WEB_API_NONCE_PROPERTY = "__HANBANG_MOBILE_API_NONCE__";

const RESPONSE_EVENT = "hanbang-mobile-api-response";
const RESPONSE_TIMEOUT_MS = 15_000;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const MAX_RESPONSE_BODY_BYTES = 256 * 1024;
const NONCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMBO_RESTORE_PATH_PATTERN = /^\/api\/price\/combos\?restore=[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_METHODS = new Map<string, ReadonlySet<string>>([
  ["/api/favorites", new Set(["GET", "POST", "DELETE"])],
  ["/api/price/combos", new Set(["GET", "POST"])],
  ["/api/price/alerts", new Set(["GET", "POST", "DELETE"])],
]);

type NativeBridge = {
  postMessage(message: string): void;
};

type NativeApiResponse = {
  protocol: typeof MOBILE_WEB_API_PROTOCOL;
  nonce: string;
  id: string;
  status: number;
  contentType: string;
  body: string;
};

declare global {
  interface Window {
    ReactNativeWebView?: NativeBridge;
    __HANBANG_MOBILE_API_NONCE__?: string;
  }
}

function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function normalizeBridgeRequest(input: RequestInfo | URL, init: RequestInit) {
  if (typeof input !== "string") {
    throw new Error("Mobile authenticated API bridge only accepts relative string paths");
  }

  const method = (init.method ?? "GET").toUpperCase();
  const methods = ALLOWED_METHODS.get(input);
  const isComboRestore = method === "GET" && COMBO_RESTORE_PATH_PATTERN.test(input);
  if (!methods?.has(method) && !isComboRestore) {
    throw new Error("Mobile authenticated API bridge request is not allowed");
  }

  const headers = new Headers(init.headers);
  const forwardedHeaders: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    const normalizedName = name.toLowerCase();
    if (normalizedName !== "content-type" && normalizedName !== "idempotency-key") {
      throw new Error(`Mobile authenticated API bridge header is not allowed: ${normalizedName}`);
    }
    forwardedHeaders[normalizedName] = value;
  }

  let body: string | undefined;
  if (init.body != null) {
    if (typeof init.body !== "string") {
      throw new Error("Mobile authenticated API bridge body must be a JSON string");
    }
    if (new TextEncoder().encode(init.body).byteLength > MAX_REQUEST_BODY_BYTES) {
      throw new Error("Mobile authenticated API bridge body is too large");
    }
    body = init.body;
  }

  if (method === "GET" && body !== undefined) {
    throw new Error("Mobile authenticated API bridge GET requests cannot include a body");
  }
  if (method !== "GET" && body === undefined) {
    throw new Error("Mobile authenticated API bridge mutation requires a body");
  }

  return { method, headers: forwardedHeaders, body };
}

function isNativeApiResponse(
  value: unknown,
  requestId: string,
  nonce: string,
): value is NativeApiResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<NativeApiResponse>;
  return response.protocol === MOBILE_WEB_API_PROTOCOL
    && response.nonce === nonce
    && response.id === requestId
    && Number.isInteger(response.status)
    && Number(response.status) >= 200
    && Number(response.status) <= 599
    && typeof response.contentType === "string"
    && response.contentType.length <= 256
    && typeof response.body === "string"
    && new TextEncoder().encode(response.body).byteLength <= MAX_RESPONSE_BODY_BYTES;
}

function nativeBridgeContext(): { bridge: NativeBridge; nonce: string } | null {
  if (typeof window === "undefined") return null;
  const bridge = window.ReactNativeWebView;
  if (!bridge) return null;

  // The native bridge object can be visible to subframes on Android. Only the
  // top document receives the cryptographic nonce injected by the native app.
  if (window.top !== window.self) {
    throw new Error("Mobile authenticated API bridge is unavailable in subframes");
  }
  const nonce = window[MOBILE_WEB_API_NONCE_PROPERTY];
  if (typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)) {
    throw new Error("Mobile authenticated API bridge nonce is unavailable");
  }
  return { bridge, nonce };
}

export async function mobileAuthenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const bridgeContext = nativeBridgeContext();
  if (!bridgeContext) return fetch(input, init);
  const { bridge, nonce } = bridgeContext;

  const request = normalizeBridgeRequest(input, init);
  const id = createRequestId();

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.removeEventListener(RESPONSE_EVENT, onResponse as EventListener);
      init.signal?.removeEventListener("abort", onAbort);
      clearTimeout(timeout);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onResponse = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isNativeApiResponse(detail, id, nonce)) return;
      finish(() => {
        const body = [204, 205, 304].includes(detail.status)
          ? null
          : detail.body || null;
        resolve(new Response(body, {
          status: detail.status,
          headers: detail.contentType ? { "content-type": detail.contentType } : undefined,
        }));
      });
    };
    const onAbort = () => finish(() => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")));
    const timeout = setTimeout(() => {
      finish(() => reject(new Error("Mobile authenticated API bridge timed out")));
    }, RESPONSE_TIMEOUT_MS);

    window.addEventListener(RESPONSE_EVENT, onResponse as EventListener);
    init.signal?.addEventListener("abort", onAbort, { once: true });
    if (init.signal?.aborted) {
      onAbort();
      return;
    }

    try {
      bridge.postMessage(JSON.stringify({
        protocol: MOBILE_WEB_API_PROTOCOL,
        nonce,
        documentUrl: window.location.href,
        id,
        path: input,
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
      }));
    } catch (error) {
      finish(() => reject(error));
    }
  });
}
