import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessMediationOffer, type MediationOfferMessage } from "../mediationOffer";

function partner(role: "bride" | "groom", content: string): MediationOfferMessage {
  return { content, sender_role: role, visibility: "shared", metadata: { target: "partner" } };
}

const CONVERSATIONS: Array<{ label: string; messages: MediationOfferMessage[] }> = [
  {
    label: "A 예단 갈등 (부모 언급 포함)",
    messages: [
      partner("bride", "어머니가 예단 3천은 해야 한다고 하시는데 나는 부담스러워"),
      partner("groom", "우리 엄마가 그렇게 말한 건 아닌 것 같은데 왜 그렇게 받아들여?"),
      partner("bride", "그럼 내가 예민한 거야? 진짜 서운해"),
      partner("groom", "지금 그 얘기 계속 하면 나도 지쳤어"),
    ],
  },
  {
    label: "B 예식장 예산 갈등 (부모 언급 없음)",
    messages: [
      partner("bride", "예식장 예산 5천은 너무 과해. 나는 반대야"),
      partner("groom", "그건 절대 싫어. 하객 생각하면 그 정도는 해야지"),
    ],
  },
  {
    label: "C 일상적 서운함",
    messages: [
      partner("bride", "요즘 준비 나 혼자 하는 것 같아서 서운해"),
      partner("groom", "나도 회사 때문에 답답해"),
    ],
  },
  {
    label: "D 한쪽만 갈등 표현",
    messages: [
      partner("bride", "우리 어제 싸웠잖아 아직도 속상해"),
      partner("groom", "응 미안해 내가 잘못했어"),
    ],
  },
  {
    label: "E 완곡한 의견 차이",
    messages: [
      partner("bride", "신혼집 위치 얘기는 우리 생각이 좀 다른 것 같아"),
      partner("groom", "나도 그 부분은 동의하기 어려워"),
    ],
  },
  {
    label: "F 교과서적 강한 갈등",
    messages: [
      partner("bride", "너는 맨날 니가 알아서 하라고만 해"),
      partner("groom", "왜 맨날 너만 힘들다고 해? 나도 지쳤어"),
    ],
  },
  {
    label: "G 아모라에게만 말함 (target=ai)",
    messages: [
      { content: "우리 어제 크게 싸웠어", sender_role: "bride", visibility: "shared", metadata: { target: "ai" } },
      { content: "예산 때문에 매번 다퉈", sender_role: "groom", visibility: "shared", metadata: { target: "ai" } },
    ],
  },
  {
    label: "H 이모티콘/ㅋㅋ 섞인 갈등",
    messages: [
      partner("bride", "진짜 서운해 ㅋㅋ 너 맨날 이래"),
      partner("groom", "아 답답해 ㅋㅋㅋ"),
    ],
  },
];

describe("temp: mediation banner recall", () => {
  it("prints assessment for realistic conflicts", () => {
    const rows = CONVERSATIONS.map(({ label, messages }) => {
      const r = assessMediationOffer(messages);
      const flag = r.shouldOffer ? "OFFER" : " no  ";
      return [flag, "score=" + r.score, "ev=" + r.evidenceCount, "roles=" + (r.evidenceRoles.join("/") || "-"), r.reason, label].join(" | ");
    });
    writeFileSync("mediation-recall-out.txt", rows.join("\n"), "utf8");
    expect(rows.length).toBe(CONVERSATIONS.length);
  });
});
