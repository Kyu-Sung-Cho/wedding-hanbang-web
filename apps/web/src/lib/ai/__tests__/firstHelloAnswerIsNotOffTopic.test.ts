import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  classifyAmoraQuestionScope,
  filterAmoraToolsByQuestionScope,
  AMORA_CONTEXT_FREE_READ_TOOL_NAMES,
} from "@/lib/ai/amoraQuestionScope";
import { isAmoraClarificationAnswerShaped } from "@/lib/ai/amoraClarificationContinuity";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";

/**
 * 아모라가 먼저 건네는 첫마디는 이렇게 끝난다:
 *
 *   "오늘은 딱 한 가지만 정해볼까요? 무엇부터 볼지 모르겠으면 그렇게
 *    말씀해 주셔도 돼요."
 *
 * 그 초대에 가장 자연스러운 답이 전부 범위 밖으로 떨어졌다(2026-08-25 실측).
 * 그러면 도구가 0개가 되고 저장된 커플 문맥도 provider 경계를 못 넘는다.
 * **아모라가 직접 권한 답을 사람이 그대로 했는데 첫 턴부터 아무것도 못 한다.**
 *
 * 되묻기 구제는 [직전 사용자, 아모라, 현재] 세 행을 요구하는데 첫마디 앞에는
 * 사용자 행이 없어 닿지 않았다. 서버는 이 인사를 커플 자신의 여정 데이터로
 * 다시 만들어 모델 문맥에 넣어 주면서도, 범위 판정에는 알려주지 않았다.
 */

const READ_ONLY_BETA_TOOLS = BETA_SAFE_TOOLS.filter(
  (tool) => !isMutatingTool(tool.name),
);

/** 첫마디의 초대에 사람이 실제로 칠 법한 답. */
const GREETING_ANSWERS = [
  "응",
  "네",
  "그래",
  "좋아",
  "좋아요",
  "응 그러자",
  "모르겠어",
  "잘 모르겠어요",
];

describe("첫마디에 대한 답", () => {
  it.each(GREETING_ANSWERS)("'%s' 는 그 자체로는 범위 밖이다", (text) => {
    // 이 판정 자체는 옳다 — 이 문장들에 결혼 이야기가 없는 것은 사실이다.
    // 고치는 것은 판정기가 아니라, 직전에 아모라가 물었다는 사실을 알려주는 쪽이다.
    expect(classifyAmoraQuestionScope({ userText: text }).scope)
      .toBe("W4_out_of_scope");
  });

  it.each(GREETING_ANSWERS)("'%s' 는 되묻기-답 모양으로 인식된다", (text) => {
    // 서버가 첫마디 구제를 걸 때 쓰는 조건이다. 이게 false 가 되면 구제가 끊긴다.
    expect(isAmoraClarificationAnswerShaped(text)).toBe(true);
  });

  it.each(GREETING_ANSWERS)(
    "직전이 아모라의 첫마디였다고 알려주면 '%s' 가 결혼 대화로 돌아온다",
    (text) => {
      const rescued = classifyAmoraQuestionScope({
        userText: text,
        requestKind: "chat",
        // 서버가 첫마디를 이 턴의 문맥 맨 앞에 넣었을 때 함께 켜는 플래그.
        hasWeddingClarificationContinuity: true,
      });
      expect(rescued.scope).toBe("W0_wedding_core");
    },
  );

  it.each(GREETING_ANSWERS)("'%s' 가 도구를 되찾는다", (text) => {
    const closed = filterAmoraToolsByQuestionScope(
      READ_ONLY_BETA_TOOLS,
      classifyAmoraQuestionScope({ userText: text }),
    );
    const opened = filterAmoraToolsByQuestionScope(
      READ_ONLY_BETA_TOOLS,
      classifyAmoraQuestionScope({
        userText: text,
        requestKind: "chat",
        hasWeddingClarificationContinuity: true,
      }),
    );
    // 2026-09-04: 닫힌 턴에도 커플 문맥 없는 조회 도구(장소 검색·시세)는 남는다.
    // 구제가 되찾는 것은 **커플 데이터를 읽는 도구**다 — 그것만 잰다.
    const closedCoupleTools = closed.filter(
      (tool) => !AMORA_CONTEXT_FREE_READ_TOOL_NAMES.has(tool.name),
    );
    const openedCoupleTools = opened.filter(
      (tool) => !AMORA_CONTEXT_FREE_READ_TOOL_NAMES.has(tool.name),
    );
    expect(closedCoupleTools.length).toBe(0);
    expect(openedCoupleTools.length).toBeGreaterThan(0);
  });

  it("구제는 첫마디에만 붙는다 — 아무 W4 발화나 열리지 않는다", () => {
    // 플래그를 켜지 않은 평범한 범위 밖 발화는 그대로 닫혀 있어야 한다.
    for (const text of ["파이썬으로 퀵소트 짜줘", "주식 뭐 사면 돼?"]) {
      expect(classifyAmoraQuestionScope({ userText: text }).scope)
        .toBe("W4_out_of_scope");
    }
  });
});

/**
 * 위 검사들은 판정기가 플래그를 **받으면** 어떻게 도는지만 증명한다.
 * 라우트가 그 플래그를 실제로 켜고 넘기는지는 별개 문제다 — 변형을 심어
 * 확인해 보니 위 33개가 전부 통과했다. 그래서 배선을 따로 고정한다.
 *
 * 주석은 먼저 걷어낸다. 주석 안의 문장을 코드로 세면 지워진 배선에도
 * 초록불이 난다 — 이 저장소가 전에 그 자리에서 당한 적이 있다.
 */
describe("라우트가 첫마디 구제를 실제로 넘긴다", () => {
  const BLOCK_COMMENT = new RegExp("/\\*[\\s\\S]*?\\*/", "g");
  const LINE_COMMENT = new RegExp("(^|\\s)//.*$");

  const source = readFileSync(
    join(process.cwd(), "src", "app", "api", "chat", "route.ts"),
    "utf8",
  )
    .replace(BLOCK_COMMENT, " ")
    .split("\n")
    .map((line) => line.replace(LINE_COMMENT, ""))
    .join("\n");

  it("주석 제거가 실제로 동작한다", () => {
    // 이 검사가 없으면 아래 두 개가 주석을 세고 있어도 모른다.
    expect(source).not.toContain("아모라가 화면에서 건넨 첫마디를");
  });

  it("첫마디를 문맥에 넣은 턴에서만 플래그를 켠다", () => {
    expect(source).toContain(
      "firstHelloAnswered = firstHelloTurn !== null && isClarificationAnswerShaped",
    );
  });

  it("범위 판정이 그 플래그를 읽는다", () => {
    // 지키려는 계약: `hasWeddingClarificationContinuity` 는 되묻기 연속성 값
    // **또는** 첫마디 플래그에서 온다. 어느 쪽도 빠지면 안 된다.
    //
    // 2026-09-02: 읽기 창 복구로 그 값이 폴백을 포함하게 되면서 변수 이름이
    // `…WithFallback` 이 됐고, 문자열 완전일치라 계약이 그대로인데 빨간불이 났다.
    // 그래서 **이름의 앞부분**만 묶는다 — 무관한 값으로 갈아치우는 것은 여전히
    // 잡고, 같은 값의 이름이 길어지는 것은 안 잡는다.
    expect(source.replace(/\s+/g, " ")).toMatch(
      /hasWeddingClarificationContinuity: Boolean\(weddingClarificationContinuity\w*\) \|\| firstHelloAnswered/,
    );
  });
});
