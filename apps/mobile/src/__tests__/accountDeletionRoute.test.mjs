import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const source = fs.readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../app/settings/index.tsx",
  ),
  "utf8",
);

test("mobile account deletion uses the durable web saga and handles pending truthfully", () => {
  assert.match(source, /apiFetchForExpectedUser\(expectedActorUserId, "\/api\/auth\/delete"/);
  assert.match(source, /body\.pending/);
  assert.match(source, /삭제 요청 접수/);
  assert.doesNotMatch(source, /functions\/v1\/delete-account/);
});
