import { describe, expect, it } from "vitest";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";
import {
  resolveAmoraWeddingClarificationContinuity,
  type AmoraClarificationContinuityRow,
} from "@/lib/ai/amoraClarificationContinuity";

/**
 * 2026-08-22 라이브에서 잡힌 **두 홉 천장**.
 *
 *   [사용자] 총 예산을 5000만원으로 바꿔줘            -> W0
 *   [아모라] 이 금액에 무엇까지 포함할까요?
 *   [사용자] 신혼집은 빼고 나머지 다 포함해서 5000만원  -> W1
 *   [아모라] 그럼 이렇게 적용할까요?
 *   [사용자] 네 그렇게 적용해줘                       -> W4, 도구 0개, 카드 없음
 *
 * 마지막 턴에서 아모라는 "이 대화에서는 예산을 실제로 저장·변경할 수는 없어요" 라고
 * 답했다. 계약이 금지한 기능 부재 선언이고, 사용자는 세 번 말하고 아무것도 못 얻는다.
 *
 * 원인은 분류가 아니었다. **직전 한 턴만 보기 때문**이다. 되묻기가 두 번이면 닻이
 * 되어야 할 W0 발화가 두 홉 뒤로 밀리고, 그 사이 턴은 되묻기의 답이라 예산 낱말이
 * 없다("신혼집은 빼고 나머지 다 포함해서" — 답변에 주제어를 다시 쓸 이유가 없다).
 *
 * 그래서 **되묻기 쌍을 거슬러 올라가** 닻을 찾는다. 올라가는 매 홉마다 원래의 가드를
 * 다시 확인한다 — 서버가 쓴 아모라 행, 직전 사용자 행에 묶임, `question_scope` W0,
 * 안전 신호 없음, 확인 카드 없음, 상대 대상 아님. 하나라도 어긋나면 거기서 멈춘다.
 */

const USER_ID = "44444444-4444-4444-8444-444444444444";
type Row = AmoraClarificationContinuityRow;

let seq = 0;
function id(): string {
  seq += 1;
  return `${String(seq).padStart(8, "0")}-1111-4111-8111-111111111111`;
}

function userRow(content: string, overrides: Partial<Row> = {}): Row {
  return {
    id: id(),
    sender_id: USER_ID,
    sender_type: "bride",
    role: "user",
    content,
    metadata: null,
    visibility: "shared",
    ...overrides,
  } as Row;
}

function amoraRow(content: string, inReplyTo: string, overrides: Partial<Row> = {}): Row {
  return {
    id: id(),
    sender_id: null,
    sender_type: "ai",
    role: "assistant",
    content,
    metadata: {
      in_reply_to_user_message_id: inReplyTo,
      question_scope: "W0_wedding_core",
      memory_eligible: true,
    },
    visibility: "shared",
    ...overrides,
  } as Row;
}

/** 파운더 시퀀스 그대로. `hops`=1 이면 되묻기 한 번, 2면 두 번. */
function foundersRows(hops: number, tweak: (rows: Row[]) => void = () => {}): Row[] {
  const rows: Row[] = [];
  const anchor = userRow("총 예산을 5000만원으로 바꿔줘");
  rows.push(anchor);
  let lastUser = anchor;
  // 마지막 답변은 **항상 짧은 확인**이다 — 그것이 이 파일이 고치는 발화다.
  // 그 앞의 답변들은 되묻기에 내용으로 답한 문장이고, 주제어("예산")가 없어서
  // 단독으로는 W0이 아니다. 그게 정확히 닻을 뒤로 미는 원인이다.
  for (let hop = 0; hop < hops; hop += 1) {
    rows.push(amoraRow("이 금액에 무엇까지 포함할까요?", lastUser.id as string));
    const isLast = hop === hops - 1;
    const answer = userRow(
      isLast ? "네 그렇게 적용해줘" : "신혼집은 빼고 나머지 다 포함해서 5000만원으로 해줘",
    );
    rows.push(answer);
    lastUser = answer;
  }
  tweak(rows);
  return rows;
}

function resolve(rows: Row[]) {
  const current = rows[rows.length - 1];
  return resolveAmoraWeddingClarificationContinuity({
    rawOldestFirstRows: rows,
    currentUserMessageId: current.id as string,
    currentUserText: current.content as string,
    requesterUserId: USER_ID,
  });
}

describe("되묻기가 두 번이어도 이어진다", () => {
  it("한 홉 — 기존 동작 그대로", () => {
    const result = resolve(foundersRows(1));
    expect(result).not.toBeNull();
    expect(result?.priorUserText).toBe("총 예산을 5000만원으로 바꿔줘");
  });

  it("두 홉 — 파운더가 실제로 겪은 그 시퀀스", () => {
    const result = resolve(foundersRows(2));
    expect(result, "두 번 되물으면 끊긴다").not.toBeNull();
    // 닻은 **W0였던 발화**여야 한다. 중간 답변("신혼집은 빼고…")은 W1이라 닻이 될 수 없다.
    expect(result?.priorUserText).toBe("총 예산을 5000만원으로 바꿔줘");
    expect(classifyAmoraQuestionScope({
      userText: "네 그렇게 적용해줘",
      hasWeddingClarificationContinuity: result !== null,
    }).allowsLongTermMemory).toBe(false);
  });

  it("집 보증금을 제외하는 금액 답변도 원래 예산 요청에만 이어진다", () => {
    const rows = foundersRows(2, all => {
      all[2].content = "집 보증금은 제외하고 나머지는 모두 포함해서 5000만원으로 해주세요.";
    });
    expect(resolve(rows)?.priorUserText).toBe("총 예산을 5000만원으로 바꿔줘");
  });

  it("같은 제외 답변이라도 예산 닻이 없으면 일정 권한을 빌리지 않는다", () => {
    const rows = foundersRows(2, all => {
      all[0].content = "청첩장 확인 일정을 추가해줘";
    });
    expect(resolve(rows)).toBeNull();
  });
});

describe("거슬러 올라가도 가드는 홉마다 다시 본다", () => {
  it.each([
    "신혼집 계약을 5000만원으로 해줘",
    "신혼집은 빼고 나머지 다 포함해서 5000만원으로 해줘. 회사 회식 예산도 정해줘.",
    "신혼집은 빼고 나머지 다 포함해서 5000만원으로 해줘. 남편이 지금 나를 때리고 있어.",
    "신혼집은 빼고 나머지 다 포함해서 5000만원으로 해줘. 파트너와 대화하는 법도 알려줘.",
    "아내랑 이야기하면 서운해",
  ])("새 과업·위험·관계 상담인 중간 원문은 W0 표식이 있어도 거절: %s", text => {
    const rows = foundersRows(2, all => { all[2].content = text; });
    expect(resolve(rows)).toBeNull();
  });

  it("중간에 확인 카드가 있었으면 멈춘다", () => {
    // 카드가 떠 있던 턴의 확인은 버튼(action_id)뿐이어야 한다.
    const rows = foundersRows(2, (all) => {
      const firstAmora = all[1] as Row & { metadata: Record<string, unknown> };
      firstAmora.metadata.pending_amora_action = { actionId: "x", tool: "update_budget" };
    });
    expect(resolve(rows)).toBeNull();
  });

  it("중간 아모라 발화에 안전 신호가 있으면 멈춘다", () => {
    const rows = foundersRows(2, (all) => {
      all[1].content = "남편이 저를 밀쳤다고 하셨는데 괜찮으세요?";
    });
    expect(resolve(rows)).toBeNull();
  });

  it("중간 아모라 행의 question_scope 가 W0이 아니면 멈춘다", () => {
    const rows = foundersRows(2, (all) => {
      (all[1].metadata as Record<string, unknown>).question_scope = "W2_high_risk_adjacent";
    });
    expect(resolve(rows)).toBeNull();
  });

  it("중간 아모라 행이 다른 사용자 행에 묶여 있으면 멈춘다", () => {
    const rows = foundersRows(2, (all) => {
      (all[1].metadata as Record<string, unknown>).in_reply_to_user_message_id = id();
    });
    expect(resolve(rows)).toBeNull();
  });

  it("중간 사용자 행이 상대의 발화면 멈춘다", () => {
    const rows = foundersRows(2, (all) => {
      all[2].sender_id = "99999999-9999-4999-8999-999999999999";
    });
    expect(resolve(rows)).toBeNull();
  });

  it("중간 사용자 행이 상대에게 보낸 메시지면 멈춘다", () => {
    const rows = foundersRows(2, (all) => {
      all[2].metadata = { target: "partner" };
    });
    expect(resolve(rows)).toBeNull();
  });

  it("공개 범위가 섞이면 멈춘다", () => {
    const rows = foundersRows(2, (all) => {
      all[2].visibility = "bride_private";
    });
    expect(resolve(rows)).toBeNull();
  });
});

describe("끝없이 거슬러 올라가지는 않는다", () => {
  it("닻이 없는 되묻기 사슬은 이어주지 않는다", () => {
    // 처음부터 W0가 아니었으면 이어줄 근거가 없다.
    const rows: Row[] = [];
    const start = userRow("배고파");
    rows.push(start);
    let last = start;
    for (let i = 0; i < 3; i += 1) {
      rows.push(amoraRow("무엇을 도와드릴까요?", last.id as string));
      const next = userRow("응");
      rows.push(next);
      last = next;
    }
    expect(resolve(rows)).toBeNull();
  });

  it("되묻기가 너무 여러 번이면 멈춘다 — 오래된 주제를 현재로 끌어오지 않는다", () => {
    expect(resolve(foundersRows(5))).toBeNull();
  });
});
