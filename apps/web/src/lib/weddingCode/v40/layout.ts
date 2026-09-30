/**
 * 웨딩코드 4.0 배치 골격: 질문 68개의 id, 주제, 측면, 구간, 화면, 형식, 하위 종류, 키.
 *
 * 설계 배치 스크립트(design/workF/schedule2.js)가 만든 표를 그대로 옮겼다. 검사 오류 0건, 고정 응답과
 * 거울 위치 응답의 합이 언제나 0이라는 성질은 이 배치와 키 위에서만 성립한다. 문항 은행은 이 골격의 칸을 채우는 것이라
 * id, 순서, 구간, 화면, 형식, 하위 종류, 키를 바꾸지 못한다. 바꾸면 균형 시험이 깨지고 판을 올려야 한다.
 *
 * 배열 순서 = 질문 순서 = 링크 코드 순서(색인 i 는 코드의 i+1번 글자).
 * 채점 문항 64개는 구간 4개 x 화면 10개(화면 번호 section x 10 + 0에서 9), 자기 선택 4개는 화면 40, 41.
 * 구간 0과 2, 구간 1과 3은 (주제, 슬롯, 화면 위치)가 같은 거울이고 대응 문항의 키가 반대다.
 *
 * 하위 종류(kind): pair 는 구간 0, 2 = method (내 방식), 구간 1 = moment (어느 순간이 더 끌려요), 구간 3 = friends (친구 이야기).
 * react 는 구간 0, 2 = action (상대 행동), 구간 1, 3 = story (3인칭 사연).
 */
import type { ItemId, LayoutSlot } from "./types";

export const V40_LAYOUT: readonly LayoutSlot[] = [
  { id: "process.search.1", axis: "process", facet: "search", section: 0, screen: 0, pos: 0, fmt: "react", kind: "action", key: 1 },
  { id: "money.limit.1", axis: "money", facet: "limit", section: 0, screen: 0, pos: 1, fmt: "pair", kind: "method", key: 1 },
  { id: "process.owner.1", axis: "process", facet: "owner", section: 0, screen: 1, pos: 0, fmt: "pair", kind: "method", key: -1 },
  { id: "money.check.1", axis: "money", facet: "check", section: 0, screen: 1, pos: 1, fmt: "react", kind: "action", key: 1 },
  { id: "support.vent.1", axis: "support", facet: "vent", section: 0, screen: 2, pos: 0, fmt: "split", kind: null, key: -1 },
  { id: "scope.final.1", axis: "scope", facet: "final", section: 0, screen: 3, pos: 0, fmt: "pair", kind: "method", key: 1 },
  { id: "support.give.1", axis: "support", facet: "give", section: 0, screen: 3, pos: 1, fmt: "react", kind: "action", key: 1 },
  { id: "scope.circle.1", axis: "scope", facet: "circle", section: 0, screen: 4, pos: 0, fmt: "bestworst", kind: null, key: 1 },
  { id: "support.fight.1", axis: "support", facet: "fight", section: 0, screen: 5, pos: 0, fmt: "pair", kind: "method", key: -1 },
  { id: "scope.timing.1", axis: "scope", facet: "timing", section: 0, screen: 5, pos: 1, fmt: "recall", kind: null, key: -1 },
  { id: "process.report.1", axis: "process", facet: "report", section: 0, screen: 6, pos: 0, fmt: "bestworst", kind: null, key: -1 },
  { id: "money.worth.1", axis: "money", facet: "worth", section: 0, screen: 7, pos: 0, fmt: "instant", kind: null, key: -1 },
  { id: "support.recover.1", axis: "support", facet: "recover", section: 0, screen: 7, pos: 1, fmt: "recall", kind: null, key: 1 },
  { id: "money.moment.1", axis: "money", facet: "moment", section: 0, screen: 8, pos: 0, fmt: "split", kind: null, key: 1 },
  { id: "process.detail.1", axis: "process", facet: "detail", section: 0, screen: 9, pos: 0, fmt: "instant", kind: null, key: -1 },
  { id: "scope.form.1", axis: "scope", facet: "form", section: 0, screen: 9, pos: 1, fmt: "react", kind: "action", key: -1 },
  { id: "money.moment.2", axis: "money", facet: "moment", section: 1, screen: 10, pos: 0, fmt: "pair", kind: "moment", key: -1 },
  { id: "process.owner.2", axis: "process", facet: "owner", section: 1, screen: 10, pos: 1, fmt: "react", kind: "story", key: -1 },
  { id: "money.worth.2", axis: "money", facet: "worth", section: 1, screen: 11, pos: 0, fmt: "bestworst", kind: null, key: -1 },
  { id: "support.give.2", axis: "support", facet: "give", section: 1, screen: 12, pos: 0, fmt: "recall", kind: null, key: -1 },
  { id: "money.limit.2", axis: "money", facet: "limit", section: 1, screen: 12, pos: 1, fmt: "react", kind: "story", key: 1 },
  { id: "process.detail.2", axis: "process", facet: "detail", section: 1, screen: 13, pos: 0, fmt: "split", kind: null, key: 1 },
  { id: "scope.final.2", axis: "scope", facet: "final", section: 1, screen: 14, pos: 0, fmt: "react", kind: "story", key: 1 },
  { id: "support.vent.2", axis: "support", facet: "vent", section: 1, screen: 14, pos: 1, fmt: "pair", kind: "moment", key: -1 },
  { id: "scope.timing.2", axis: "scope", facet: "timing", section: 1, screen: 15, pos: 0, fmt: "split", kind: null, key: 1 },
  { id: "money.check.2", axis: "money", facet: "check", section: 1, screen: 16, pos: 0, fmt: "recall", kind: null, key: -1 },
  { id: "support.fight.2", axis: "support", facet: "fight", section: 1, screen: 16, pos: 1, fmt: "react", kind: "story", key: 1 },
  { id: "scope.form.2", axis: "scope", facet: "form", section: 1, screen: 17, pos: 0, fmt: "instant", kind: null, key: -1 },
  { id: "process.report.2", axis: "process", facet: "report", section: 1, screen: 17, pos: 1, fmt: "pair", kind: "moment", key: 1 },
  { id: "support.recover.2", axis: "support", facet: "recover", section: 1, screen: 18, pos: 0, fmt: "bestworst", kind: null, key: 1 },
  { id: "process.search.2", axis: "process", facet: "search", section: 1, screen: 19, pos: 0, fmt: "instant", kind: null, key: 1 },
  { id: "scope.circle.2", axis: "scope", facet: "circle", section: 1, screen: 19, pos: 1, fmt: "pair", kind: "moment", key: -1 },
  { id: "process.report.3", axis: "process", facet: "report", section: 2, screen: 20, pos: 0, fmt: "react", kind: "action", key: -1 },
  { id: "money.worth.3", axis: "money", facet: "worth", section: 2, screen: 20, pos: 1, fmt: "pair", kind: "method", key: -1 },
  { id: "process.detail.3", axis: "process", facet: "detail", section: 2, screen: 21, pos: 0, fmt: "pair", kind: "method", key: 1 },
  { id: "money.moment.3", axis: "money", facet: "moment", section: 2, screen: 21, pos: 1, fmt: "react", kind: "action", key: -1 },
  { id: "support.give.3", axis: "support", facet: "give", section: 2, screen: 22, pos: 0, fmt: "split", kind: null, key: 1 },
  { id: "scope.timing.3", axis: "scope", facet: "timing", section: 2, screen: 23, pos: 0, fmt: "pair", kind: "method", key: -1 },
  { id: "support.vent.3", axis: "support", facet: "vent", section: 2, screen: 23, pos: 1, fmt: "react", kind: "action", key: -1 },
  { id: "scope.form.3", axis: "scope", facet: "form", section: 2, screen: 24, pos: 0, fmt: "bestworst", kind: null, key: -1 },
  { id: "support.recover.3", axis: "support", facet: "recover", section: 2, screen: 25, pos: 0, fmt: "pair", kind: "method", key: 1 },
  { id: "scope.final.3", axis: "scope", facet: "final", section: 2, screen: 25, pos: 1, fmt: "instant", kind: null, key: 1 },
  { id: "process.search.3", axis: "process", facet: "search", section: 2, screen: 26, pos: 0, fmt: "bestworst", kind: null, key: 1 },
  { id: "money.limit.3", axis: "money", facet: "limit", section: 2, screen: 27, pos: 0, fmt: "recall", kind: null, key: 1 },
  { id: "support.fight.3", axis: "support", facet: "fight", section: 2, screen: 27, pos: 1, fmt: "instant", kind: null, key: -1 },
  { id: "money.check.3", axis: "money", facet: "check", section: 2, screen: 28, pos: 0, fmt: "split", kind: null, key: -1 },
  { id: "process.owner.3", axis: "process", facet: "owner", section: 2, screen: 29, pos: 0, fmt: "recall", kind: null, key: 1 },
  { id: "scope.circle.3", axis: "scope", facet: "circle", section: 2, screen: 29, pos: 1, fmt: "react", kind: "action", key: 1 },
  { id: "money.check.4", axis: "money", facet: "check", section: 3, screen: 30, pos: 0, fmt: "pair", kind: "friends", key: 1 },
  { id: "process.detail.4", axis: "process", facet: "detail", section: 3, screen: 30, pos: 1, fmt: "react", kind: "story", key: 1 },
  { id: "money.limit.4", axis: "money", facet: "limit", section: 3, screen: 31, pos: 0, fmt: "bestworst", kind: null, key: 1 },
  { id: "support.vent.4", axis: "support", facet: "vent", section: 3, screen: 32, pos: 0, fmt: "instant", kind: null, key: 1 },
  { id: "money.worth.4", axis: "money", facet: "worth", section: 3, screen: 32, pos: 1, fmt: "react", kind: "story", key: -1 },
  { id: "process.owner.4", axis: "process", facet: "owner", section: 3, screen: 33, pos: 0, fmt: "split", kind: null, key: -1 },
  { id: "scope.timing.4", axis: "scope", facet: "timing", section: 3, screen: 34, pos: 0, fmt: "react", kind: "story", key: -1 },
  { id: "support.give.4", axis: "support", facet: "give", section: 3, screen: 34, pos: 1, fmt: "pair", kind: "friends", key: 1 },
  { id: "scope.final.4", axis: "scope", facet: "final", section: 3, screen: 35, pos: 0, fmt: "split", kind: null, key: -1 },
  { id: "money.moment.4", axis: "money", facet: "moment", section: 3, screen: 36, pos: 0, fmt: "instant", kind: null, key: 1 },
  { id: "support.recover.4", axis: "support", facet: "recover", section: 3, screen: 36, pos: 1, fmt: "react", kind: "story", key: -1 },
  { id: "scope.circle.4", axis: "scope", facet: "circle", section: 3, screen: 37, pos: 0, fmt: "recall", kind: null, key: 1 },
  { id: "process.search.4", axis: "process", facet: "search", section: 3, screen: 37, pos: 1, fmt: "pair", kind: "friends", key: -1 },
  { id: "support.fight.4", axis: "support", facet: "fight", section: 3, screen: 38, pos: 0, fmt: "bestworst", kind: null, key: -1 },
  { id: "process.report.4", axis: "process", facet: "report", section: 3, screen: 39, pos: 0, fmt: "recall", kind: null, key: -1 },
  { id: "scope.form.4", axis: "scope", facet: "form", section: 3, screen: 39, pos: 1, fmt: "pair", kind: "friends", key: 1 },
  // 마지막 정리: 자기 선택(채점 제외). 화면 40은 돈과 준비, 화면 41은 정하는 사람과 지쳤을 때. 키는 2:2.
  { id: "self.money", axis: "money", facet: null, section: 4, screen: 40, pos: 0, fmt: "self", kind: null, key: 1 },
  { id: "self.process", axis: "process", facet: null, section: 4, screen: 40, pos: 1, fmt: "self", kind: null, key: -1 },
  { id: "self.scope", axis: "scope", facet: null, section: 4, screen: 41, pos: 0, fmt: "self", kind: null, key: -1 },
  { id: "self.support", axis: "support", facet: null, section: 4, screen: 41, pos: 1, fmt: "self", kind: null, key: 1 },
];

/** 문항 id -> 골격 칸. */
export const V40_LAYOUT_BY_ID: ReadonlyMap<ItemId, LayoutSlot> = new Map(V40_LAYOUT.map((slot) => [slot.id, slot]));

/** 질문 화면 42개의 문항 id(화면 번호 = 색인). */
export const V40_LAYOUT_SCREENS: readonly (readonly ItemId[])[] = (() => {
  const screens: ItemId[][] = [];
  for (const slot of V40_LAYOUT) {
    if (!screens[slot.screen]) screens[slot.screen] = [];
    screens[slot.screen].push(slot.id);
  }
  return screens;
})();
