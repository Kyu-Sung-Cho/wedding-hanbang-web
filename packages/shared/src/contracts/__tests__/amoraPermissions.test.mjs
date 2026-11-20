import assert from "node:assert/strict";
import test from "node:test";

import { AMORA_PERMISSION_COPY, buildAmoraPermissionTable } from "../amoraPermissions.mjs";

// 허락 규칙 화면(25장 3절). 오늘 쓸 수 없는 일은 화면에 줄이 없어야 한다.

test("인터넷 찾기와 맡은 일이 꺼져 있으면 그 줄은 없다", () => {
  const table = buildAmoraPermissionTable();
  assert.deepEqual(table, {
    auto: ["준비 기록 읽기", "표와 요약 만들기", "글 초안 쓰기"],
    ask: ["예산과 일정, 할 일, 조건 저장하기", "문의 편지 확정하기"],
    never: ["업체에 직접 보내기", "두 분 계정으로 로그인하기", "결제하거나 예약 확정하기", "시키지 않은 연락하기"],
  });
  assert.deepEqual(buildAmoraPermissionTable({ webSearch: "yes", agentTasks: 1 }), table);
});

test("기능이 켜졌다고 넘기면 그 기능의 줄만 생긴다", () => {
  const search = buildAmoraPermissionTable({ webSearch: true });
  assert.ok(search.auto.includes("인터넷에서 찾아보기"));
  assert.ok(search.auto.includes("업체 공식 페이지 읽기"));
  assert.ok(!search.ask.includes("맡은 일 시작하기"));
  const tasks = buildAmoraPermissionTable({ agentTasks: true });
  assert.ok(tasks.auto.includes("맡은 일 이어 가기"));
  assert.ok(tasks.ask.includes("맡은 일 시작하기"));
  assert.equal(tasks.never.length, 4);
});

test("화면 문장에 줄표와 금지 낱말이 없다", () => {
  const all = buildAmoraPermissionTable({ webSearch: true, agentTasks: true });
  const sentences = [
    ...Object.values(all).flat(),
    AMORA_PERMISSION_COPY.title,
    AMORA_PERMISSION_COPY.intro,
    AMORA_PERMISSION_COPY.askNote,
    AMORA_PERMISSION_COPY.neverNote,
    AMORA_PERMISSION_COPY.controlsTitle,
    AMORA_PERMISSION_COPY.memoryLink,
    AMORA_PERMISSION_COPY.memoryLinkSub,
    ...Object.values(AMORA_PERMISSION_COPY.sections),
  ];
  for (const sentence of sentences) {
    assert.doesNotMatch(sentence, /—|–|플래너|파트너|베타|·/, sentence);
  }
});
