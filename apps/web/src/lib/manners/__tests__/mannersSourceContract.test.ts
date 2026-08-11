import { describe, expect, it } from "vitest";

import { MANNERS_CATEGORIES, MANNERS_PARTS } from "../data";
import { claimsNumbers, mannersTables } from "../types";

/**
 * 이 테스트가 예절 안내를 되살릴 수 있게 해 준 조건이다.
 *
 * 삭제된 원본은 금액 61건·법률 26건을 **출처 0건**으로 주장했다. 같은 데이터를 그냥
 * 되돌리면 같은 이유로 또 지워야 한다. 그래서 되살리는 대신 계약을 만들었고,
 * 여기서 그 계약을 강제한다. 이 단언들을 약화시키면 복원의 근거가 사라진다.
 *
 * ⚠️ 삭제된 라우트의 부활 방지 가드
 * (`src/lib/etiquette/__tests__/publicEtiquetteSafety.test.ts`)는 **유지 대상이다.**
 * 2026-08-11 제품 계약은 이 표면을 독립 가이드로 승인했지만, 표 단위 근거와 시효를
 * 강제하는 이 계약을 통과하는 경우에만 공개할 수 있다.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// 관행은 시간이 지나면 달라진다. 확인일이 없거나 미래면 신뢰할 수 없다.
// 편집·검토 기준일은 서비스 운영 시간대(KST)다. UTC 자정 전후에 그날 확인한
// 출처가 "미래"로 오판되는 것을 막는다(한국은 DST가 없어 항상 UTC+9).
const TODAY = new Date(Date.now() + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
const MAX_SOURCE_AGE_DAYS = 366;

// 개인 블로그·카페는 1차 출처가 아니다. 삭제 사유의 절반이 근거 없는 수치였다.
const NOT_A_SOURCE = /(^|\.)(blog|cafe|tistory|naver\.me|brunch|velog|medium)\./i;

// 견적·시세·업체에 판정하지 않는다는 제품 계약은 예절 안내에도 그대로 적용된다.
// 품질 판정만 막는다. "일 최고 체감온도 33℃"(기상청 폭염주의보 기준)나 "최고음"처럼
// 사실을 그대로 옮긴 표현까지 막으면 공공 기준을 왜곡 인용해야 한다.
/**
 * 막는 것은 **우리가 내리는 판정**이다. 낱말 자체가 아니다.
 *
 * 제품 계약은 "품질·적정성·안전성을 점수, 등급, 최고, 보장으로 판정하지 않는다"고
 * 말한다. 사실을 그대로 옮긴 것은 판정이 아니다 — 오히려 막으면 공공 기준과 조사
 * 결과를 왜곡 인용해야 한다. 실제로 걸렸던 것들:
 *   "일 최고 체감온도 33℃ 이상"  기상청 폭염주의보 발표 기준
 *   "최고음"                      축가 노래의 가장 높은 음
 *   "설문 1위"                    인크루트 조사 결과 보고
 *   "포장 등급"                   상품 사양
 *   "인원 제한은 관계의 등급이 아닙니다"  판정을 **부정**하는 문장
 */
const JUDGEMENT = new RegExp(
  [
    "(최고|최상)(의|예요|입니다|이에요|\\s*(품질|업체|서비스|선택))",
    "(업계|국내|시장|전국)\\s*1위",
    "1위\\s*(업체|브랜드|업소)",
    "보장합니다|보장해",
    "반드시 성공|성공률",
    "등급을 매|등급 평가|[A-E1-5]\\s*등급",
    "점수를 매",
  ].join("|"),
);

/**
 * 페이지가 자기 한계를 말하는가.
 *
 * 처음에는 "지역·집안마다 다르다"만 받았는데, 혼인신고처럼 **전국이 같은 절차**인
 * 내용에까지 편차를 요구하면 오히려 잘못된 안내가 된다. 그래서 한계 신호를 둘로 본다 —
 * 편차(사람마다 다름) 또는 시효·확인(바뀔 수 있음 / 담당 기관에 확인).
 */
const STATES_ITS_LIMITS = new RegExp(
  [
    // 편차 — 사람·집안·지역마다 다르다
    "다릅니다|다를 수|달라|마다|지역|집안|모임|상황에 따라",
    // 시효·확인 — 바뀔 수 있으니 직접 확인하라
    "바뀔 수|변경될 수|확인해|확인하세|조사 시점",
    // 지위 — 정답·공식 기준·법률 자문이 "아니다". 한국어 부정 어미를 전부 받는다.
    "정답|아니라|아니고|아니며|아닌|아닙니다|찾지 못",
    // 성격 — 관행·참고일 뿐이다
    "관행|참고",
  ].join("|"),
);

describe("결혼 예절 안내 데이터 계약", () => {
  it("파트가 실제로 실려 있다", () => {
    expect(MANNERS_PARTS.length).toBeGreaterThan(0);
  });

  it("슬러그는 고유하고 지워진 라우트 이름을 다시 쓰지 않는다", () => {
    const slugs = MANNERS_PARTS.map((part) => part.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      // publicEtiquetteSafety 가드가 모바일 소스 전역에서 이 낱말을 막는다.
      // 여기서 먼저 막아야 앱에 연결할 때 조용히 깨지지 않는다.
      expect(slug).not.toMatch(/etiquette/i);
    }
  });

  it("모든 파트가 '정답이 아니다'를 먼저 말한다", () => {
    for (const part of MANNERS_PARTS) {
      expect(part.caveat.length, `${part.slug}: caveat 없음`).toBeGreaterThan(10);
      expect(
        STATES_ITS_LIMITS.test(part.caveat),
        `${part.slug}: caveat가 한계를 알리지 않는다 — "${part.caveat}"`,
      ).toBe(true);
    }
  });

  it("예시 대사가 있다 — 이 안내의 값은 추상적 조언이 아니라 할 수 있는 말이다", () => {
    for (const part of MANNERS_PARTS) {
      const lines = part.sections
        .flatMap((section) => section.blocks)
        .filter((block) => block.kind === "dialogue")
        .flatMap((block) => (block.kind === "dialogue" ? block.lines : []));
      expect(lines.length, `${part.slug}: dialogue 블록이 없다`).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.say.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("수치를 주장하는 파트는 출처를 대거나 출처 없음을 표시한다", () => {
    for (const part of MANNERS_PARTS) {
      if (!claimsNumbers(part)) continue;
      const tables = mannersTables(part);
      for (const table of tables) {
        expect(
          table.unsourced === true || (table.sourceRefs?.length ?? 0) > 0,
          `${part.slug} / "${table.title}": 이 표를 직접 뒷받침하는 sourceRefs가 없다`,
        ).toBe(true);
        if (table.unsourced) {
          expect(table.sourceRefs ?? [], `${part.slug} / "${table.title}": 출처 없음 표에 출처 참조가 붙었다`).toEqual([]);
        } else {
          expect(new Set(table.sourceRefs).size, `${part.slug} / "${table.title}": sourceRefs 중복`).toBe(table.sourceRefs?.length);
          for (const ref of table.sourceRefs ?? []) {
            expect(Number.isInteger(ref) && ref >= 1 && ref <= part.sources.length, `${part.slug} / "${table.title}": 잘못된 sourceRef ${ref}`).toBe(true);
          }
        }
        // 표는 언제나 "이건 관행"이라고 자기 밑에 적는다. 헤더 한 번으로 안 된다 —
        // 사용자는 표만 캡처해서 옮긴다.
        expect(table.caption.length, `${part.slug} / "${table.title}": caption 없음`).toBeGreaterThan(10);
        expect(
          STATES_ITS_LIMITS.test(table.caption),
          `${part.slug} / "${table.title}": caption이 한계를 말하지 않는다 — "${table.caption}"`,
        ).toBe(true);
        // 기준 시점은 표 안에 있어야 한다. 각주에만 두면 캡처해 옮긴 표에는 안 따라간다.
        expect(
          /\d{4}/.test(table.asOf),
          `${part.slug} / "${table.title}": asOf에 연도가 없다 — "${table.asOf}"`,
        ).toBe(true);
        // 출처가 완벽해도 대표성 한계를 안 말하면 잘못된 기준을 준다.
        // (참가격 1인당 식대 중간가격 58,000원 — 조사에 호텔·특급 예식장 구분이 없다)
        expect(
          table.limits.trim().length,
          `${part.slug} / "${table.title}": 이 숫자가 말하지 않는 것이 비어 있다`,
        ).toBeGreaterThan(15);
        expect(table.rows.every((row) => row.length === table.columns.length)).toBe(true);
      }
    }
  });

  it("출처는 열 수 있는 1차 자료이고 확인일이 붙어 있다", () => {
    for (const part of MANNERS_PARTS) {
      for (const source of part.sources) {
        expect(source.label.trim().length, `${part.slug}: 출처 이름 없음`).toBeGreaterThan(0);
        expect(source.url, `${part.slug}: ${source.url}`).toMatch(/^https:\/\//);
        expect(
          NOT_A_SOURCE.test(new URL(source.url).hostname),
          `${part.slug}: 블로그·카페는 출처가 아니다 — ${source.url}`,
        ).toBe(false);
        expect(source.checkedAt, `${part.slug}: 확인일 형식`).toMatch(ISO_DATE);
        expect(
          source.checkedAt <= TODAY,
          `${part.slug}: 확인일이 미래다 — ${source.checkedAt}`,
        ).toBe(true);
        const ageDays = (Date.parse(TODAY) - Date.parse(source.checkedAt)) / 86_400_000;
        expect(
          ageDays <= MAX_SOURCE_AGE_DAYS,
          `${part.slug}: 출처 확인일이 ${Math.floor(ageDays)}일 전이다 — 다시 검토할 것`,
        ).toBe(true);
        expect(source.scope.trim().length, `${part.slug}: 적용 범위 없음`).toBeGreaterThan(0);
        // 진짜 URL을 붙였는데 그 페이지가 주장을 말하지 않는 것이 가장 흔한 실패다.
        expect(
          source.supports.trim().length,
          `${part.slug}: ${source.url} 이 무엇을 뒷받침하는지 안 적혀 있다`,
        ).toBeGreaterThan(15);
      }
    }
  });

  it("주거 계약과 관계 안전 가이드는 공식 출처 없이 공개하지 않는다", () => {
    for (const slug of ["money-home-conversation", "planning-conflicts"]) {
      const part = MANNERS_PARTS.find((candidate) => candidate.slug === slug);
      expect(part, `${slug}: 파트 없음`).toBeDefined();
      expect(part?.sources.length, `${slug}: 고위험 안내에 출처 없음`).toBeGreaterThan(0);
      for (const source of part?.sources ?? []) {
        expect(new URL(source.url).hostname, `${slug}: 공공기관 출처가 아님`).toMatch(
          /(?:^|\.)(?:go\.kr|or\.kr)$/,
        );
      }
    }
  });

  it("판정하지 않는다", () => {
    for (const part of MANNERS_PARTS) {
      const text = JSON.stringify(part);
      const hit = text.match(JUDGEMENT);
      expect(hit, `${part.slug}: 판정 표현 "${hit?.[0]}"`).toBeNull();
    }
  });

  /**
   * 본문 위생 — 아래 셋은 전부 **실제로 한 번씩 났던 사고**다.
   *
   * 계약 테스트가 출처·시점·한계의 *존재*만 검사하는 동안, 본문에 무엇이 들어갔는지는
   * 아무도 보지 않았다. 그 사이에 편집 지시문이 사용자 화면까지 나갔고(2026-08-11 발견),
   * 문장이 중복되거나 어미가 겹쳐 깨진 곳도 있었다. 사람 눈으로 잡았지만 다음 파트를
   * 추가할 때 또 눈에만 기댈 수는 없다.
   */
  const contentStrings = (): { where: string; text: string }[] =>
    MANNERS_PARTS.flatMap((part) => [
      { where: `${part.slug}/caveat`, text: part.caveat },
      { where: `${part.slug}/description`, text: part.description },
      ...part.sections.flatMap((section) =>
        section.blocks.flatMap((block) => {
          const at = (label: string) => `${part.slug}/${section.heading}/${label}`;
          if (block.kind === "paragraph") return [{ where: at("문단"), text: block.text }];
          if (block.kind === "dialogue") {
            return block.lines.flatMap((line) => [
              { where: at("대사"), text: line.say },
              ...(line.note ? [{ where: at("대사 주석"), text: line.note }] : []),
            ]);
          }
          if (block.kind === "table") {
            return [
              { where: at(`표 ${block.title}`), text: block.caption },
              { where: at(`표 ${block.title}/한계`), text: block.limits },
              ...block.rows.flatMap((row) =>
                row.map((cell) => ({ where: at(`표 ${block.title}/셀`), text: cell })),
              ),
            ];
          }
          return block.items.map((item) => ({ where: at(block.kind), text: item }));
        }),
      ),
    ]);

  it("편집 지시문이 본문에 새어 들어가지 않는다", () => {
    /**
     * 이 가드는 **두 번 뚫렸다.** 처음엔 "(이 항목 수정)"만 막았는데, 그 뒤 감사 결과를
     * 일괄 적용하면서 아홉 건이 더 새어 들어갔고 전부 통과했다 — 형태가 제각각이었기 때문이다.
     *
     *   "해당 셀을 다음으로 교체: …"        "note를 교체: …"
     *   "warning 항목을 교체: …"            "tip \"…\"에 항목 추가: …"
     *   "기존 항목 뒤에 다음 항목을 추가하세요 — …"
     *   "say: \"…\" / note: \"…\""          (직렬화 원본이 통째로)
     *   "{\"kind\": \"warning\", \"items\": [ …"  (raw JSON)
     *
     * 그래서 특정 문구가 아니라 **지시문의 문법**을 막는다 — 편집 대상을 가리키는 말
     * (필드명·블록종류·인덱스), 명령형 어미(교체/추가하세요), 직렬화 흔적(JSON·`필드:`).
     *
     * ⚠️ 오탐 주의: "…로 바꾸세요"는 사용자에게 하는 정상 조언이다("이렇게 말고 저렇게
     * 말해보세요"). 그래서 '바꾸세요' 단독은 막지 않고, **편집 대상 지시와 함께 올 때만** 잡는다.
     */
    const TARGET = "(?:항목|셀|블록|문단|note|say|title|items|caption|tip|warning|checklist|dialogue|표)";
    const EDITOR_NOTE = new RegExp(
      [
        `${TARGET}\\s*(?:을|를|에)?\\s*(?:다음으로\\s*)?(?:교체|추가|삭제)(?:하세요|할 것|합니다|:|：)`,
        "(?:다음으로|아래처럼|아래와 같이)\\s*(?:교체|바꾸|추가)",
        "기존 항목 뒤에|마지막에 다음|맨 앞에 추가|블록으로 추가|블록 신설",
        "\\(이 항목|\\(뒤에 항목|\\(앞에 항목|대체 문장|대체안\\s*[:：]|▶\\s*대체",
        // 직렬화 흔적 — 렌더 필드 안에 데이터 구조가 들어온 경우
        '\\{\\s*"kind"\\s*:|"items"\\s*:\\s*\\[|^\\s*(?:say|note|kind|title|items)\\s*[:：]\\s*"',
        // 코드 좌표
        "items\\[\\d|blocks\\[\\d|sections\\[\\d|rows\\[\\d",
      ].join("|"),
      "m",
    );
    for (const { where, text } of contentStrings()) {
      const hit = text.match(EDITOR_NOTE);
      expect(hit, `${where}: 편집 지시문 "${hit?.[0]}" — ${text.slice(0, 70)}`).toBeNull();
    }
  });

  it("각 필드가 스키마가 약속한 종류의 내용을 담는다", () => {
    // 위 사고들의 공통 원인: 짧은 라벨 자리에 문단이, 대사 자리에 데이터 구조가 들어왔다.
    // 길이만 봐도 그 클래스가 잡힌다.
    for (const part of MANNERS_PARTS) {
      for (const section of part.sections) {
        expect(section.heading.length, `${part.slug}: 섹션 제목이 너무 김 — ${section.heading.slice(0, 40)}`)
          .toBeLessThan(80);
        for (const block of section.blocks) {
          if ("title" in block && block.title) {
            expect(block.title.length, `${part.slug}/${block.kind}: 블록 제목이 문단 길이 — ${block.title.slice(0, 40)}`)
              .toBeLessThan(90);
          }
          if (block.kind === "dialogue") {
            for (const line of block.lines) {
              // 대사는 사람이 실제로 하는 말이다. 두 문단짜리 대사는 대사가 아니다.
              expect(line.say.length, `${part.slug}: 대사가 너무 김 — ${line.say.slice(0, 40)}`).toBeLessThan(220);
            }
          }
          if (block.kind === "table") {
            for (const column of block.columns) {
              expect(column.length, `${part.slug}/${block.title}: 열 제목이 너무 김`).toBeLessThan(60);
            }
          }
        }
      }
    }
  });

  it("한 블록 안에서 같은 문장을 반복하지 않는다", () => {
    for (const { where, text } of contentStrings()) {
      const sentences = text
        .split(/(?<=[.!?다])\s+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 18);
      const seen = new Set<string>();
      // 완전히 같은 문장뿐 아니라 **거의 같은** 문장도 잡는다.
      // 실제 사고: 같은 초상권 문장이 어미만 다르게("…갖고, 이러한" / "…갖는다") 두 번
      // 들어갔고, 두 번째 쪽은 판결 원문과 다른 각색이었는데 완전 일치 검사만으로는
      // 통과했다. 앞 30자가 겹치면 사람 눈에는 같은 문장이 두 번 찍힌 것으로 보인다.
      const heads = new Set<string>();
      for (const sentence of sentences) {
        expect(seen.has(sentence), `${where}: 문장 반복 — "${sentence.slice(0, 50)}"`).toBe(false);
        seen.add(sentence);
        const head = sentence.slice(0, 30);
        expect(heads.has(head), `${where}: 거의 같은 문장 반복 — "${head}…"`).toBe(false);
        heads.add(head);
      }
    }
  });

  it("렌더되지 않는 마크다운을 쓰지 않는다", () => {
    // MannersPartView는 문자열을 그대로 출력한다. 마크다운 파서가 없다.
    // `**강조**`를 쓰면 사용자 화면에 별표가 그대로 보인다(2026-08-11에 실제로 3건 있었다).
    // 강조가 필요하면 문장 구조로 하거나 블록 종류(tip/warning)로 표현한다.
    const RAW_MARKDOWN = /\*\*|^\s*[-*+]\s|^\s*#{1,6}\s|\[[^\]]+\]\([^)]+\)/m;
    for (const { where, text } of contentStrings()) {
      const hit = text.match(RAW_MARKDOWN);
      expect(hit, `${where}: 렌더 안 되는 마크다운 "${hit?.[0]}" — ${text.slice(0, 60)}`).toBeNull();
    }
  });

  it("치환으로 문장이 깨진 흔적이 없다", () => {
    // 실제 사고: "…수수료는 방문, 우편 (인터넷 신청 없음). …않습니다입니다."
    const BROKEN = /입니다입니다|습니다습니다|다\.다\.|\(\s*\)|\)\s*\)|[가-힣] {2,}[가-힣]/;
    for (const { where, text } of contentStrings()) {
      const hit = text.match(BROKEN);
      expect(hit, `${where}: 문장 파손 "${hit?.[0]}" — ${text.slice(0, 60)}`).toBeNull();
      expect(text, `${where}: 앞뒤 공백`).toBe(text.trim());
    }
  });

  it("카테고리는 실재하는 파트만 가리킨다", () => {
    const slugs = new Set(MANNERS_PARTS.map((part) => part.slug));
    const grouped = MANNERS_CATEGORIES.flatMap((category) => category.slugs);
    for (const slug of grouped) {
      expect(slugs.has(slug), `카테고리가 없는 파트를 가리킨다: ${slug}`).toBe(true);
    }
    // 어느 카테고리에도 안 들어간 파트는 화면에서 도달할 수 없다.
    for (const slug of slugs) {
      expect(grouped.includes(slug), `카테고리에 없는 파트: ${slug}`).toBe(true);
    }
  });
});
