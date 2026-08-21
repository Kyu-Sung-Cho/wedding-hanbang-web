import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";

/**
 * 체크리스트 항목 밑에 붙는 한 줄 안내(`note`)의 계약.
 *
 * 이 파일은 note 문구를 **한 줄도 쓰기 전에** 먼저 만들었다. 2026-08-11에 예절 가이드에서
 * 감사자의 `fix` 필드를 그대로 넣었다가 "해당 셀을 교체:" 같은 **편집 지시문**이 제품
 * 화면까지 나간 적이 있다. 5차 감사와 사람 정독을 통과했는데도 살아남았다. 그때의 교훈은
 * 특정 문구를 막는 게 아니라 **지시문의 문법**을 막아야 한다는 것이라, 여기서는 어휘가
 * 아니라 어미와 대상을 본다.
 */
describe("체크리스트 항목 안내 문구", () => {
  const notes = CATEGORY_CHECKLISTS.flatMap((category) =>
    category.items
      .filter((item) => item.note !== undefined)
      .map((item) => ({ where: `${category.key}/${item.id}`, label: item.label, note: item.note! })),
  );

  /**
   * 사용자에게 하는 말은 존댓말로 끝난다. 편집자에게 하는 지시("…교체한다", "…넣을 것")는
   * 이 어미를 쓰지 않는다. 어휘 목록과 달리 새로 지어낸 지시문도 같이 걸린다.
   */
  const POLITE_ENDING = /(요|죠)\.$/;

  /** 지시문이 가리키는 대상은 결혼 준비가 아니라 문서 자체다. */
  const EDITORIAL_TARGET =
    /(셀|행|열|칸|문단|본문|제목|캡션|표|줄|문장|항목)(을|를|는|은|이|가|에|의)?\s*(교체|수정|삭제|추가|변경|대체|바꾸|넣|빼|고치)/;

  it("문구가 실제로 실려 있다", () => {
    expect(notes.length).toBeGreaterThan(0);
  });

  it("사용자에게 하는 말투로 끝난다 — 편집 지시문은 여기서 걸린다", () => {
    const wrong = notes.filter((n) => !POLITE_ENDING.test(n.note));
    expect(wrong.map((n) => `${n.where}: ${n.note}`)).toEqual([]);
  });

  it("문서 자체를 고치라는 말이 들어 있지 않다", () => {
    const leaked = notes.filter((n) => EDITORIAL_TARGET.test(n.note));
    expect(leaked.map((n) => `${n.where}: ${n.note}`)).toEqual([]);
  });

  /**
   * 금액·기간 수치와 법령명은 업체·계약마다 다르다. 틀린 숫자는 안내가 아니라 사고다.
   * "얼마"가 아니라 **무엇을 물어야 하는지**만 쓴다.
   */
  it("숫자와 법령 이름을 말하지 않는다", () => {
    const NUMERIC = /[0-9]|[일이삼사오육칠팔구십백천만억]\s*(원|만원|퍼센트|%|일|주|개월|년)/;
    const STATUTE = /법률|시행령|시행규칙|민법|약관법|제\s*\d+\s*조/;
    const bad = notes.filter((n) => NUMERIC.test(n.note) || STATUTE.test(n.note));
    expect(bad.map((n) => `${n.where}: ${n.note}`)).toEqual([]);
  });

  /** 예절 가이드에서 걷어낸 강압 문구가 체크리스트로 다시 들어오지 않게 한다. */
  it("강요하거나 단정하지 않는다", () => {
    const COERCION = /반드시|무조건|절대|필수(입니다|예요|다)|해야만|당연히|기본 예의/;
    const JUDGEMENT = /(최고|최상)(의|예요|입니다)|보장(합니다|해|돼요)|1위/;
    const bad = notes.filter((n) => COERCION.test(n.note) || JUDGEMENT.test(n.note));
    expect(bad.map((n) => `${n.where}: ${n.note}`)).toEqual([]);
  });

  it("라벨을 그대로 되풀이하지 않는다", () => {
    const echo = notes.filter((n) => n.note.includes(n.label));
    expect(echo.map((n) => `${n.where}: ${n.note}`)).toEqual([]);
  });

  it("한 줄에 들어가는 길이다", () => {
    const off = notes.filter((n) => n.note.length < 20 || n.note.length > 80);
    expect(off.map((n) => `${n.where}: ${n.note.length}자 — ${n.note}`)).toEqual([]);
  });

  it("줄바꿈이나 마크다운 기호가 섞이지 않았다", () => {
    const RAW = /\n|\*\*|^\s*[-*+]\s|^\s*#{1,6}\s|\[[^\]]+\]\([^)]+\)/;
    const bad = notes.filter((n) => RAW.test(n.note));
    expect(bad.map((n) => `${n.where}: ${n.note}`)).toEqual([]);
  });

  /**
   * **어느 항목이 안내를 가져야 하는가.**
   *
   * 위 검사들은 쓰인 문구가 올바른지만 본다. 그래서 안내 58개가 실릴 때까지도 *어디에*
   * 실릴지는 코드 어디에도 없었고, 결과는 분야마다 네 개씩이었다. 그렇게 채우면 건너뛰어도
   * 그만인 전통 항목은 차고 정작 계약금이 걸린 자리는 빈다 — 실제로 사진 촬영은 아홉 중
   * 하나였다.
   *
   * 기준은 분야 균형이 아니라 **되돌릴 수 있는가**다. 후보를 비교하는 걸음은 마음이 바뀌면
   * 되돌리면 되지만, 확정하고 주문하고 계약하는 걸음은 그 뒤로 돈이 묶인다. 그 자리에서
   * 묻지 않은 한 가지는 나중에 물어도 소용이 없다.
   *
   * 라벨의 동사로 판별해서 **항목이 새로 늘어도 저절로 걸리게** 한다. 목록을 손으로 적으면
   * 다음에 추가되는 항목은 아무도 모르게 빠진다.
   */
  it("되돌릴 수 없는 걸음에는 안내가 붙어 있다", () => {
    const POINT_OF_NO_RETURN = /확정|주문|계약|발송|납부|결제|서명/;

    const irreversible = CATEGORY_CHECKLISTS.flatMap((category) =>
      category.items
        .filter((item) => POINT_OF_NO_RETURN.test(item.label))
        .map((item) => ({ where: `${category.key}/${item.id}`, label: item.label, note: item.note })),
    );

    // 판별식이 아무것도 못 고르면 이 검사는 늘 통과한다. 먼저 실제로 고르는지 본다.
    expect(irreversible.length).toBeGreaterThan(15);

    const bare = irreversible.filter((item) => item.note === undefined);
    expect(bare.map((item) => `${item.where}: ${item.label}`)).toEqual([]);
  });
});
