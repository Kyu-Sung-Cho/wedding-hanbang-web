import assert from "node:assert/strict";
import test from "node:test";

import {
  ChatApiError,
  isTerminalAmoraChatError,
} from "../src/lib/chatApiError.ts";

test("rolling or future opt-in provider limits remain terminal", () => {
  assert.equal(
    isTerminalAmoraChatError(new ChatApiError("오늘 한도", 429, "couple_provider_daily")),
    true
  );
  assert.equal(
    isTerminalAmoraChatError(new ChatApiError("전체 한도", 429, "global_daily")),
    true
  );
  assert.equal(
    isTerminalAmoraChatError(new ChatApiError("이전 서버 한도", 429)),
    true
  );
  assert.equal(
    isTerminalAmoraChatError(new ChatApiError("스트림 안의 오늘 한도", 200, "couple_provider_daily")),
    true
  );
  assert.equal(
    isTerminalAmoraChatError(new ChatApiError("스트림 안의 전체 한도", 200, "global_daily")),
    true
  );
});

test("temporary provider and ledger failures remain retryable", () => {
  assert.equal(
    isTerminalAmoraChatError(new ChatApiError("잠시 후 다시", 503, "guard_unavailable")),
    false
  );
  assert.equal(isTerminalAmoraChatError(new Error("network")), false);
});
