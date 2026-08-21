import { describe, expect, it } from "vitest";
import {
  AMORA_PROFILE_FIELD_MAX_CHARS,
  projectAmoraProfiles,
  type AmoraProfileProjectionNode,
} from "../amoraProfileProjection";

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const BRIDE_ID = "20000000-0000-4000-8000-000000000001";
const GROOM_ID = "30000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "40000000-0000-4000-8000-000000000001";

const context = {
  coupleId: COUPLE_ID,
  memberIds: { bride: BRIDE_ID, groom: GROOM_ID },
  allowedVisibilities: ["shared", "bride_private"] as const,
};

function node(
  overrides: Partial<AmoraProfileProjectionNode> = {},
): AmoraProfileProjectionNode {
  const actor = overrides.sourceActorRole ?? "bride";
  const visibility = overrides.visibility ?? "shared";
  const sourceMessageId = overrides.sourceMessageId ?? MESSAGE_ID;
  return {
    id: "50000000-0000-4000-8000-000000000001",
    coupleId: COUPLE_ID,
    visibility,
    memoryKey: "venue:preferred_area",
    memoryKind: "preference",
    title: "선호 지역",
    value: "강남",
    reasoning: null,
    confidence: 0.9,
    sourceMessageId,
    sourceActorRole: actor,
    supersededAt: null,
    metadata: { explicit: true },
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    sourceMessage: {
      id: sourceMessageId,
      coupleId: COUPLE_ID,
      visibility,
      senderId: actor === "bride" ? BRIDE_ID : GROOM_ID,
      senderType: actor,
      role: "user",
      metadata: {},
    },
    ...overrides,
  };
}

function profileFor(
  nodes: readonly AmoraProfileProjectionNode[],
  visibility: "shared" | "bride_private" = "shared",
) {
  return projectAmoraProfiles(nodes, context).profiles.find(
    (profile) => profile.visibility === visibility,
  ) ?? null;
}

describe("projectAmoraProfiles", () => {
  it("keeps the same shared key for both actors with explicit role attribution and stable order", () => {
    const bride = node({ value: "강남", confidence: 0.91 });
    const groom = node({
      id: "50000000-0000-4000-8000-000000000002",
      sourceMessageId: "40000000-0000-4000-8000-000000000002",
      sourceActorRole: "groom",
      value: "성수",
      confidence: 0.84,
    });

    const forward = projectAmoraProfiles([bride, groom], context);
    const reversed = projectAmoraProfiles([groom, bride], context);
    const profile = forward.profiles[0];

    expect(forward).toEqual(reversed);
    expect(profile?.tasteProfile).toBe(
      "신부 명시 · venue:preferred_area = 강남 / 신랑 명시 · venue:preferred_area = 성수",
    );
    expect(profile?.confidenceScore).toBe(0.84);
    expect(profile?.personaSummary).toBeNull();
    expect(profile?.conflictPattern).toBeNull();
    expect(profile?.sensitiveTopics).toEqual([]);
    expect(profile?.openQuestions).toEqual([]);
  });

  it("isolates private nodes from shared output and rejects the other actor in a private scope", () => {
    const bridePrivate = node({
      visibility: "bride_private",
      memoryKey: "style:private_mood",
      value: "차분한 분위기",
    });
    const groomPrivate = node({
      id: "50000000-0000-4000-8000-000000000003",
      visibility: "groom_private",
      sourceMessageId: "40000000-0000-4000-8000-000000000003",
      sourceActorRole: "groom",
      memoryKey: "style:private_mood",
      value: "화려한 분위기",
    });

    expect(profileFor([bridePrivate, groomPrivate], "shared")).toBeNull();
    expect(profileFor([bridePrivate, groomPrivate], "bride_private")?.tasteProfile)
      .toBe("신부 명시 · style:private_mood = 차분한 분위기");
  });

  it.each([
    ["partner target", { sourceMessage: { ...node().sourceMessage!, metadata: { target: "partner" } } }],
    ["assistant role", { sourceMessage: { ...node().sourceMessage!, role: "assistant" } }],
    ["wrong member", { sourceMessage: { ...node().sourceMessage!, senderId: GROOM_ID } }],
    ["wrong scope", { sourceMessage: { ...node().sourceMessage!, visibility: "bride_private" } }],
  ])("rejects an invalid source: %s", (_label, overrides) => {
    expect(profileFor([node(overrides as Partial<AmoraProfileProjectionNode>)])).toBeNull();
  });

  it("fails the whole projection closed when a V2 source embed is incomplete", () => {
    const valid = node({ value: "SAFE_VALUE" });
    const incomplete = node({
      id: "50000000-0000-4000-8000-000000000009",
      memoryKey: "style:wedding_mood",
      value: "MUST_NOT_LEAK",
      sourceMessage: null,
    });

    expect(projectAmoraProfiles([valid, incomplete], context)).toEqual({
      profiles: [],
      rejectedReason: "invalid_source",
    });
  });

  it("filters superseded, tombstone, low-confidence, DLP-unsafe, and malformed V2 nodes", () => {
    const invalid = [
      node({ id: "50000000-0000-4000-8000-000000000010", supersededAt: "2026-07-16T00:00:00.000Z" }),
      node({ id: "50000000-0000-4000-8000-000000000011", metadata: { explicit: true, user_deleted: true } }),
      node({ id: "50000000-0000-4000-8000-000000000012", confidence: 0.79 }),
      node({ id: "50000000-0000-4000-8000-000000000013", value: "010-1234-5678" }),
      node({ id: "50000000-0000-4000-8000-000000000014", memoryKey: "invalid key" }),
      node({ id: "50000000-0000-4000-8000-000000000015", memoryKind: "personality" }),
      node({ id: "50000000-0000-4000-8000-000000000016", value: "" }),
      node({ id: "50000000-0000-4000-8000-000000000017", sourceMessageId: null }),
      node({ id: "50000000-0000-4000-8000-000000000018", sourceActorRole: null }),
      node({ id: "50000000-0000-4000-8000-000000000019", metadata: { explicit: false } }),
    ];

    expect(projectAmoraProfiles(invalid, context).profiles).toEqual([]);
  });

  it("uses only the newest active correction for the same actor and key", () => {
    const oldNode = node({
      id: "50000000-0000-4000-8000-000000000020",
      value: "강남",
      updatedAt: "2026-07-14T00:00:00.000Z",
    });
    const corrected = node({
      id: "50000000-0000-4000-8000-000000000021",
      value: "성수",
      confidence: 0.88,
      updatedAt: "2026-07-16T00:00:00.000Z",
    });

    expect(profileFor([corrected, oldNode])?.tasteProfile)
      .toBe("신부 명시 · venue:preferred_area = 성수");
  });

  it("caps each field with the newest four values per actor without crowding either actor out", () => {
    const baseTime = Date.parse("2026-07-15T00:00:00.000Z");
    const manyBrideNodes = Array.from({ length: 100 }, (_, index) => node({
      id: `bride-node-${index.toString().padStart(3, "0")}`,
      sourceMessageId: `40000000-0000-4000-8000-${(index + 100).toString().padStart(12, "0")}`,
      memoryKey: `style:choice_${index.toString().padStart(3, "0")}`,
      value: `신부 선택 ${index}`,
      confidence: index < 96 ? 0.8 : 0.9,
      updatedAt: new Date(baseTime + index * 1_000).toISOString(),
    }));
    const groom = node({
      id: "groom-node",
      sourceMessageId: "40000000-0000-4000-8000-000000000999",
      sourceActorRole: "groom",
      memoryKey: "style:groom_choice",
      value: "신랑 선택",
      confidence: 0.85,
      updatedAt: new Date(baseTime + 50_000).toISOString(),
    });

    const forward = projectAmoraProfiles([...manyBrideNodes, groom], context);
    const reversed = projectAmoraProfiles([groom, ...manyBrideNodes].reverse(), context);
    const profile = forward.profiles[0];
    const text = profile?.tasteProfile ?? "";

    expect(forward).toEqual(reversed);
    expect(text.match(/명시 ·/gu)).toHaveLength(5);
    expect(text).toContain("style:choice_099");
    expect(text).not.toContain("style:choice_000");
    expect(text).toContain("style:groom_choice");
    expect(text.length).toBeLessThanOrEqual(AMORA_PROFILE_FIELD_MAX_CHARS);
    expect(profile?.confidenceScore).toBe(0.85);
    expect(profile?.updatedAt).toBe(new Date(baseTime + 99_000).toISOString());
  });

  it("keeps all eight maximum-size decision-process contributions within the field ceiling", () => {
    const maxSuffix = (index: number) =>
      `choice_${index}_${"a".repeat(39)}`;
    const lastValue = `${"가".repeat(147)}LAST_SENTINEL`;
    expect(maxSuffix(0)).toHaveLength(48);
    expect(lastValue).toHaveLength(160);
    const nodes = (["bride", "groom"] as const).flatMap((actor, actorIndex) =>
      Array.from({ length: 4 }, (_, index) => node({
        id: `${actor}-max-${index}`,
        sourceMessageId: `40000000-0000-4000-8000-${(
          actorIndex * 10 + index + 700
        ).toString().padStart(12, "0")}`,
        sourceActorRole: actor,
        memoryKey: `decision_process:${maxSuffix(index)}`,
        memoryKind: "decision",
        value: actor === "groom" && index === 3 ? lastValue : "가".repeat(160),
        updatedAt: new Date(Date.parse("2026-07-15T00:00:00.000Z") + index * 1_000)
          .toISOString(),
      }))
    );

    const text = profileFor(nodes)?.decisionStyle ?? "";

    expect(text.match(/명시 ·/gu)).toHaveLength(8);
    expect(text).toContain("LAST_SENTINEL");
    expect(text).not.toContain("…");
    expect(text).toHaveLength(1_909);
    expect(text.length).toBeLessThanOrEqual(AMORA_PROFILE_FIELD_MAX_CHARS);
  });

  it("maps only explicit namespaces without personality or relationship inference", () => {
    const nodes = [
      node({ id: "50000000-0000-4000-8000-000000000030", memoryKey: "budget:limit", memoryKind: "constraint", value: "4천만원" }),
      node({ id: "50000000-0000-4000-8000-000000000031", memoryKey: "decision_process:comparison", memoryKind: "decision", value: "두 곳을 비교한 뒤 결정" }),
      node({ id: "50000000-0000-4000-8000-000000000032", memoryKey: "communication:answer_length", memoryKind: "preference", value: "짧은 답변" }),
      node({ id: "50000000-0000-4000-8000-000000000033", memoryKey: "style:wedding_mood", memoryKind: "fact", value: "차분함" }),
      node({ id: "50000000-0000-4000-8000-000000000034", memoryKey: "family:parent_opinion", memoryKind: "relationship", value: "호텔 선호" }),
    ];
    const profile = profileFor(nodes);

    expect(profile?.budgetPosture).toBe("신부 명시 · budget:limit = 4천만원");
    expect(profile?.budgetPosture).not.toContain("절약형");
    expect(profile?.decisionStyle).toBe(
      "신부 명시 · decision_process:comparison = 두 곳을 비교한 뒤 결정",
    );
    expect(profile?.communicationStyle).toBe(
      "신부 명시 · communication:answer_length = 짧은 답변",
    );
    expect(profile?.tasteProfile).toBeNull();
    expect(profile?.personaSummary).toBeNull();
    expect(profile?.conflictPattern).toBeNull();
  });

  it("returns no profile for valid but unsupported namespaces", () => {
    expect(profileFor([node({ memoryKey: "family:gift_preference", memoryKind: "relationship" })]))
      .toBeNull();
  });

  it("fails closed before projection when the bounded query returns 501 rows", () => {
    const nodes = Array.from({ length: 501 }, (_, index) => node({
      id: `node-${index}`,
    }));

    expect(projectAmoraProfiles(nodes, context)).toEqual({
      profiles: [],
      rejectedReason: "too_many_nodes",
    });
  });

  describe("중립 준비 공간 라벨", () => {
    // 슬롯을 라벨로 쓰면 고르지도 않은 성별이 설정 화면과 프롬프트에 박힌다.
    // 다만 액터 구분 자체는 유지해야 한다 — 한 사람의 말을 두 사람의 합의로
    // 넓히지 않기 위해서다.
    const neutralContext = {
      ...context,
      neutralMemberPresentation: true,
    };

    it("관점을 알면 본인/상대로 가른다", () => {
      const result = projectAmoraProfiles(
        [node({ sourceActorRole: "bride" }), node({
          id: "50000000-0000-4000-8000-000000000002",
          sourceActorRole: "groom",
          memoryKey: "venue:preferred_style",
          title: "선호 스타일",
          value: "모던",
        })],
        { ...neutralContext, viewerUserId: BRIDE_ID },
      );
      const text = JSON.stringify(result.profiles);
      expect(text).not.toContain("신부");
      expect(text).not.toContain("신랑");
      expect(text).toContain("본인 명시");
      expect(text).toContain("상대 명시");
    });

    it("관점을 몰라도 두 사람을 구분하고 성별은 안 쓴다", () => {
      const result = projectAmoraProfiles(
        [node({ sourceActorRole: "bride" }), node({
          id: "50000000-0000-4000-8000-000000000002",
          sourceActorRole: "groom",
          memoryKey: "venue:preferred_style",
          title: "선호 스타일",
          value: "모던",
        })],
        neutralContext,
      );
      const text = JSON.stringify(result.profiles);
      expect(text).not.toContain("신부");
      expect(text).not.toContain("신랑");
      expect(text).toContain("구성원 1");
      expect(text).toContain("구성원 2");
    });

    it("플래그가 없으면 기존 라벨 그대로다", () => {
      const result = projectAmoraProfiles([node({ sourceActorRole: "bride" })], context);
      expect(JSON.stringify(result.profiles)).toContain("신부 명시");
    });
  });
});
