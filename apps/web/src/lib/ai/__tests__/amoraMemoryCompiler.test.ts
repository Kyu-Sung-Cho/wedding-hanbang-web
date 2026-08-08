import { describe, expect, it } from "vitest";
import {
  AMORA_MEMORY_MAX_INPUT_CHARS,
  type AmoraMemorySource,
  canonicalizeAmoraMemoryText,
  containsPotentialSensitiveData,
  extractTrustedMomentMemoryKeys,
  prepareAmoraMemoryBatch,
  redactPotentialSensitiveData,
  shouldDeferAmoraMemoryBatch,
  validateAmoraMemoryCompilation,
} from "@/lib/ai/amoraMemoryCompiler";

const USER_MESSAGE_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_MESSAGE_ID = "00000000-0000-4000-8000-000000000002";
const USER_SOURCE = "서울 동쪽 지역을 우선 검토하고 싶어";
const USER_SOURCES = new Map<string, AmoraMemorySource>([[
  USER_MESSAGE_ID,
  { content: USER_SOURCE, actorRole: "bride" },
]]);

function sourceMap(
  entries: Array<[string, string, "bride" | "groom"]>,
): Map<string, AmoraMemorySource> {
  return new Map(entries.map(([id, content, actorRole]) => [id, { content, actorRole }]));
}

function validMemory(overrides: Record<string, unknown> = {}) {
  return {
    source_message_id: USER_MESSAGE_ID,
    memory_key: "venue:preferred_area",
    kind: "preference",
    category: "venue",
    title: "선호 지역",
    value: "서울 동쪽 지역을 우선 검토",
    evidence: "서울 동쪽 지역을 우선 검토",
    reasoning: "사용자가 직접 선호 지역을 말함",
    confidence: 0.91,
    explicit: true,
    ...overrides,
  };
}

describe("Amora memory compiler boundary", () => {
  it("keeps assistant rows in the cursor batch but excludes assistant text and derived keys from provider input", () => {
    const messages = [
      {
        id: USER_MESSAGE_ID,
        role: "user" as const,
        content: "강남 지역을 우선 보고 싶어",
        sourceActorRole: "bride" as const,
        momentMemoryKeys: ["venue:preferred_area"],
      },
      {
        id: OTHER_MESSAGE_ID,
        role: "assistant" as const,
        content: "그럼 샘플 호텔을 선호한다고 기억할게",
        sourceActorRole: null,
        momentMemoryKeys: ["venue:preferred_hotel"],
      },
    ];

    const batch = prepareAmoraMemoryBatch(messages);

    expect(batch.messages.map((message) => message.id)).toEqual([
      USER_MESSAGE_ID,
      OTHER_MESSAGE_ID,
    ]);
    expect(batch.input).toContain("강남 지역을 우선 보고 싶어");
    expect(batch.input).not.toContain("샘플 호텔");
    expect(batch.input).not.toContain("venue:preferred_area");
    expect(batch.input).not.toContain("venue:preferred_hotel");
  });

  it("accepts only catalogued keys from a server-authored moment envelope", () => {
    expect(extractTrustedMomentMemoryKeys({
      client_request_id: "moment:venue_visit:d1:2026-07-16",
      moment: {
        memoryKeys: [
          "venue_candidates",
          "venue_quotes",
          "not_in_the_catalog",
          "venue_candidates",
        ],
      },
    })).toEqual(["moment:venue_candidates", "moment:venue_quotes"]);

    expect(extractTrustedMomentMemoryKeys({
      client_request_id: "client-controlled-key",
      moment: { memoryKeys: ["venue_candidates"] },
    })).toEqual([]);
    expect(extractTrustedMomentMemoryKeys({
      client_request_id: "moment:venue_visit:d1:2026-07-16",
      moment: { memoryKeys: ["not_in_the_catalog", 123, null] },
    })).toEqual([]);
  });

  it("passes trusted care topics to only the next user line without exposing assistant content as evidence", () => {
    const batch = prepareAmoraMemoryBatch([
      {
        id: OTHER_MESSAGE_ID,
        role: "assistant",
        content: "오늘 본 예식장 중 어디가 제일 좋았어요?",
        sourceActorRole: null,
        trustedMomentMemoryKeys: ["moment:venue_candidates", "moment:venue_quotes"],
      },
      {
        id: USER_MESSAGE_ID,
        role: "user",
        content: "샘플 예식장 가가 채광이 좋아서 제일 마음에 들었어",
        sourceActorRole: "bride",
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        role: "user",
        content: "내일은 드레스도 보러 가",
        sourceActorRole: "bride",
      },
    ]);

    const lines = batch.input.split("\n");
    expect(lines[0]).toContain("후보 기억 주제: moment:venue_candidates, moment:venue_quotes");
    expect(lines[0]).toContain("샘플 예식장 가가 채광이 좋아서 제일 마음에 들었어");
    expect(lines[1]).not.toContain("후보 기억 주제");
    expect(batch.input).not.toContain("오늘 본 예식장");
  });

  it("does not carry a care topic past an ineligible user reply", () => {
    const batch = prepareAmoraMemoryBatch([
      {
        id: OTHER_MESSAGE_ID,
        role: "assistant",
        content: "오늘 본 예식장 중 어디가 제일 좋았어요?",
        sourceActorRole: null,
        trustedMomentMemoryKeys: ["moment:venue_candidates"],
      },
      {
        id: USER_MESSAGE_ID,
        role: "user",
        content: "지금은 다른 개인적인 이야기를 할게",
        sourceActorRole: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        role: "user",
        content: "결혼식 총예산은 3천만원으로 정했어",
        sourceActorRole: "bride",
      },
    ]);

    expect(batch.messages).toHaveLength(3);
    expect(batch.input).toContain("결혼식 총예산은 3천만원으로 정했어");
    expect(batch.input).not.toContain("지금은 다른 개인적인 이야기를 할게");
    expect(batch.input).not.toContain("후보 기억 주제");
  });

  it("does not advance a trusted care question past the input boundary without its first user reply", () => {
    const prefix = Array.from({ length: 28 }, (_, index) => ({
      id: `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      role: "user" as const,
      content: `${index}-${"가".repeat(850)}`,
      sourceActorRole: "bride" as const,
    }));
    const careQuestion = {
      id: "70000000-0000-4000-8000-000000000001",
      role: "assistant" as const,
      content: "오늘 본 예식장은 어땠어요?",
      sourceActorRole: null,
      trustedMomentMemoryKeys: ["moment:venue_candidates"],
    };
    const reply = {
      id: "70000000-0000-4000-8000-000000000002",
      role: "user" as const,
      content: `샘플 예식장 가가 제일 마음에 들었어 ${"나".repeat(800)}`,
      sourceActorRole: "bride" as const,
    };

    const first = prepareAmoraMemoryBatch([...prefix, careQuestion, reply]);
    const remainder = [...prefix, careQuestion, reply].slice(first.messages.length);
    const second = prepareAmoraMemoryBatch(remainder);

    expect(first.messages).not.toContainEqual(careQuestion);
    expect(second.messages.slice(-2).map((message) => message.id)).toEqual([
      careQuestion.id,
      reply.id,
    ]);
    expect(second.input).toContain("후보 기억 주제: moment:venue_candidates");
    expect(second.input).toContain(reply.content);
  });

  it("consumes an oversized 40-message window as contiguous whole-message batches without skipping a cursor", () => {
    const messages = Array.from({ length: 40 }, (_, index) => ({
      id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `${"x".repeat(1_300)}-tail-${String(index + 1).padStart(2, "0")}`,
      sourceActorRole: index % 2 === 0
        ? (index % 4 === 0 ? "bride" as const : "groom" as const)
        : null,
    }));

    const consumedIds: string[] = [];
    let offset = 0;
    let batchCount = 0;
    while (offset < messages.length) {
      const batch = prepareAmoraMemoryBatch(messages.slice(offset));

      expect(batch.input.length).toBeLessThanOrEqual(AMORA_MEMORY_MAX_INPUT_CHARS);
      expect(batch.messages.length).toBeGreaterThan(0);
      for (const message of batch.messages) {
        if (message.role === "user") {
          expect(batch.input).toContain(`[${message.id}]`);
          expect(batch.input).toContain(message.content);
        } else {
          expect(batch.input).not.toContain(`[${message.id}]`);
          expect(batch.input).not.toContain(message.content);
        }
      }
      consumedIds.push(...batch.messages.map((message) => message.id));
      offset += batch.messages.length;
      batchCount += 1;
    }

    expect(batchCount).toBeGreaterThan(1);
    expect(consumedIds).toEqual(messages.map((message) => message.id));
  });

  it("includes the complete durable user message before advancing its cursor", () => {
    const tailFact = "최종 확정은 야외 예식이 아니라 실내 예식이야";
    const message = {
      id: "30000000-0000-4000-8000-000000000999",
      role: "user" as const,
      content: `${"앞부분 ".repeat(250)}${tailFact}`,
      sourceActorRole: "bride" as const,
    };

    const batch = prepareAmoraMemoryBatch([message]);

    expect(message.content.length).toBeGreaterThan(900);
    expect(batch.messages).toEqual([message]);
    expect(batch.input).toContain(tailFact);
    expect(batch.input).toContain(message.content);
  });

  it("keeps the ten-message threshold for new jobs but compiles a short final continuation", () => {
    expect(shouldDeferAmoraMemoryBatch(9, 0)).toBe(true);
    expect(shouldDeferAmoraMemoryBatch(1, 1)).toBe(false);
  });

  it("ignores provider-authored summary text and derives a deterministic summary from accepted memories only", () => {
    const result = validateAmoraMemoryCompilation({
      summary: "사용자는 샘플 호텔을 가장 선호한다.",
      memories: [validMemory()],
    }, USER_SOURCES);

    expect(result.summary).toBe("- 신부 · 선호 지역: 서울 동쪽 지역을 우선 검토");
    expect(result.memories[0]).not.toHaveProperty("evidence");
  });

  it("rejects a memory whose evidence is not an exact substring of its user source", () => {
    const result = validateAmoraMemoryCompilation({
      memories: [validMemory({
        value: "샘플 호텔",
        evidence: "샘플 호텔을 가장 선호해",
      })],
    }, USER_SOURCES);

    expect(result).toEqual({ summary: null, memories: [] });
  });

  it.each(["응", "네", "그래 맞아", "좋아!", "오케이", "ㅇㅇ", "예", "넵"])(
    "does not treat acknowledgement-only user text as factual evidence: %s",
    (acknowledgement) => {
      const result = validateAmoraMemoryCompilation({
        memories: [validMemory({
          value: "샘플 호텔 선호",
          evidence: acknowledgement,
        })],
      }, sourceMap([[USER_MESSAGE_ID, acknowledgement, "bride"]]));

      expect(result).toEqual({ summary: null, memories: [] });
    },
  );

  it("drops a clearly invented value even when the quoted evidence exists in the source", () => {
    const budgetSource = "예산은 5천만원으로 준비할게";
    const result = validateAmoraMemoryCompilation({
      memories: [validMemory({
        memory_key: "venue:preferred_hotel",
        title: "선호 호텔",
        value: "샘플 호텔",
        evidence: budgetSource,
      })],
    }, sourceMap([[USER_MESSAGE_ID, budgetSource, "bride"]]));

    expect(result).toEqual({ summary: null, memories: [] });
  });

  it("does not accept an invented value merely because its title overlaps the evidence", () => {
    const source = "지역은 아직 모르겠어";
    const result = validateAmoraMemoryCompilation({
      memories: [validMemory({
        title: "선호 지역",
        value: "강남",
        evidence: source,
      })],
    }, sourceMap([[USER_MESSAGE_ID, source, "bride"]]));

    expect(result).toEqual({ summary: null, memories: [] });
  });

  it("accepts bounded explicit memories backed by a user message in the batch", () => {
    const result = validateAmoraMemoryCompilation(
      { summary: "예식장 지역 선호를 확인했다.", memories: [validMemory()] },
      USER_SOURCES,
    );

    expect(result.memories[0]).toMatchObject({
      sourceMessageId: USER_MESSAGE_ID,
      memoryKey: "venue:preferred_area",
      explicit: true,
    });
  });

  it("rejects a source that is not an allowed user message", () => {
    expect(() => validateAmoraMemoryCompilation(
      { summary: "요약", memories: [validMemory({ source_message_id: OTHER_MESSAGE_ID })] },
      USER_SOURCES,
    )).toThrow(/not a user message/);
  });

  it.each([
    ["low confidence", { confidence: 0.79 }],
    ["implicit inference", { explicit: false }],
    ["unstable key", { memory_key: "웨딩홀 지역" }],
    ["oversized value", { value: "가".repeat(161) }],
  ])("rejects %s", (_label, override) => {
    expect(() => validateAmoraMemoryCompilation({
      summary: "요약",
      memories: [validMemory(override)],
    }, USER_SOURCES)).toThrow();
  });

  it("rejects duplicate semantic keys in one compiler response", () => {
    expect(() => validateAmoraMemoryCompilation({
      summary: "요약",
      memories: [validMemory(), validMemory({ source_message_id: OTHER_MESSAGE_ID })],
    }, sourceMap([
      [USER_MESSAGE_ID, USER_SOURCE, "bride"],
      [OTHER_MESSAGE_ID, USER_SOURCE, "bride"],
    ]))).toThrow(/duplicate memory key/);
  });

  it("allows each partner to contribute the same semantic key in one batch", () => {
    const groomSource = "성수 지역을 우선 검토하고 싶어";
    const result = validateAmoraMemoryCompilation({
      memories: [
        validMemory(),
        validMemory({
          source_message_id: OTHER_MESSAGE_ID,
          value: "성수 지역을 우선 검토",
          evidence: "성수 지역을 우선 검토",
        }),
      ],
    }, sourceMap([
      [USER_MESSAGE_ID, USER_SOURCE, "bride"],
      [OTHER_MESSAGE_ID, groomSource, "groom"],
    ]));

    expect(result.memories).toHaveLength(2);
    expect(result.memories.map((memory) => memory.sourceActorRole)).toEqual(["bride", "groom"]);
  });

  it("drops memories containing obvious personal identifiers and redacts them from summaries", () => {
    const result = validateAmoraMemoryCompilation({
      summary: "연락처는 010-1234-5678이고 강남 예식장을 선호한다.",
      memories: [
        validMemory({ value: "010-1234-5678로 연락" }),
        validMemory({
          source_message_id: OTHER_MESSAGE_ID,
          memory_key: "venue:backup_area",
          value: "성수도 함께 검토",
          evidence: "성수도 함께 검토",
        }),
      ],
    }, sourceMap([
      [USER_MESSAGE_ID, USER_SOURCE, "bride"],
      [OTHER_MESSAGE_ID, "성수도 함께 검토하고 싶어", "groom"],
    ]));

    expect(result.summary).toBe("- 신랑 · 선호 지역: 성수도 함께 검토");
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]?.memoryKey).toBe("venue:backup_area");
  });

  it.each([
    "010.1234.5678",
    "010/1234/5678",
    "900101-5123456",
    "비번은 1234",
    "당뇨 때문에 인슐린 사용 중",
    "난임 치료로 시험관 시술 중",
    "난·임 치·료로 시·험·관 시술 중",
    "산부인과 진료 일정을 조정해야 해",
    "성\u200B생활 문제로 상담 중",
    "family:fertility_plan\nfamily\n내년부터 준비",
    "sexual_health:care\nhealth\n상담 일정",
    "현재 &#51076;&#49888; 12주차",
    "서울시 강남구 테헤란로 123",
    "서울 강남구 역삼동 123-45",
    "110-245-123456",
  ])("detects sensitive-data separator and label bypasses: %s", (value) => {
    expect(containsPotentialSensitiveData(value)).toBe(true);
  });

  it("drops a sensitive semantic namespace even when the display text is euphemistic", () => {
    const result = validateAmoraMemoryCompilation({
      summary: "민감한 개인 상태를 언급했다.",
      memories: [validMemory({
        memory_key: "health:pregnant",
        category: "health",
        title: "현재 상태",
        value: "12주차",
      })],
    }, USER_SOURCES);

    expect(result.memories).toHaveLength(0);
    expect(result.summary).toBeNull();
  });

  it("fails a gestational summary closed when its semantic memory candidate is removed", () => {
    const result = validateAmoraMemoryCompilation({
      summary: "사용자는 현재 12주차이고 다음 상담에서 일정을 확인하고 싶어 한다.",
      memories: [validMemory({
        memory_key: "family:baby_timing",
        category: "family",
        title: "현재 상태",
        value: "12주차",
      })],
    }, USER_SOURCES);

    expect(result).toEqual({
      summary: null,
      memories: [],
    });
  });

  it("redacts a gestational week even when the model emits no memory candidate", () => {
    const result = validateAmoraMemoryCompilation({
      summary: "사용자는 현재 12주차라고 말했다.",
      memories: [],
    }, USER_SOURCES);

    expect(result.summary).toBeNull();
    expect(result.memories).toEqual([]);
  });

  it("drops a generic-looking memory when its exact evidence reveals fertility treatment", () => {
    const source = "난임 시술 때문에 매주 병원 일정을 조정해야 해";
    const result = validateAmoraMemoryCompilation({
      memories: [validMemory({
        memory_key: "schedule:weekly_constraint",
        category: "schedule",
        title: "주간 일정 제약",
        value: "매주 병원 일정을 조정",
        evidence: source,
      })],
    }, sourceMap([[USER_MESSAGE_ID, source, "bride"]]));

    expect(result).toEqual({ summary: null, memories: [] });
  });

  it("drops reproductive semantic keys even when their display value is euphemistic", () => {
    const source = "내년부터 준비할게";
    const result = validateAmoraMemoryCompilation({
      memories: [validMemory({
        memory_key: "family:fertility_plan",
        category: "family",
        title: "향후 계획",
        value: source,
        evidence: source,
      })],
    }, sourceMap([[USER_MESSAGE_ID, source, "bride"]]));

    expect(result).toEqual({ summary: null, memories: [] });
  });

  it("keeps ordinary family wedding preferences outside the sensitive boundary", () => {
    const source = "양가 부모님 선물은 한과로 준비할게";
    const result = validateAmoraMemoryCompilation({
      memories: [validMemory({
        memory_key: "family:gift_preference",
        category: "family",
        title: "가족 선물 선호",
        value: "부모님 선물은 한과",
        evidence: "부모님 선물은 한과",
      })],
    }, sourceMap([[USER_MESSAGE_ID, source, "bride"]]));

    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]?.memoryKey).toBe("family:gift_preference");
  });

  it("does not confuse an ordinary healthy-menu preference with health data", () => {
    expect(containsPotentialSensitiveData(
      "meal:healthy_menu\nmeal\n건강한 메뉴 선호",
    )).toBe(false);
  });

  it.each([
    "연락처\n010\u200B-1234\u200B-5678",
    "주민번호\n900101-\u20605123456",
    "email\na\uFEFF@b.com",
  ])("removes Unicode format characters before sensitive-data detection: %s", (value) => {
    expect(containsPotentialSensitiveData(value)).toBe(true);
  });

  it.each([
    "family:baby_timing\nfamily\n현재 상태\n12주차\n사용자가 직접 말함",
    "identity:birth_date\nidentity\n생년월일\n1990-01-01",
    "travel:passport\ntravel\n여권번호\nM12345678",
    "health:wellbeing\nhealth\n현재 상태\n특이사항 없음",
  ])("detects sensitive semantic namespaces and labelled identifiers: %s", (value) => {
    expect(containsPotentialSensitiveData(value)).toBe(true);
  });

  it("canonicalizes accepted memory strings before returning data for storage", () => {
    const result = validateAmoraMemoryCompilation({
      summary: "  이전\u200B 대화를 ＮＦＫＣ로 정리했어요.  ",
      memories: [validMemory({
        title: "  선호\u200B 지역  ",
        value: "  서울 Ａ구역  ",
        evidence: "서울 Ａ구역",
        reasoning: "  직접\u2060 말함  ",
      })],
    }, sourceMap([[USER_MESSAGE_ID, "서울 Ａ구역을 먼저 볼게", "bride"]]));

    expect(result.summary).toBe("- 신부 · 선호 지역: 서울 A구역");
    expect(result.memories[0]).toMatchObject({
      title: "선호 지역",
      value: "서울 A구역",
      reasoning: "직접 말함",
    });
    expect(canonicalizeAmoraMemoryText(" Ａ\u200BＢ ")).toBe("AB");
  });

  it("redacts a visually normal identifier after invisible-character canonicalization", () => {
    expect(redactPotentialSensitiveData("연락처는 010\u200B-1234\u200B-5678입니다."))
      .toBe("연락처는 [민감정보 제외]입니다.");
  });

  it("fails closed when punctuation splitting prevents precise sensitive-text redaction", () => {
    expect(redactPotentialSensitiveData("현재 난·임 치·료 중이에요."))
      .toBe("[민감정보 제외]");
  });
});
