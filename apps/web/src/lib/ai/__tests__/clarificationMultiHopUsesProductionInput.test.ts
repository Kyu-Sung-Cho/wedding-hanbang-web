import { describe, expect, it } from "vitest";

import { resolveAmoraWeddingClarificationContinuity } from "../amoraClarificationContinuity";

/**
 * **운영이 실제로 넘기는 입력으로 다홉을 시험한다.**
 *
 * 2026-09-02 발견: `MAX_CLARIFICATION_HOPS = 3` 은 운영에서 **한 번도 쓰인 적이
 * 없었다.** 라우트가 되묻기 답인 턴에서도 대화를 `.limit(3)` 으로 읽고 있었고,
 * 그 3행이 그대로 이 함수로 흘러갔다. 이 함수는 홉을 올릴 때 `index < 2` 면 즉시
 * `null` 이므로, 행이 3개면 2홉이 **물리적으로 불가능**하다.
 *
 * 저장소 전체에 그 3행 절단을 단언하는 테스트가 0건이었고, 기존 다홉 테스트는
 * 행을 5~7개 넘겼다 — **테스트 입력이 운영과 달라서** 초록불 밑에서 살았다.
 * 이 파일은 그 간극을 막는다: 운영이 만드는 행 개수를 그대로 재현한다.
 *
 * 파운더 지시(2026-09-02) 때문에 여기서 안전 가드는 하나도 완화하지 않는다.
 * 이 검사는 "몇 행을 받았을 때 무엇이 가능한가" 만 본다.
 */

type Row = {
  id: string;
  sender_id: string | null;
  sender_type: string;
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
  visibility: "shared" | "bride_private" | "groom_private";
  created_at: string;
};

const USER = "11111111-1111-4111-8111-111111111111";

let seq = 0;
const at = () => new Date(Date.UTC(2026, 8, 2, 0, seq++)).toISOString();

function userRow(id: string, content: string): Row {
  return {
    id, sender_id: USER, sender_type: "user", role: "user", content,
    metadata: {}, visibility: "shared", created_at: at(),
  };
}

/** 서버가 쓴 아모라 행. `question_scope` 와 `in_reply_to` 가 구제의 전제다. */
function amoraRow(id: string, content: string, inReplyTo: string, scope = "W0_wedding_core"): Row {
  return {
    id, sender_id: null, sender_type: "ai", role: "assistant", content,
    metadata: { question_scope: scope, in_reply_to_user_message_id: inReplyTo },
    visibility: "shared", created_at: at(),
  };
}

/**
 * 되묻기가 `hops` 번 이어진 대화를 만든다.
 *
 *   닻(단독 W0) → [아모라 되물음 → 사용자 답] × hops
 *
 * 행 개수는 `1 + 2 * hops`. 운영은 이 목록의 **마지막 3행만** 넘기고 있었다.
 */
function conversation(hops: number): Row[] {
  seq = 0;
  const rows: Row[] = [userRow("u0", "예식장 계약금이 얼마나 필요할까?")];
  for (let h = 1; h <= hops; h += 1) {
    const last = rows[rows.length - 1];
    rows.push(amoraRow(`a${h}`, "어느 지역으로 보고 계세요?", last.id));
    rows.push(userRow(`u${h}`, h === hops ? "응 그렇게 해줘" : "서울 쪽으로 보고 있어"));
  }
  return rows;
}

const resolve = (rows: Row[]) =>
  resolveAmoraWeddingClarificationContinuity({
    rawOldestFirstRows: rows,
    requesterUserId: USER,
    currentUserMessageId: rows[rows.length - 1].id,
    currentUserText: rows[rows.length - 1].content,
  });

describe("되묻기 다홉 — 운영이 넘기는 행 개수로", () => {
  it("한 홉은 행이 3개여도 이어진다 (오늘 동작, 바뀌면 안 된다)", () => {
    const rows = conversation(1);
    expect(rows).toHaveLength(3);
    expect(resolve(rows)).not.toBeNull();
  });

  it("두 홉은 행이 3개면 불가능하다 — 이것이 회귀의 정체다", () => {
    // 라우트가 `.limit(3)` 으로 읽으면 이 목록만 남는다.
    const truncated = conversation(2).slice(-3);
    expect(truncated).toHaveLength(3);
    expect(resolve(truncated)).toBeNull();
  });

  it("두 홉은 넓은 창을 주면 이어진다", () => {
    const rows = conversation(2);
    expect(rows).toHaveLength(5);
    expect(resolve(rows)).not.toBeNull();
  });

  it("세 홉도 넓은 창에서 이어진다 — MAX_CLARIFICATION_HOPS 가 실제로 쓰인다", () => {
    const rows = conversation(3);
    expect(rows).toHaveLength(7);
    expect(resolve(rows)).not.toBeNull();
  });

  it("네 홉은 상한에서 끊긴다", () => {
    expect(resolve(conversation(4))).toBeNull();
  });
});

describe("홉마다 가드를 다시 본다", () => {
  it("두 번째 홉의 아모라 행이 W0 기록이 아니면 거기서 멈춘다", () => {
    // 가드를 첫 홉에서만 보게 만들면 이 검사가 빨간불이 되어야 한다.
    // 처음 쓴 판에는 이 경우가 없어서, 가드를 `hop === 1` 로 좁혀도 초록불이었다.
    const rows = conversation(2);
    const firstAmora = rows[1];
    rows[1] = {
      ...firstAmora,
      metadata: { ...(firstAmora.metadata ?? {}), question_scope: "W4_out_of_scope" },
    };
    expect(resolve(rows)).toBeNull();
  });

  it("두 번째 홉의 답이 상대에게 보낸 말이면 멈춘다", () => {
    const rows = conversation(2);
    const midUser = rows[2];
    rows[2] = { ...midUser, metadata: { ...(midUser.metadata ?? {}), target: "partner" } };
    expect(resolve(rows)).toBeNull();
  });
});

describe("2홉 이상에서 화제가 바뀌면 멈춘다", () => {
  it("현재 발화가 결혼 밖 화제를 명시하면 2홉으로 못 올라간다", () => {
    // **답변 모양은 유지하면서** 다른 분야를 명시해야 이 갈래를 실제로 밟는다.
    // 처음엔 "오늘 날씨 어때?" 로 썼는데, 그건 물음표·모양 검사에서 먼저 걸려
    // 화제이탈 차단을 꺼도 초록불이었다 — 검사가 다른 이유로 통과한 것이다.
    const rows = conversation(2);
    const last = rows[rows.length - 1];
    rows[rows.length - 1] = { ...last, content: "응 회사 끝나고 할게" };
    expect(resolve(rows)).toBeNull();
  });

  it("**1홉은 그 규칙의 영향을 받지 않는다** — 오늘 이어지던 것이 끊기면 안 된다", () => {
    // 이 검사가 이 변경의 안전 계약이다. 1홉이 하나라도 달라지면 그건
    // "창 복원" 이 아니라 "관문 완화" 이므로 넣으면 안 된다.
    const rows = conversation(1);
    const last = rows[rows.length - 1];
    rows[rows.length - 1] = { ...last, content: "응 그렇게 해줘" };
    expect(resolve(rows)).not.toBeNull();
  });
});
