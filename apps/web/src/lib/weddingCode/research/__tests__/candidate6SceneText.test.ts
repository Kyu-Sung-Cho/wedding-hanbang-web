import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, test } from "vitest";

import {
  CANDIDATE6_ITEM_REVIEW_FLAGS,
  CANDIDATE6_RESEARCH_ITEMS,
  type Candidate6ItemId,
} from "../candidate6";
import {
  CANDIDATE6_INTERLUDE_SENTENCES,
  CANDIDATE6_SCENE_TEXT,
  CANDIDATE6_SCENE_TEXT_VERSION,
  buildInviteCopyLine,
  deriveCardCandidates,
  interludeIndexes,
  sceneRhythmLabel,
} from "../candidate6SceneText";

const ITEM_IDS = CANDIDATE6_RESEARCH_ITEMS.map((item) => item.id);
const FLAGGED = Object.keys(CANDIDATE6_ITEM_REVIEW_FLAGS) as Candidate6ItemId[];

/**
 * 문항 원문 전체. 막간 문장이 여기 있는 **도메인 명사를 하나도 쓰지 않는지** 보는 데
 * 쓴다. 기획서 원안은 "막간 문장의 모든 명사가 해당 item 원문에 등장할 것"이었는데,
 * 막간은 특정 문항이 아니라 약속을 재진술하는 일반 문장이라 그 검사로는 자기 카피조차
 * 통과하지 못한다. 실제 위험은 "다음 문항을 프라이밍하는 새 사실"이므로, 도메인 명사
 * 부재로 뒤집어 검사한다 — 도메인 명사가 0개면 특정 문항을 가리킬 수 없다.
 */
const DOMAIN_NOUNS = [
  "업체", "후보", "기록", "사진", "영상", "예산", "총액", "취소", "계약",
  "일정", "담당", "마감", "축하", "예식", "장소", "비용", "사생활", "보관",
  "정리", "자료", "결정", "부모", "가족", "하객", "견적", "위약금",
] as const;

describe("장면 텍스트 상수", () => {
  it("버전이 고정돼 있다", () => {
    expect(CANDIDATE6_SCENE_TEXT_VERSION).toBe("scene-text.1");
  });

  it("21개 문항 전부에 항목이 있고, 문항에 없는 id는 없다", () => {
    expect(Object.keys(CANDIDATE6_SCENE_TEXT).sort()).toEqual([...ITEM_IDS].sort());
  });

  // rewrite/drop 판정 전인 4항목에는 우리 문장을 얹지 않는다. 회수 화면은 문항 원문
  // `scenario`를 그대로 렌더한다(recapLines === null). 폐기 예정 항목에 카피 비용을
  // 태우지 않고, 특히 DS3의 업체 서술을 우리 발화로 승격시키지 않기 위한 것이다.
  it("리뷰 플래그 4항목은 회수 문장도 카드도 없고, 나머지는 전부 있다", () => {
    for (const id of ITEM_IDS) {
      const entry = CANDIDATE6_SCENE_TEXT[id];
      if (FLAGGED.includes(id)) {
        expect(entry.card, `${id}는 판정 전이라 카드를 저작하지 않는다`).toBeNull();
        expect(entry.recapLines, `${id}는 scenario 원문을 렌더한다`).toBeNull();
      } else {
        expect(entry.card, `${id}에 카드가 없다`).not.toBeNull();
        expect(entry.recapLines, `${id}에 회수 문장이 없다`).not.toBeNull();
      }
    }
  });

  // scenario가 같은 쌍이 3개(ES/AS support-a·b·c)와 CP1/CP3에 있다. 회수 목록에서
  // 같은 제목이 두 번 나오면 사용자에게는 버그로 읽힌다. 그래서 제목은 scenario가
  // 아니라 그 문항의 behavior/anchor가 가리키는 차이에서 나와야 한다.
  it("장면 제목이 21개 전부 서로 다르다", () => {
    const titles = ITEM_IDS.map((id) => CANDIDATE6_SCENE_TEXT[id].sceneTitle);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("치수 상한을 지킨다 — 제목 12자, 회수 줄 15자, 카드 질문 30자", () => {
    for (const id of ITEM_IDS) {
      const entry = CANDIDATE6_SCENE_TEXT[id];
      expect(entry.sceneTitle.length, `${id} 제목이 12자 초과`).toBeLessThanOrEqual(12);
      expect(entry.recapLines?.length ?? 0, `${id} 회수 줄 수`).toBeLessThanOrEqual(3);
      for (const line of entry.recapLines ?? []) {
        expect(line.length, `${id} 회수 줄 "${line}"이 15자 초과`).toBeLessThanOrEqual(15);
      }
      if (entry.card) {
        expect(entry.card.prompt.length, `${id} 카드 질문이 30자 초과`).toBeLessThanOrEqual(30);
        expect(entry.card.prompt.endsWith("?"), `${id} 카드 질문은 물음표로 끝난다`).toBe(true);
      }
    }
  });

  // 기획서 §10 RED 9 목록 전체. 2026-07-28 감사가 도메인 민감어 5개(가족·하객·업체·
  // 견적·계약)가 조용히 빠져 있음을 지적했다. 이 fence의 존재 이유가 "나중에 문장을
  // 추가하는 사람이 업체·견적·계약을 회사 발화로 승격시키지 못하게"이고, 플래그 4항목
  // rewrite 시점이 정확히 그 시점이다. CLAUDE.md 확정 결정이 지목한 금액·부모도 넣는다.
  it("판정·측정 어휘와 도메인 민감어를 쓰지 않는다", () => {
    const banned =
      /점수|유형|궁합|overlap|정확도|희귀|상위|퍼센트|성공|이혼|검증됨|안전|위험|등급|가족|하객|업체|견적|계약|금액|부모/;
    for (const id of ITEM_IDS) {
      const entry = CANDIDATE6_SCENE_TEXT[id];
      const all = [entry.sceneTitle, ...(entry.recapLines ?? []), ...(entry.card
        ? [entry.card.prompt, entry.card.when, entry.card.action]
        : [])];
      for (const text of all) {
        expect(text, `${id}: "${text}"`).not.toMatch(banned);
      }
    }
  });

  // 시간 표현은 「10분 안에」가 요구되는 행동 필드에서만 허용한다. 다른 필드에 분·초가
  // 새면 "완료 시간 사전 추정" 금지에 인접한다.
  it("분·초 표기는 카드 행동 필드에서만 나온다", () => {
    for (const id of ITEM_IDS) {
      const entry = CANDIDATE6_SCENE_TEXT[id];
      const outsideAction = [entry.sceneTitle, ...(entry.recapLines ?? []), ...(entry.card
        ? [entry.card.prompt, entry.card.when]
        : [])];
      for (const text of outsideAction) {
        // 아라비아 숫자만 보면 「오 분만」·「십 분짜리」가 통과한다(2026-07-28 감사).
        // 기획서 §7 카피 덱의 예시 자신이 그 형태였다.
        expect(text, `${id}: "${text}"에 시간 표기`)
          .not.toMatch(/(\d+|[영일이삼사오육칠팔구십반몇])\s*(분|초|시간)/);
      }
    }
  });

  // 상대를 평가하거나 대리 개입을 제안하는 문장은 카드로 내보내면 관계 위해가 된다.
  it("카드가 상대 평가·대리 개입을 제안하지 않는다", () => {
    const banned = /대신 말해|편을 들|누가 더|잘못|탓|설득해/;
    for (const id of ITEM_IDS) {
      const card = CANDIDATE6_SCENE_TEXT[id].card;
      if (!card) continue;
      for (const text of [card.prompt, card.when, card.action]) {
        expect(text, `${id}: "${text}"`).not.toMatch(banned);
      }
    }
  });

  // 가사 성역할·운전 상황은 상대에게 특정 역할을 전제한다. relational 안의 원안에서
  // 의도적으로 제거한 항목이다.
  it("카드의 '언제'가 가사 성역할·운전을 전제하지 않는다", () => {
    const banned = /반찬|설거지|빨래|요리|운전|차 안/;
    for (const id of ITEM_IDS) {
      const card = CANDIDATE6_SCENE_TEXT[id].card;
      if (!card) continue;
      expect(card.when, `${id}: "${card.when}"`).not.toMatch(banned);
    }
  });
});

describe("막간 문장", () => {
  it("최대 3개이고 도메인 명사를 하나도 쓰지 않는다", () => {
    expect(CANDIDATE6_INTERLUDE_SENTENCES.length).toBeLessThanOrEqual(3);
    for (const sentence of CANDIDATE6_INTERLUDE_SENTENCES) {
      for (const noun of DOMAIN_NOUNS) {
        expect(sentence, `막간 "${sentence}"이 도메인 명사 "${noun}"을 쓴다`)
          .not.toContain(noun);
      }
    }
  });

  // 어느 anchor 쪽도 미리 밀어주면 Form A/B 위치편향 상쇄가 무력해진다.
  it("어떤 anchor 원문도 부분 포함하지 않는다", () => {
    // anchor는 bipolar-order 문항에만 있다. union을 좁히지 않으면 typecheck가 막는다.
    const anchors = CANDIDATE6_RESEARCH_ITEMS.flatMap((item) => [
      ...("leftAnchor" in item ? [item.leftAnchor] : []),
      ...("rightAnchor" in item ? [item.rightAnchor] : []),
    ]);
    for (const sentence of CANDIDATE6_INTERLUDE_SENTENCES) {
      for (const anchor of anchors) {
        expect(sentence).not.toContain(anchor);
      }
    }
  });
});

describe("막간 위치", () => {
  it("전 범위에서 최대 3개이고 마지막 장면과 인접하지 않는다", () => {
    for (let total = 8; total <= 21; total += 1) {
      const indexes = interludeIndexes(total);
      expect(indexes.length, `total=${total}`).toBeLessThanOrEqual(3);
      expect(new Set(indexes).size, `total=${total} 중복`).toBe(indexes.length);
      for (const index of indexes) {
        expect(index, `total=${total} 하한`).toBeGreaterThan(0);
        // 마지막 항목 **바로 앞**도 인접이다. total-2에 놓으면 막간 → 마지막 장면이
        // 되어 "잠깐 쉬어가라"가 "이제 끝"과 붙어버린다. 사이에 최소 한 장을 둔다.
        // (2026-07-28 변이 검증에서 `total - 2` 반환이 통과해 잡은 구멍이다.)
        expect(index, `total=${total} 마지막과 인접`).toBeLessThan(total - 2);
      }
      expect([...indexes], `total=${total} 정렬`).toEqual([...indexes].sort((a, b) => a - b));
    }
  });

  it("응답과 무관하게 같은 위치를 준다 — 같은 total이면 항상 동일", () => {
    expect(interludeIndexes(19)).toEqual(interludeIndexes(19));
    expect(interludeIndexes(21)).toEqual(interludeIndexes(21));
  });
});

describe("진행 리듬 라벨", () => {
  it("숫자가 아니라 말로 끝을 알린다", () => {
    expect(sceneRhythmLabel(0, 19)).toBe("첫 장면");
    expect(sceneRhythmLabel(3, 19)).toBe("장면 4");
    expect(sceneRhythmLabel(16, 19)).toBe("세 장 남았어요");
    expect(sceneRhythmLabel(17, 19)).toBe("다음이 마지막");
    expect(sceneRhythmLabel(18, 19)).toBe("마지막 한 장");
  });

  it("퍼센트·진행률 문자를 쓰지 않는다", () => {
    for (let total = 8; total <= 21; total += 1) {
      for (let index = 0; index < total; index += 1) {
        expect(sceneRhythmLabel(index, total)).not.toMatch(/%|\/|진행/);
      }
    }
  });
});

describe("카드 후보 파생", () => {
  const administered = ITEM_IDS.filter((id) => id !== "C6-SI1" && id !== "C6-SI2");

  it("투여된 항목에서 리뷰 플래그만 뺀 것과 정확히 같다", () => {
    expect(deriveCardCandidates(administered)).toEqual(
      administered.filter((id) => !FLAGGED.includes(id)),
    );
  });

  it("투여되지 않은 항목은 후보에 없다 — 끈 것이 되살아나지 않는다", () => {
    const candidates = deriveCardCandidates(administered);
    expect(candidates).not.toContain("C6-SI1");
    expect(candidates).not.toContain("C6-SI2");
  });

  it("journey 순서를 보존한다", () => {
    const reversed = [...administered].reverse();
    expect(deriveCardCandidates(reversed)).toEqual(
      reversed.filter((id) => !FLAGGED.includes(id)),
    );
  });

  it("응답·라벨을 인자로 받지 않는다", () => {
    expect(deriveCardCandidates.length).toBe(1);
  });
});

describe("초대 복사 문자열", () => {
  it("고른 문장 하나만 담고 URL·브랜드·장면 제목이 없다", () => {
    const card = CANDIDATE6_SCENE_TEXT["C6-JI3"].card;
    expect(card).not.toBeNull();
    const line = buildInviteCopyLine(card!.prompt);
    expect(line).toBe(card!.prompt);
    expect(line).not.toMatch(/http|hanbang|웨딩코드|한방/);
  });
});

/**
 * 상위 계약 준수 — `58_candidate6_product_research_contract_2026-07-17.md:163`
 * 「clipboard/native share/OG answer metadata 금지」.
 *
 * doc 58은 README §1 권위 순서 **2순위**이고, 이 기능의 기획서(63)는 권위 순서에
 * 등재조차 안 된 상태표 항목이라 §1-8 「위 문서와 충돌하면 사용하지 않음」이 적용된다.
 * 즉 기획서가 상위 계약을 이길 수 없다.
 *
 * 2026-07-29 2차 감사: 초대 화면이 `navigator.clipboard.writeText`를 신설해 이 조항을
 * 정면으로 위반했고, `62_..._current_state`가 「clipboard 없음」을 현재 사실로 적어둔
 * 문장까지 함께 거짓이 됐다. 클립보드는 zero-I/O 프로토타입에서 유일하게 남은 실제
 * 데이터 유출 경로다 — iOS 유니버설 클립보드·Windows 클라우드 클립보드는 기기 밖으로
 * 동기화된다. 계약을 개정하려면 파운더 결정과 doc 58·62 개정이 먼저다.
 */
test("연구 프로토타입이 clipboard·native share를 쓰지 않는다 (doc 58 계약)", async () => {
  // vitest root(apps/web) 기준. `new URL(..., import.meta.url)`은 Windows에서
  // `C:\src\...`로 잘못 풀린다(2026-07-29 실측).
  const files = ["Candidate6Prototype.tsx", "candidate6SceneText.ts"];
  for (const name of files) {
    const source = await readFile(
      path.resolve(process.cwd(), "src/lib/weddingCode/research", name),
      "utf8",
    );
    for (const banned of ["navigator.clipboard", "navigator.share", "execCommand"]) {
      assert.ok(
        !source.includes(banned),
        `${name}이 ${banned}를 쓴다 — doc 58:163이 금지한다`,
      );
    }
  }
});

/**
 * 2차 감사 M6: 회수 목록에서 **세로로 맞닿는 두 행**의 문장이 대부분 같으면, 이 설계가
 * 측정하려는 「알아봄」 대신 「기재가 찍어냈다」가 마지막 인상으로 남는다. 실제로 journey
 * 끝에 붙는 SI1·SI2가 3줄 중 2줄이 글자 그대로 같았다(원문 항목의 premise·prompt가
 * 동일한 탓이라 카피 실수가 아니었다).
 */
test("이웃한 회수 문장이 2줄 이상 겹치지 않는다", () => {
  const authored: Array<{ id: string; lines: readonly string[] }> = [];
  for (const id of ITEM_IDS) {
    const lines = CANDIDATE6_SCENE_TEXT[id].recapLines;
    if (lines !== null) authored.push({ id, lines });
  }
  assert.ok(authored.length > 10, "검사 대상이 없으면 공허하다");

  for (let index = 1; index < authored.length; index += 1) {
    const previous = authored[index - 1];
    const current = authored[index];
    const shared = current.lines.filter((line) => previous.lines.includes(line));
    assert.ok(
      shared.length < 2,
      `${previous.id}와 ${current.id}가 ${shared.length}줄 겹친다: ${shared.join(" / ")}`,
    );
  }
});
