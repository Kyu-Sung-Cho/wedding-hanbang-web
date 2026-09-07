import { describe, expect, it } from "vitest";
import {
  AMORA_EMPTY_TERMINAL_FALLBACK_TEXT,
  applyAmoraOutputHygiene,
  ensureNonEmptyTerminalText,
} from "@/lib/ai/amoraOutputHygiene";
import { composeAmoraPersistenceTerminal } from "@/lib/ai/amoraPersistenceClaims";

/**
 * 정상 답변 코퍼스. **오탐 0이 이 파일의 첫 계약이다.**
 *
 * 아모라가 실제로 쓰는 모양을 모았다 — 웃음·울음 자모, URL, 이메일, 이모지,
 * 영문 단위, 한자, 전각 기호, 표, 목록. 하나라도 글자가 바뀌면 이 스크러버는
 * 출시하면 안 된다.
 */
const CLEAN_ANSWERS: readonly string[] = [
  "예식장 대관료는 지역마다 달라요.",
  "총예산은 3,000만 원으로 잡아볼까요?",
  "ㅋㅋ 그럴 수 있어요, 저도 그 부분이 제일 어려웠어요.",
  "ㅠㅠ 많이 속상하셨겠어요.",
  "ㅎㅎ 좋은 선택이에요.",
  "ㄱㄱ 하시죠!",
  "하객 80~100명이면 홀 크기를 먼저 보셔야 해요.",
  "스드메는 스튜디오·드레스·메이크업의 줄임말이에요.",
  "예약 확인은 https://hanbang.ai/wedding/schedule 에서 하실 수 있어요.",
  "담당자 메일은 hello@example.com 이에요.",
  "축하드려요 🎉 준비가 잘 되고 있네요.",
  "이 부분은 꼭 확인해 주세요 ✅",
  "홀 면적은 약 330㎡ 정도예요.",
  "당일 기온이 30℃까지 올라간다고 해요.",
  "예단(禮緞)은 지역마다 관행이 달라요.",
  "① 예식장 ② 스드메 ③ 신혼여행 순서로 보실까요?",
  "1인 식대는 8만 5,000원 수준이에요.",
  "드레스 사이즈는 55~66 사이로 보시면 돼요.",
  "계약금은 총액의 10% 정도가 일반적이에요.",
  "웨딩홀 답사는 주말 오전 10시가 한산해요.",
  "cm 단위로 적어주시면 제가 정리할게요.",
  "폐백은 생략하시는 분들도 많아요.",
  "「예식 진행표」를 먼저 만들어 볼까요?",
  "예상 비용 ₩32,000,000 정도로 잡혀 있어요.",
  "본식 DVD는 선택 사항이에요.",
  "혼주 한복은 대여가 더 저렴해요.",
  "식전 영상은 3분을 넘기지 않는 게 좋아요.",
  "청첩장은 예식 6주 전에 돌리시면 돼요.",
  "신혼집 잔금일과 예식일이 겹치지 않게 볼게요.",
  "지금까지 정리한 내용을 다시 보여드릴까요?",
];

describe("applyAmoraOutputHygiene", () => {
  it("removes only the observed stray cvs suffix while protecting names, units, code and user text", () => {
    const text = "> 변경·취소 조건을 서면으로 안내 부탁드립니다. cvs";
    expect(applyAmoraOutputHygiene(text).text).toBe("> 변경·취소 조건을 서면으로 안내 부탁드립니다.");
    for (const original of [
      "근처 cvs 에서 사실 수 있어요.", "미국 CVS 약국에서 확인해 주세요.",
      "단위는 cm, kg, vs를 그대로 씁니다.", "브랜드 이름: cvs",
      "https://example.com/cvs", "담당자 cvs@example.com", "`부탁드립니다. cvs`",
      "```text\n부탁드립니다. cvs\n```",
    ]) expect(applyAmoraOutputHygiene(original).text).toBe(original);
    expect(applyAmoraOutputHygiene(text, { userText: "이 문구를 보존해 줘: 부탁드립니다. cvs" }).text).toBe(text);
  });
  it("changes not one character of a clean Korean answer", () => {
    for (const answer of CLEAN_ANSWERS) {
      const result = applyAmoraOutputHygiene(answer);
      expect(result.text).toBe(answer);
      expect(result.actions.filter((action) => (
        action.kind === "foreign_run_removed"
        || action.kind === "spam_tail_trimmed"
        || action.kind === "spam_body_replaced"
      ))).toEqual([]);
    }
  });

  it("removes the exact Bengali fragment that reached production on 2026-09-03", () => {
    const result = applyAmoraOutputHygiene(
      "মাস행사 일정만으로는 날짜를 저장할 수 없습니다",
    );

    expect(result.text).toBe("행사 일정만으로는 날짜를 저장할 수 없습니다");
    expect(result.actions).toContainEqual({
      kind: "foreign_run_removed",
      runs: 1,
      removedChars: 3,
      blocks: ["Bengali"],
    });
  });

  it("removes a foreign run that sits between Korean words and closes the gap", () => {
    const result = applyAmoraOutputHygiene("예식장 Привет 답사를 잡을까요?");

    expect(result.text).toBe("예식장 답사를 잡을까요?");
    expect(result.actions).toContainEqual({
      kind: "foreign_run_removed",
      runs: 1,
      removedChars: 6,
      blocks: ["Cyrillic"],
    });
  });

  it("keeps the fragment when the user wrote those characters first", () => {
    const withoutUserText = applyAmoraOutputHygiene(
      "กรุงเทพ 에서 하는 예식도 알아볼까요?",
    );
    expect(withoutUserText.text).toBe("에서 하는 예식도 알아볼까요?");

    const withUserText = applyAmoraOutputHygiene(
      "กรุงเทพ 에서 하는 예식도 알아볼까요?",
      { userText: "신혼여행을 กรุงเทพ 로 갈까 하는데" },
    );
    expect(withUserText.text).toBe("กรุงเทพ 에서 하는 예식도 알아볼까요?");
    expect(withUserText.actions.some((action) =>
      action.kind === "foreign_run_removed")).toBe(false);
  });

  it("keeps the answer untouched when scrubbing would empty it", () => {
    const onlyForeign = "মাস মাস";
    const result = applyAmoraOutputHygiene(onlyForeign);

    expect(result.text).toBe(onlyForeign);
    expect(result.actions).toContainEqual({
      kind: "foreign_run_kept_empty_result",
      runs: 2,
    });
  });

  it("still trims the 2026-08-25 spam tail", () => {
    const result = applyAmoraOutputHygiene("예산은 6,200만 원이에요.출장안마");

    expect(result.text).toBe("예산은 6,200만 원이에요.");
    expect(result.actions).toContainEqual({ kind: "spam_tail_trimmed" });
  });

  it("counts an unknown short latin fragment without deleting it", () => {
    const result = applyAmoraOutputHygiene("근처 cvs 에서 사실 수 있어요.");

    // 지우지 않는다 — cm·kg·상호와 구별할 방법이 없다.
    expect(result.text).toBe("근처 cvs 에서 사실 수 있어요.");
    expect(result.actions).toContainEqual({
      kind: "latin_fragment_detected",
      count: 1,
    });
  });

  it("does not count known short units as fragments", () => {
    const result = applyAmoraOutputHygiene("길이는 cm 로, 무게는 kg 로 적어주세요.");

    expect(result.text).toBe("길이는 cm 로, 무게는 kg 로 적어주세요.");
    expect(result.actions).toEqual([]);
  });
});

describe("ensureNonEmptyTerminalText", () => {
  it("passes a real answer through unchanged", () => {
    expect(ensureNonEmptyTerminalText("예산을 정리해볼게요.")).toBe("예산을 정리해볼게요.");
  });

  it("replaces an empty or blank body with the server-owned notice", () => {
    expect(ensureNonEmptyTerminalText("")).toBe(AMORA_EMPTY_TERMINAL_FALLBACK_TEXT);
    expect(ensureNonEmptyTerminalText("   \n  ")).toBe(AMORA_EMPTY_TERMINAL_FALLBACK_TEXT);
    expect(ensureNonEmptyTerminalText(undefined)).toBe(AMORA_EMPTY_TERMINAL_FALLBACK_TEXT);
  });

  it("uses the same sentence the persistence guard already shows users", () => {
    // 문구를 새로 지어내지 않았다는 증명. `amoraPersistenceClaims` 가 같은 상황에서
    // 실제로 내보내는 문장과 글자까지 같아야 한다. 두 곳이 갈라지면 여기서 깨진다.
    const guarded = composeAmoraPersistenceTerminal({
      text: "예산을 함께 살펴볼게요.",
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable",
      droppedPendingActionTag: true,
    });

    expect(guarded.text).toContain(AMORA_EMPTY_TERMINAL_FALLBACK_TEXT);
  });
});
