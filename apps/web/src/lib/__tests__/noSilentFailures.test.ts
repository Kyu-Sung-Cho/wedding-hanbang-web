// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **서버가 왜 안 됐는지 말했는데 화면이 버리는 자리**가 없는지 본다.
 *
 * 감사에서 같은 모양이 일곱 군데 나왔다. 전부 `if (!res.ok) return;` 또는
 * `if (ok) { ... }` 에 else 가 없는 형태였고, 사용자에게는 **눌렀는데 아무 일도
 * 안 일어나는 것**으로 보였다. 서버는 매번 이유를 문장으로 줬는데 그 문장이
 * 클라이언트에서 사라졌다.
 *
 * 이 파일은 각 자리가 **이유를 화면까지 들고 가는 배선**을 유지하는지 본다.
 * 문구가 아니라 배선을 본다 — 문구만 보면 죽은 코드가 남아 있어도 통과한다.
 */

const web = (...parts: string[]) => resolve(process.cwd(), "src", ...parts);

/** 주석을 지우고 읽는다 — 설명문이 검사를 통과시키면 안 된다. */
function read(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("댓글 수정·삭제가 거절 이유를 말한다", () => {
  const store = read(web("stores", "communityStore.ts"));
  const item = read(web("components", "community", "CommentItem.tsx"));

  it("검사가 실제로 파일을 읽는다", () => {
    expect(store.length).toBeGreaterThan(5000);
    expect(item.length).toBeGreaterThan(5000);
  });

  it("스토어가 boolean 대신 이유를 돌려준다", () => {
    expect(store).toContain("CommentMutationResult");
    expect(store).toContain("updateComment: (commentId: string, content: string) => Promise<CommentMutationResult>");
    expect(store).toContain("deleteComment: (commentId: string) => Promise<CommentMutationResult>");
  });

  it("화면이 그 이유를 그린다", () => {
    expect(item).toContain("setActionError(result.message)");
    expect(item).toContain("{actionError}");
  });

  it("삭제가 거절되면 확인창을 닫지 않는다", () => {
    // 닫으면 댓글이 그대로 남은 화면만 보여 "눌렀는데 아무 일도 없었다" 가 된다.
    //
    // **순서를 본다.** 첫 판은 두 낱말이 있는지만 봤는데, 확인창 닫기를 `if` 앞으로
    // 옮겨도 통과했다(변형 시험이 잡음). 닫기는 성공 갈래 **안**에만 있어야 한다.
    const handler = item.slice(
      item.indexOf("async function handleDelete()"),
      item.indexOf("function openReportModal"),
    );
    expect(handler.length).toBeGreaterThan(50);
    const okAt = handler.indexOf("if (result.ok)");
    const closeAt = handler.indexOf("setShowDeleteConfirm(false)");
    expect(okAt, "성공 갈래가 없다").toBeGreaterThan(-1);
    expect(closeAt, "확인창을 닫는 코드가 없다").toBeGreaterThan(-1);
    expect(
      closeAt,
      "확인창을 성공 갈래 밖에서 닫는다 — 거절돼도 닫혀 버린다",
    ).toBeGreaterThan(okAt);
    expect(handler).toContain("setActionError(result.message)");
  });
});

describe("커뮤니티 저장(북마크)이 실패하면 되돌린다", () => {
  const card = read(web("components", "community", "PostCard.tsx"));
  const landing = read(web("components", "community", "CommunityLandingClient.tsx"));

  it("두 화면 모두 낙관적 변경을 되돌린다", () => {
    for (const [name, source] of [["PostCard", card], ["CommunityLandingClient", landing]] as const) {
      expect(source, `${name}: 되돌리는 코드가 없다`).toContain("setBookmarked(previous)");
      expect(source, `${name}: 이전 값을 안 잡아둔다`).toContain("const previous = bookmarked");
    }
  });

  it("실패 이유를 말한다", () => {
    expect(card).toContain("showActionToast(result.message)");
    expect(landing).toContain("showToast(result.message)");
  });
});

describe("아모라 피드백이 거절 이유를 말한다", () => {
  const bubble = read(web("components", "app", "chat", "ChatBubble.tsx"));

  it("submitFeedback 이 boolean 이 아니다", () => {
    // `return res.ok` 로 돌아가면 429(1시간 20회) 같은 이유가 사라진다.
    expect(bubble).toContain("Promise<{ ok: true } | { ok: false; message: string }>");
    expect(bubble).not.toContain("    return res.ok;");
  });

  it("화면이 그 이유를 그린다", () => {
    expect(bubble).toContain("setFeedbackError(result.message)");
    expect(bubble).toContain("{feedbackError}");
  });
});

describe("일정 화면이 서버가 준 사유를 버리지 않는다", () => {
  const schedule = read(web("components", "app", "schedule", "ScheduleContent.tsx"));
  const modal = read(web("components", "app", "schedule", "EventFormModal.tsx"));
  const mapper = read(web("lib", "journey", "planChangeError.ts"));

  it("코드 화이트리스트로 올린다 — 문자열을 그대로 올리지 않는다", () => {
    // 서버 문구를 그대로 올리면 내부 오류 원문이 새어 나갈 수 있다. 그 계약은
    // `EventFormModal.execution-fields.test.tsx` 가 이미 고정하고 있다.
    expect(mapper).toContain("PLAN_CHANGE_STALE");
    expect(mapper).toContain("PLAN_CHANGE_REJECTED");
    expect(mapper).toContain("if (!(error instanceof PlanChangeError)) return null;");
  });

  it("두 표면이 모두 그 사유를 쓴다", () => {
    expect(schedule).toContain("planChangeMessage(error)");
    expect(modal).toContain("planChangeMessage(error)");
  });

  it("복원 요청이 눌린 자리에 표시를 남긴다", () => {
    expect(schedule).toContain("setRestoringEventId");
    expect(schedule).toContain('aria-busy={restoringEventId === event.id}');
  });
});

describe("저장한 이야기의 메모 저장·삭제가 말을 한다", () => {
  const saved = read(web("components", "app", "saved", "SavedNotesContent.tsx"));

  it("else 가 있고 이유를 세운다", () => {
    expect(saved).toContain("setActionError(await readError(response,");
    expect(saved).toContain("{actionError}");
  });
});

describe("초대 코드 재발급이 실패하면 다시 조회한다", () => {
  const settings = read(web("app", "(app)", "settings", "page.tsx"));

  it("주석이 약속한 조회를 실제로 건다", () => {
    // 예전에는 "다음 canonical GET 이 phase 를 밝혀 준다" 고 적어 두고 그 GET 을
    // 부르지 않았다. 그래서 멀쩡한 코드가 사라진 채 틀린 오류만 남았다.
    //
    // **재발급 함수 안만 본다.** 첫 판은 파일 전체를 봤는데, 「다시 시도」 버튼이
    // 같은 낱말을 갖고 있어서 재발급 쪽을 통째로 지워도 통과했다(변형 시험이 잡음).
    const fn = settings.slice(
      settings.indexOf("const handleRegenerateCode = async () => {"),
      settings.indexOf("const saveName = async () => {"),
    );
    expect(fn.length, "재발급 함수를 못 찾았다").toBeGreaterThan(200);
    // 실패 갈래(else)와 예외 갈래(catch) 둘 다 다시 조회를 걸어야 한다.
    expect(
      fn.split("setConnectionRetryNonce").length - 1,
      "실패·예외 두 갈래 모두에서 다시 조회하지 않는다",
    ).toBeGreaterThanOrEqual(2);
    expect(fn).toContain("setRegenerateError");
    expect(fn).toContain("REGENERATE_FAILED");
  });
});
