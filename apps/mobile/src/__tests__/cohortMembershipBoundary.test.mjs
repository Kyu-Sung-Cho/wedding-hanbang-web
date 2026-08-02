import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";

const screenSource = readFileSync(
  new URL("../../app/community/cohort/[id].tsx", import.meta.url),
  "utf8",
);

function loadMessagesSource() {
  const start = screenSource.indexOf("const loadMessages = useCallback");
  const end = screenSource.indexOf("// 멤버 로드", start);
  assert.notEqual(start, -1, "cohort message loader must exist");
  assert.notEqual(end, -1, "member loader must follow message loader");
  return screenSource.slice(start, end);
}

test("mobile cohort entry uses the canonical server assignment boundary", () => {
  const loader = loadMessagesSource();

  assert.match(
    loader,
    /apiFetch\("\/api\/community\/cohort\/auto-assign",\s*\{\s*method:\s*"POST"/,
  );
  assert.match(
    loader,
    /apiFetch\("\/api\/community\/cohort",\s*\{\s*method:\s*"GET"/,
  );
  assert.doesNotMatch(loader, /\.from\("cohort_members"\)[\s\S]*?\.upsert\s*\(/);
  assert.match(loader, /assignedRoomId\s*!==\s*id/);
  assert.match(
    loader,
    /router\.replace\(\{[\s\S]*?pathname:\s*"\/community\/cohort\/\[id\]"[\s\S]*?id:\s*assignedRoomId/,
  );
});

test("mobile runtime contains no direct cohort membership mutation", () => {
  assert.doesNotMatch(
    screenSource,
    /\.from\("cohort_members"\)(?:(?!;)[\s\S]){0,800}\.(?:insert|upsert|update|delete)\s*\(/,
  );
});
