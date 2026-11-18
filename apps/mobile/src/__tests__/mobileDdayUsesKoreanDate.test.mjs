import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

/**
 * 모바일 화면 세 곳이 각자 D-day 를 계산했고, 전부 **기기 시간대** 기준이었다.
 *
 * 예식일은 사용자가 고른 **한국 날짜**다. 기기 시간대로 오늘을 읽으면 해외에
 * 있을 때 채팅(서버·KST)과 이 화면들이 서로 다른 D-day 를 말한다.
 *
 * 게다가 세 곳의 파싱 방식이 서로 달랐다 — `profile.tsx` 는 날짜만 있는
 * 문자열을 `new Date(dateStr)` 로 읽어 UTC 자정으로 해석했고, 나머지 둘은
 * `T00:00:00` 을 붙여 로컬 자정으로 읽었다. 같은 앱 안에서 세 화면이 세 가지
 * 답을 낼 수 있었다.
 *
 * 웹은 2026-08-25 에 서버 계산을 `@hanbang/shared` 의 `daysUntilWedding`
 * (KST 고정)으로 통일했다. 모바일 채팅은 같은 서버를 타므로 자동으로 나았지만
 * 이 세 화면은 자기 코드를 갖고 있어 그대로였다.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
// 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 홈(`app/(tabs)/lounge.tsx`)은 D-day 를 세지 않는다.
// 청첩장 카드의 날짜는 서버(`/api/invitation/home`)가 저장된 예식일 그대로 준다. 그래서 홈은 이 목록에서 빠지고,
// 대신 아래 시험이 홈이 기기 시간대로 D-day 를 다시 세기 시작하지 않는지 본다.
const FILES = [
  "../../app/profile.tsx",
  "../../app/schedule/index.tsx",
];

test("the home does not count D-day by itself", () => {
  const lounge = fs.readFileSync(path.resolve(here, "../../app/(tabs)/lounge.tsx"), "utf8");
  assert.doesNotMatch(lounge, /function calcDday|daysUntilWedding|1000 \* 60 \* 60 \* 24/);
  assert.match(lounge, /<InvitationHome\b/);
});

for (const rel of FILES) {
  const source = fs.readFileSync(path.resolve(here, rel), "utf8");
  const name = rel.replace("../../", "");

  test(`${name} 은 공용 KST 계산을 쓴다`, () => {
    assert.match(source, /daysUntilWedding\(dateStr, Date\.now\(\)\)/);
    assert.match(source, /from "@hanbang\/shared"/);
  });

  test(`${name} 은 기기 시간대로 오늘을 만들지 않는다`, () => {
    // 이 세 가지가 예전 방식의 표식이다. 하나라도 살아 있으면 되돌아간 것이다.
    const dday = source.slice(
      source.indexOf("function calcDday"),
      source.indexOf("function calcDday") + 400,
    );
    assert.doesNotMatch(dday, /setHours\(0, 0, 0, 0\)/);
    assert.doesNotMatch(dday, /getTodayStart\(\)/);
    assert.doesNotMatch(dday, /1000 \* 60 \* 60 \* 24/);
  });
}

test("계산할 수 없는 날짜는 null 로 흘려보낸다", () => {
  // `daysUntilWedding` 은 형식이 아니거나 실재하지 않는 날짜에 null 을 준다.
  // 화면이 그 값을 그대로 받아야 "D-null" 같은 문구가 안 나간다.
  for (const rel of FILES) {
    const source = fs.readFileSync(path.resolve(here, rel), "utf8");
    assert.match(source, /function calcDday\(dateStr: string \| null\): number \| null/);
  }
});
