import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import { resolvePreparationMemberPresentation } from "../lib/neutralMemberPresentation.mjs";

test("neutral preparation spaces never present compatibility slots as gender roles", () => {
  assert.deepEqual(resolvePreparationMemberPresentation({
    memberModelVersion: 2,
    compatibilityRole: "bride",
  }), {
    fieldLabel: "준비 공간",
    valueLabel: "구성원",
  });
  assert.deepEqual(resolvePreparationMemberPresentation({
    memberModelVersion: 2,
    compatibilityRole: "groom",
  }), {
    fieldLabel: "준비 공간",
    valueLabel: "구성원",
  });
  assert.doesNotMatch(
    JSON.stringify(resolvePreparationMemberPresentation({
      memberModelVersion: 2,
      compatibilityRole: "bride",
    })),
    /신부|신랑|bride|groom/u,
  );
});

test("legacy role presentation remains exact and unknown member models fail closed", () => {
  assert.deepEqual(resolvePreparationMemberPresentation({
    memberModelVersion: 1,
    compatibilityRole: "bride",
  }), { fieldLabel: "역할", valueLabel: "신부" });
  assert.deepEqual(resolvePreparationMemberPresentation({
    memberModelVersion: 1,
    compatibilityRole: "groom",
  }), { fieldLabel: "역할", valueLabel: "신랑" });
  assert.equal(resolvePreparationMemberPresentation({
    memberModelVersion: null,
    compatibilityRole: "bride",
  }), null);
  assert.equal(resolvePreparationMemberPresentation({
    memberModelVersion: 1,
    compatibilityRole: null,
  }), null);
});

test("profile and settings resolve the member model before rendering a role label", () => {
  const profileSource = readFileSync(
    fileURLToPath(new URL("../../app/(tabs)/profile.tsx", import.meta.url)),
    "utf8",
  );
  const settingsSource = readFileSync(
    fileURLToPath(new URL("../../app/settings/index.tsx", import.meta.url)),
    "utf8",
  );

  // 설정은 공유 표기 모듈을 통과한다 — 라벨을 화면마다 손으로 적지 않는다.
  assert.match(settingsSource, /EXPO_PUBLIC_AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED/u);
  assert.match(settingsSource, /member_model_version/u);
  assert.match(settingsSource, /resolvePreparationMemberPresentation/u);

  // 프로필은 v2 에서 배지를 아예 그리지 않는다(중립어로 바꾸는 게 아니다).
  assert.match(profileSource, /member_model_version === 2/u);
  assert.match(profileSource, /usesNeutralMembers.{0,40}[?].{0,20}null/su);
});
