import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MOBILE_WEB_API_PROTOCOL,
  MOBILE_WEB_API_NONCE_PROPERTY,
  mobileAuthenticatedFetch,
} from "./mobileAuthenticatedFetch";

const BRIDGE_NONCE = "22222222-2222-4222-8222-222222222222";

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage(message: string): void;
    };
    __HANBANG_MOBILE_API_NONCE__?: string;
  }
}

afterEach(() => {
  delete window.ReactNativeWebView;
  delete window.__HANBANG_MOBILE_API_NONCE__;
  vi.restoreAllMocks();
});

describe("mobileAuthenticatedFetch", () => {
  it("delegates ordinary browser requests to fetch", async () => {
    const response = new Response('{"vendorIds":[]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    await expect(mobileAuthenticatedFetch("/api/favorites", { cache: "no-store" }))
      .resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledWith("/api/favorites", { cache: "no-store" });
  });

  it("uses the native authenticated bridge without exposing an access token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"));
    const postMessage = vi.fn((raw: string) => {
      const request = JSON.parse(raw) as {
        protocol: string;
        nonce: string;
        documentUrl: string;
        id: string;
        path: string;
        method: string;
        headers: Record<string, string>;
      };
      expect(request).toMatchObject({
        protocol: MOBILE_WEB_API_PROTOCOL,
        nonce: BRIDGE_NONCE,
        documentUrl: window.location.href,
        path: "/api/favorites",
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      expect(raw.toLowerCase()).not.toContain("authorization");
      expect(raw.toLowerCase()).not.toContain("access_token");

      queueMicrotask(() => {
        window.dispatchEvent(new CustomEvent("hanbang-mobile-api-response", {
          detail: {
            protocol: MOBILE_WEB_API_PROTOCOL,
            nonce: request.nonce,
            id: request.id,
            status: 200,
            contentType: "application/json",
            body: '{"isFavorite":true}',
          },
        }));
      });
    });
    window.ReactNativeWebView = { postMessage };
    window[MOBILE_WEB_API_NONCE_PROPERTY] = BRIDGE_NONCE;

    const response = await mobileAuthenticatedFetch("/api/favorites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vendorId: "11111111-1111-4111-8111-111111111111" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ isFavorite: true });
    expect(postMessage).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-allowlisted bridge paths instead of silently forwarding them", async () => {
    window.ReactNativeWebView = { postMessage: vi.fn() };
    window[MOBILE_WEB_API_NONCE_PROPERTY] = BRIDGE_NONCE;

    await expect(mobileAuthenticatedFetch("/api/auth/delete", { method: "POST" }))
      .rejects.toThrow("not allowed");
    expect(window.ReactNativeWebView.postMessage).not.toHaveBeenCalled();
  });

  it("fails closed when Android exposes the bridge without a main-frame nonce", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"));
    window.ReactNativeWebView = { postMessage: vi.fn() };

    await expect(mobileAuthenticatedFetch("/api/favorites"))
      .rejects.toThrow("nonce is unavailable");
    expect(window.ReactNativeWebView.postMessage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores a response carrying a different WebView nonce", async () => {
    const abort = new AbortController();
    const postMessage = vi.fn((raw: string) => {
      const request = JSON.parse(raw) as { id: string };
      queueMicrotask(() => {
        window.dispatchEvent(new CustomEvent("hanbang-mobile-api-response", {
          detail: {
            protocol: MOBILE_WEB_API_PROTOCOL,
            nonce: "33333333-3333-4333-8333-333333333333",
            id: request.id,
            status: 200,
            contentType: "application/json",
            body: '{"forged":true}',
          },
        }));
        abort.abort(new DOMException("test complete", "AbortError"));
      });
    });
    window.ReactNativeWebView = { postMessage };
    window[MOBILE_WEB_API_NONCE_PROPERTY] = BRIDGE_NONCE;

    await expect(mobileAuthenticatedFetch("/api/favorites", { signal: abort.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("constructs bodyless HTTP responses without throwing in the event listener", async () => {
    window.ReactNativeWebView = {
      postMessage(raw: string) {
        const request = JSON.parse(raw) as { id: string; nonce: string };
        queueMicrotask(() => window.dispatchEvent(new CustomEvent("hanbang-mobile-api-response", {
          detail: {
            protocol: MOBILE_WEB_API_PROTOCOL,
            nonce: request.nonce,
            id: request.id,
            status: 204,
            contentType: "application/json",
            body: "",
          },
        })));
      },
    };
    window[MOBILE_WEB_API_NONCE_PROPERTY] = BRIDGE_NONCE;

    const response = await mobileAuthenticatedFetch("/api/favorites");
    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
  });
});
