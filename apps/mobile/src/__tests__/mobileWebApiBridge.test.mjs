/* global Response */

import assert from "node:assert/strict";
import test from "node:test";

import {
  MOBILE_WEB_API_PROTOCOL,
  MOBILE_WEB_API_RESPONSE_BYTES_HEADER,
  MAX_MOBILE_WEB_API_RESPONSE_BODY_BYTES,
  buildMobileWebApiUnauthorizedResponse,
  buildMobileWebApiResponseScript,
  createMobileWebApiAuthRedirectGate,
  createMobileWebApiRequestGate,
  createMobileWebApiSessionRefreshGate,
  fetchMobileWebApiWithSession,
  isMobileWebApiBridgeSourceUrl,
  parseMobileWebApiRequest,
  readMobileWebApiResponseBody,
  runMobileWebApiRequestWithTimeout,
} from "../lib/mobileWebApiBridge.mjs";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const NONCE = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_URL = "https://vendor-preview.example.com/price/studio?region=seoul#filters";

test("the native vendor bridge accepts only bounded allowlisted API requests", () => {
  assert.deepEqual(parseMobileWebApiRequest(JSON.stringify({
    protocol: MOBILE_WEB_API_PROTOCOL,
    nonce: NONCE,
    documentUrl: DOCUMENT_URL,
    id: REQUEST_ID,
    path: "/api/favorites",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vendorId: "22222222-2222-4222-8222-222222222222" }),
  }), NONCE, DOCUMENT_URL), {
    id: REQUEST_ID,
    path: "/api/favorites",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vendorId: "22222222-2222-4222-8222-222222222222" }),
  });

  for (const request of [
    { protocol: MOBILE_WEB_API_PROTOCOL, nonce: NONCE, id: REQUEST_ID, path: "/api/auth/delete", method: "POST" },
    { protocol: MOBILE_WEB_API_PROTOCOL, nonce: NONCE, id: REQUEST_ID, path: "https://evil.test/api/favorites", method: "GET" },
    { protocol: MOBILE_WEB_API_PROTOCOL, nonce: NONCE, id: REQUEST_ID, path: "/api/favorites", method: "PATCH" },
    { protocol: "other", nonce: NONCE, id: REQUEST_ID, path: "/api/favorites", method: "GET" },
    { protocol: MOBILE_WEB_API_PROTOCOL, nonce: NONCE, id: "not-uuid", path: "/api/favorites", method: "GET" },
    { protocol: MOBILE_WEB_API_PROTOCOL, nonce: "33333333-3333-4333-8333-333333333333", id: REQUEST_ID, path: "/api/favorites", method: "GET" },
  ]) {
    assert.equal(parseMobileWebApiRequest(JSON.stringify({
      documentUrl: DOCUMENT_URL,
      ...request,
    }), NONCE, DOCUMENT_URL), null);
  }
});

test("the native bridge binds each request to the message document", () => {
  const request = {
    protocol: MOBILE_WEB_API_PROTOCOL,
    nonce: NONCE,
    documentUrl: DOCUMENT_URL,
    id: REQUEST_ID,
    path: "/api/favorites",
    method: "GET",
  };
  assert.notEqual(parseMobileWebApiRequest(
    JSON.stringify(request),
    NONCE,
    "https://vendor-preview.example.com/price/studio?region=seoul",
  ), null);
  assert.equal(parseMobileWebApiRequest(
    JSON.stringify(request),
    NONCE,
    "https://vendor-preview.example.com/price/dress?region=seoul",
  ), null);
});

test("the native bridge enforces UTF-8 byte bounds rather than JavaScript character counts", () => {
  const oversizedBody = "가".repeat(Math.floor((64 * 1024) / 3) + 1);
  assert.equal(parseMobileWebApiRequest(JSON.stringify({
    protocol: MOBILE_WEB_API_PROTOCOL,
    nonce: NONCE,
    documentUrl: DOCUMENT_URL,
    id: REQUEST_ID,
    path: "/api/favorites",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: oversizedBody,
  }), NONCE, DOCUMENT_URL), null);
});

test("the native bridge accepts messages only from the public price main-document origin", () => {
  const origin = "https://vendor-preview.example.com";
  assert.equal(isMobileWebApiBridgeSourceUrl(`${origin}/price/vendor/sample`, origin), true);
  assert.equal(isMobileWebApiBridgeSourceUrl(`${origin}/wedding/vendors`, origin), false);
  assert.equal(isMobileWebApiBridgeSourceUrl("https://evil.example/price/vendor/sample", origin), false);
  assert.equal(isMobileWebApiBridgeSourceUrl(`${origin}.evil.example/price/vendor/sample`, origin), false);
});

test("the request gate rejects replay and fails closed at concurrency and lifetime caps", () => {
  const gate = createMobileWebApiRequestGate({ maxInflight: 2, maxRequests: 3 });
  assert.equal(gate.begin("a"), "accepted");
  assert.equal(gate.begin("a"), "replay");
  assert.equal(gate.begin("b"), "accepted");
  assert.equal(gate.begin("c"), "capacity");
  gate.finish("a");
  assert.equal(gate.begin("c"), "accepted");
  gate.finish("b");
  gate.finish("c");
  assert.equal(gate.begin("d"), "exhausted");
});

test("missing native sessions become a bounded 401 and claim one native login redirect", async () => {
  const response = buildMobileWebApiUnauthorizedResponse();
  assert.equal(response.status, 401);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
  assert.match(response.headers.get(MOBILE_WEB_API_RESPONSE_BYTES_HEADER) ?? "", /^[1-9][0-9]*$/);

  const gate = createMobileWebApiAuthRedirectGate();
  assert.equal(gate.claim(), true);
  assert.equal(gate.claim(), false);
});

test("a stale native session refreshes once before the bridge requires login", async () => {
  const usedTokens = [];
  let refreshes = 0;
  const response = await fetchMobileWebApiWithSession({
    initialSession: { userId: "user-a", accessToken: "stale-token" },
    async fetchWithAccessToken(token) {
      usedTokens.push(token);
      return new Response("{}", { status: token === "fresh-token" ? 200 : 401 });
    },
    async refreshSession() {
      refreshes += 1;
      return { userId: "user-a", accessToken: "fresh-token" };
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(usedTokens, ["stale-token", "fresh-token"]);
  assert.equal(refreshes, 1);

  const stillUnauthorizedTokens = [];
  const stillUnauthorized = await fetchMobileWebApiWithSession({
    initialSession: { userId: "user-a", accessToken: "stale-token" },
    async fetchWithAccessToken(token) {
      stillUnauthorizedTokens.push(token);
      return new Response("{}", { status: 401 });
    },
    async refreshSession() {
      return { userId: "user-a", accessToken: "also-stale-token" };
    },
  });
  assert.equal(stillUnauthorized.status, 401);
  assert.deepEqual(stillUnauthorizedTokens, ["stale-token", "also-stale-token"]);
});

test("an expired account A request never retries its body with account B credentials", async () => {
  const usedTokens = [];
  const response = await fetchMobileWebApiWithSession({
    initialSession: { userId: "user-a", accessToken: "expired-a" },
    async fetchWithAccessToken(token) {
      usedTokens.push(token);
      return new Response("{}", { status: 401 });
    },
    async refreshSession() {
      return { userId: "user-b", accessToken: "current-b" };
    },
  });

  assert.equal(response.status, 401);
  assert.match(response.headers.get(MOBILE_WEB_API_RESPONSE_BYTES_HEADER) ?? "", /^[1-9][0-9]*$/);
  assert.deepEqual(usedTokens, ["expired-a"]);
});

test("concurrent refreshes are shared only by the exact initial account session", async () => {
  const gate = createMobileWebApiSessionRefreshGate();
  let resolveRefresh;
  const pendingRefresh = new Promise((resolve) => {
    resolveRefresh = resolve;
  });
  let accountACalls = 0;
  let accountBCalls = 0;
  let newerAccountASessionCalls = 0;

  const accountA = { userId: "user-a", accessToken: "expired-a" };
  const first = gate.refresh(accountA, async () => {
    accountACalls += 1;
    return pendingRefresh;
  });
  const shared = gate.refresh(accountA, async () => {
    accountACalls += 1;
    return { userId: "user-a", accessToken: "should-not-run" };
  });
  const accountB = gate.refresh(
    { userId: "user-b", accessToken: "current-b" },
    async () => {
      accountBCalls += 1;
      return { userId: "user-b", accessToken: "refreshed-b" };
    },
  );
  const newerAccountASession = gate.refresh(
    { userId: "user-a", accessToken: "newer-a-session" },
    async () => {
      newerAccountASessionCalls += 1;
      return { userId: "user-a", accessToken: "refreshed-newer-a" };
    },
  );

  assert.equal(await accountB, null);
  assert.equal(await newerAccountASession, null);
  assert.equal(accountBCalls, 0);
  assert.equal(newerAccountASessionCalls, 0);
  resolveRefresh({ userId: "user-a", accessToken: "refreshed-a" });
  assert.deepEqual(await first, { userId: "user-a", accessToken: "refreshed-a" });
  assert.deepEqual(await shared, { userId: "user-a", accessToken: "refreshed-a" });
  assert.equal(accountACalls, 1);
});

test("the native bridge caps streamed and declared response bytes", async () => {
  const declaredTooLarge = new Response("small", {
    headers: { "content-length": String(MAX_MOBILE_WEB_API_RESPONSE_BODY_BYTES + 1) },
  });
  assert.deepEqual(await readMobileWebApiResponseBody(declaredTooLarge), {
    ok: false,
    reason: "content-length",
  });

  const multibyteBody = "가".repeat(Math.floor(MAX_MOBILE_WEB_API_RESPONSE_BODY_BYTES / 3) + 1);
  const streamedTooLarge = new Response(multibyteBody);
  assert.deepEqual(await readMobileWebApiResponseBody(streamedTooLarge), {
    ok: false,
    reason: "stream",
  });

  const bounded = new Response(JSON.stringify({ ok: true }));
  assert.deepEqual(await readMobileWebApiResponseBody(bounded), {
    ok: true,
    body: JSON.stringify({ ok: true }),
  });

  const mismatchedSourceBound = new Response("ok", {
    headers: { [MOBILE_WEB_API_RESPONSE_BYTES_HEADER]: "1" },
  });
  assert.deepEqual(await readMobileWebApiResponseBody(mismatchedSourceBound), {
    ok: false,
    reason: "response-bytes",
  });

  let readUndeclaredBody = false;
  const undeclaredNonStreamingResponse = {
    headers: { get: () => null },
    body: null,
    async text() {
      readUndeclaredBody = true;
      return "unbounded";
    },
  };
  assert.deepEqual(
    await readMobileWebApiResponseBody(undeclaredNonStreamingResponse),
    { ok: false, reason: "content-length-required" },
  );
  assert.equal(readUndeclaredBody, false);

  const customBoundedNonStreamingResponse = {
    headers: {
      get(name) {
        return name.toLowerCase() === MOBILE_WEB_API_RESPONSE_BYTES_HEADER ? "2" : null;
      },
    },
    body: null,
    async text() {
      return "ok";
    },
  };
  assert.deepEqual(
    await readMobileWebApiResponseBody(customBoundedNonStreamingResponse),
    { ok: true, body: "ok" },
  );

  const declaredNonStreamingResponse = {
    headers: { get: () => "2" },
    body: null,
    async text() {
      return "ok";
    },
  };
  assert.deepEqual(
    await readMobileWebApiResponseBody(declaredNonStreamingResponse),
    { ok: true, body: "ok" },
  );
});

test("the native bridge times out stalled requests and aborts their fetch signal", async () => {
  let signal;
  await assert.rejects(
    runMobileWebApiRequestWithTimeout((receivedSignal) => {
      signal = receivedSignal;
      return new Promise(() => undefined);
    }, 5),
    /MOBILE_WEB_API_REQUEST_TIMEOUT/,
  );
  assert.equal(signal.aborted, true);

  assert.equal(
    await runMobileWebApiRequestWithTimeout(() => Promise.resolve("ok"), 100),
    "ok",
  );
});

test("the native bridge response script treats API text as data, never JavaScript", () => {
  const script = buildMobileWebApiResponseScript({
    protocol: MOBILE_WEB_API_PROTOCOL,
    nonce: NONCE,
    id: REQUEST_ID,
    status: 200,
    body: "</script><script>globalThis.pwned=true</script>\u2028",
    contentType: "application/json",
  });

  assert.match(script, /hanbang-mobile-api-response/);
  assert.doesNotMatch(script, /<script>/);
  assert.doesNotMatch(script, /\u2028/u);
  assert.match(script, /true;$/);
});
