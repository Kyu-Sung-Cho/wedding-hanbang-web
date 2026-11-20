import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

// 허락 규칙 화면(25장 3절)의 앱 쪽 배선. 표는 웹과 같은 공용 함수가 만든다(packages/shared 시험이 내용을 잰다).

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("앱 화면은 공용 표를 꺼진 기능 그대로 쓰고, 같은 화면에서 알림과 기억을 정한다", () => {
  const screen = source("../../app/settings/amora-permissions.tsx");
  assert.match(screen, /from "@hanbang\/shared\/amora-permissions"/);
  assert.match(screen, /const FEATURES = \{ webSearch: false, agentTasks: false \} as const;/);
  assert.match(screen, /buildAmoraPermissionTable\(FEATURES\)/);
  for (const control of ["<AmoraPushPreferenceControl />", "<TodayOnePreferenceControl />", "<AmoraCarePreferenceControl />"]) {
    assert.ok(screen.includes(control), control);
  }
  assert.match(screen, /router\.push\("\/settings\/amora-memory" as const\)/);
});

test("설정에서 허락 규칙 화면으로 가는 줄이 있다", () => {
  const settings = source("../../app/settings/index.tsx");
  assert.match(settings, /title="아모라가 하는 일"/);
  assert.match(settings, /router\.push\("\/settings\/amora-permissions" as const\)/);
});
