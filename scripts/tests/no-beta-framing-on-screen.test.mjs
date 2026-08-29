// 화면에 **"베타" 라는 틀이 남아 있지 않은가** — 랜딩만이 아니라 제품 전체에서.
//
// ## 무엇이 있었나
//
// 2026-08-29 파운더 결정: "베타 우리 안할거야 알아둬". 화면·문서에서 "계정 베타",
// "사전등록", "베타 신청", "승인 대기" 같은 틀을 쓰지 않는다. 계정은 그냥 만들 수
// 있는 것이고, 기능은 그냥 있는 기능이다.
//
// 그날 랜딩에서는 걷어냈는데 **제품 화면 18곳이 그대로 남아 있었다** —
// 커뮤니티 글쓰기·이미지 API 7곳("통제 베타에서는 …"), 아모라 사용량 안내 7곳
// ("베타 무료 상담이 N회 남았어요", "(베타 기간 한도)"), 소개·푸터·커플 역할 4곳.
// 랜딩 가드들은 `components/landing/redesign` 디렉터리만 훑기 때문에 하나도 못 봤다.
//
// ## 없어지는 것은 틀이지 사실이 아니다
//
// 문구를 지운 게 아니라 **틀만 뺐다.** 사실은 그대로 남아 있다:
//   "통제 베타에서는 텍스트 게시물만"  → "지금은 텍스트 게시물만"
//   "베타 무료 상담이 3회 남았어요"     → "무료 상담이 3회 남았어요"
// 그리고 "이용 방법과 비용은 아직 정해지지 않았고 … 결제를 요청하지 않아요" 는
// 계속 참이므로 남는다 — 베타라서가 아니라 오늘 그렇기 때문이다.
//
// ## 왜 저장소 검사인가
//
// 웹 테스트는 파일별로 흩어져 있어 "제품 전체에 이 낱말이 없다"를 아무도 못 본다.
// 여기서 한 번에 훑는다. 주석은 걷어낸다 — 왜 없앴는지 적어 둔 기록까지 지우면
// 다음 사람이 같은 틀을 다시 만든다.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const webSrc = resolve(repoRoot, "apps/web/src");
const mobileSrc = resolve(repoRoot, "apps/mobile");

const SKIP_DIRS = new Set(["node_modules", "__tests__", ".next", ".expo", "ios", "android", "dist", "build"]);

/** 주석을 걷어낸다. 기록은 남아도 되고, 화면에 나가는 문자열만 본다. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");
}

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (/\.tsx?$/u.test(entry.name) && !/\.test\./u.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * 막는 말들.
 *
 * `베타` 는 파운더가 이름으로 든 넷("계정 베타"·"사전등록"·"베타 신청"·"승인 대기")을
 * 통째로 덮는다.
 *
 * ⚠️ 2026-08-29에 **"미리 체험하기" 를 추가**했다. 그 낱말에는 "베타" 가 없지만
 * `NEXT_PUBLIC_LAUNCH_MODE=coming_soon` 이 켜지면 주 행동 버튼이 "시작하기" 대신
 * 그것으로 바뀌었고, 그 env 가 **운영에 켜져 있어 `/about` 이 실제로 그렇게 나가고
 * 있었다**(라이브 실측). "아직 정식이 아니다" 라는 같은 틀이라 파운더가 함께 없앴다.
 * 분기는 `CustomerNav` 에서 지웠고, 이 줄은 그것이 돌아오는 것을 막는다.
 */
const BANNED = ["베타", "미리 체험하기", "coming_soon"];

test("화면 문자열에 '아직 정식이 아니다' 라는 틀이 없다", () => {
  const files = [...walk(webSrc, []), ...walk(mobileSrc, [])];
  assert.ok(files.length > 200, `소스를 ${files.length}개만 찾았다 — 걷기가 깨졌는지 보라`);

  const offenders = [];
  for (const file of files) {
    const source = stripComments(readFileSync(file, "utf8"));
    source.split("\n").forEach((line, index) => {
      const hit = BANNED.find((word) => line.includes(word));
      if (!hit) return;
      offenders.push(`${relative(repoRoot, file)}:${index + 1} [${hit}] — ${line.trim().slice(0, 60)}`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    "화면에 '베타' 라는 틀이 남았습니다(2026-08-29 파운더 결정). 사실은 남기고 틀만 "
      + "빼세요 — 예: \"통제 베타에서는 텍스트만\" → \"지금은 텍스트만\".\n"
      + offenders.join("\n"),
  );
});

test("검사기가 실제로 틀을 잡는다", () => {
  // 위 검사가 0건이라 "잡을 수 있는가"를 증명하지 못한다. 답을 아는 표본으로 잰다.
  for (const planted of [
    'const msg = "계정 베타에서는 아직 쓸 수 없어요";',
    '{isComingSoon ? "미리 체험하기" : "시작하기"}',
    'process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon"',
  ]) {
    const clean = stripComments(planted);
    assert.ok(BANNED.some((w) => clean.includes(w)), `심어 둔 틀을 못 잡았다: ${planted}`);
  }

  // 주석에 남긴 기록은 걸리지 않아야 한다 — 걸리면 왜 없앴는지를 못 적는다.
  const note = ["// 2026-08-29 파운더 결정으로 베타 틀을 없앴다", 'const ok = "지금은 텍스트만";'].join("\n");
  assert.ok(!stripComments(note).includes("베타"), "주석의 기록까지 금지하고 있다");
});
