/**
 * 체크리스트 항목을 **단계로 묶고**, 몇 개에 표시를 단다.
 *
 * ## 왜 별도 파일인가
 *
 * `weddingPlanning.ts` 의 `CATEGORY_CHECKLISTS` 가 항목의 정본이고 여기는 그 위에
 * 얹는 층이다. 항목 배열에 필드를 더하는 대신 id 로 참조하는 이유는 두 가지다.
 *
 *   1. 사용자의 완료 기록은 `id` 로만 저장된다. 여기를 고쳐도 기록은 그대로다.
 *   2. `noteSources.ts`(항목 → 예절 절)가 이미 같은 모양이다. 항목에 얹는 층이
 *      늘어날 때마다 정본 배열이 부풀지 않게 한다.
 *
 * ## 그룹은 배열을 자른 것이 아니다
 *
 * 대부분의 분야는 정본 배열 순서를 그대로 잘라 나눈 것이지만 **결혼식장은 아니다.**
 * 시안(`ChecklistAfter.dc.html`)이 `venue_05`(시간대 정하기)를 예약 전 단계에,
 * `venue_04`(식대 확인)를 계약 단계에 두는데 정본 배열은 04 가 05 보다 앞이다.
 * 그래서 이 화면은 **그룹 순서로 그린다** — 그룹 안에서만 정본 순서를 지킨다.
 * 다른 표면(일정 시간축·아모라 옆 패널)은 그룹을 쓰지 않으므로 영향이 없다.
 *
 * 정본 배열의 순서를 여기에 맞춰 바꾸지 마라. 그 배열은 여러 화면이 쓴다.
 *
 * ## 표시(태그)는 아끼는 것이 기본이다
 *
 * 계약·신고 때 놓치기 쉬운 항목만 `중요 확인`으로 표시한다. 시안의 `필수`를
 * 그대로 쓰면 계약금 납부 같은 선택도 법적 의무로 읽힐 수 있어 뜻을 구분했다.
 * `해당 시`는 라벨의 조건을 대신 표시하며, 두 표시는 완료 상태를 바꾸지 않는다.
 *
 * 이 파일은 `scripts/tests/checklist-groups-cover-every-item.test.mjs` 가 지킨다.
 * 172개 항목이 **정확히 한 번씩** 들어가야 하고, 없는 id 를 적으면 실패한다.
 */

/** 항목 옆에 붙는 표시. 둘뿐이고, 대부분의 항목에는 없다. */
export type ChecklistItemTag = "중요 확인" | "해당 시";

export interface ChecklistGroup {
  /** 화면에 그대로 나가는 이름. 「01 · 예약 전에」 꼴 — 번호와 가운뎃점을 포함한다. */
  title: string;
  /** 이 단계에 드는 항목 id. 정본 배열 순서를 그룹 안에서 지킨다. */
  itemIds: readonly string[];
}

export const CHECKLIST_GROUPS: Record<string, readonly ChecklistGroup[]> = {
  greeting: [
    { title: "01 · 만나뵙기 전에", itemIds: ["greeting_01", "greeting_02", "greeting_03"] },
    { title: "02 · 찾아뵐 때", itemIds: ["greeting_04"] },
    { title: "03 · 다녀와서", itemIds: ["greeting_05"] },
  ],
  meeting: [
    { title: "01 · 날짜와 장소 정하기", itemIds: ["meeting_01", "meeting_02"] },
    { title: "02 · 만나기 전에 맞춰둘 것", itemIds: ["meeting_07", "meeting_03", "meeting_04"] },
    { title: "03 · 그날 나눌 이야기", itemIds: ["meeting_05", "meeting_06"] },
  ],
  venue: [
    { title: "01 · 예약 전에", itemIds: ["venue_01", "venue_02", "venue_03", "venue_05"] },
    { title: "02 · 계약할 때 — 서면으로 받아두기", itemIds: ["venue_04", "venue_09", "venue_06"] },
    { title: "03 · 계약 후", itemIds: ["venue_07", "venue_08"] },
  ],
  studio: [
    { title: "01 · 알아보기", itemIds: ["studio_01", "studio_02", "studio_03"] },
    { title: "02 · 계약할 때 — 서면으로 받아두기", itemIds: ["studio_04", "studio_05", "studio_09", "studio_10", "studio_06"] },
    { title: "03 · 촬영하고 사진 받기", itemIds: ["studio_07", "studio_08", "studio_11"] },
  ],
  dress: [
    { title: "01 · 고르기 전에", itemIds: ["dress_01", "dress_02"] },
    { title: "02 · 입어보고 고르기", itemIds: ["dress_03", "dress_04"] },
    { title: "03 · 고른 뒤 챙기기", itemIds: ["dress_05", "dress_06", "dress_07", "dress_08"] },
    { title: "04 · 결혼식 끝난 뒤", itemIds: ["dress_09"] },
  ],
  makeup: [
    { title: "01 · 업체 고르기 전에", itemIds: ["makeup_01", "makeup_02", "makeup_03"] },
    { title: "02 · 미리 받아보기", itemIds: ["makeup_04", "makeup_05", "makeup_06"] },
    { title: "03 · 결혼식 날 준비 확정", itemIds: ["makeup_07", "makeup_08"] },
  ],
  ring: [
    { title: "01 · 정하기 전에", itemIds: ["ring_01", "ring_02", "ring_03", "ring_04"] },
    { title: "02 · 주문할 때 — 취소·수리 조건 먼저 확인", itemIds: ["ring_05", "ring_09", "ring_10", "ring_06"] },
    { title: "03 · 받기까지", itemIds: ["ring_07", "ring_08"] },
  ],
  hanbok: [
    { title: "01 · 정하기 전에", itemIds: ["hanbok_01", "hanbok_02", "hanbok_03"] },
    { title: "02 · 고르고 주문하기", itemIds: ["hanbok_04", "hanbok_05"] },
    { title: "03 · 확인하고 받기", itemIds: ["hanbok_06", "hanbok_07"] },
    { title: "04 · 입고 난 뒤", itemIds: ["hanbok_08"] },
  ],
  yedan: [
    { title: "01 · 할지부터 정하기", itemIds: ["yedan_01"] },
    { title: "02 · 품목과 예산 정하기", itemIds: ["yedan_02", "yedan_03", "yedan_04"] },
    { title: "03 · 전달하기", itemIds: ["yedan_05", "yedan_06"] },
  ],
  honeymoon: [
    { title: "01 · 여행지와 날짜 정하기", itemIds: ["honeymoon_01", "honeymoon_02", "honeymoon_09"] },
    { title: "02 · 예약하고 가입하기", itemIds: ["honeymoon_03", "honeymoon_04", "honeymoon_05"] },
    { title: "03 · 떠나기 전에", itemIds: ["honeymoon_06", "honeymoon_07", "honeymoon_08"] },
  ],
  houseware: [
    { title: "01 · 사기 전에", itemIds: ["houseware_01", "houseware_02"] },
    { title: "02 · 고르고 사기", itemIds: ["houseware_03", "houseware_04", "houseware_05", "houseware_06"] },
    { title: "03 · 입주하고 확인하기", itemIds: ["houseware_07", "houseware_08"] },
  ],
  housing: [
    { title: "01 · 알아보기", itemIds: ["housing_01", "housing_02", "housing_12", "housing_03", "housing_04"] },
    { title: "02 · 계약", itemIds: ["housing_08", "housing_09", "housing_10", "housing_05"] },
    { title: "03 · 입주 준비", itemIds: ["housing_06", "housing_07", "housing_11"] },
  ],
  invitation: [
    { title: "01 · 주문 전에 정할 것", itemIds: ["invitation_01", "invitation_09", "invitation_02", "invitation_03", "invitation_04"] },
    { title: "02 · 주문하고 확인하기", itemIds: ["invitation_05", "invitation_06"] },
    { title: "03 · 보내고 마무리하기", itemIds: ["invitation_07", "invitation_08"] },
  ],
  snap: [
    { title: "01 · 알아보기", itemIds: ["snap_01", "snap_02", "snap_03"] },
    { title: "02 · 조건 맞추고 계약하기", itemIds: ["snap_04", "snap_08", "snap_09", "snap_05"] },
    { title: "03 · 촬영하고 파일 받기", itemIds: ["snap_06", "snap_07", "snap_10"] },
  ],
  shoes: [
    { title: "01 · 신어 보고 정하기", itemIds: ["shoes_01", "shoes_02"] },
    { title: "02 · 구매", itemIds: ["shoes_03"] },
    { title: "03 · 더 준비할 신발", itemIds: ["shoes_04", "shoes_05", "shoes_06"] },
  ],
  bouquet: [
    { title: "01 · 꽃과 업체 정하기", itemIds: ["bouquet_01", "bouquet_02", "bouquet_03"] },
    { title: "02 · 주문하고 더 필요한 꽃 정하기", itemIds: ["bouquet_04", "bouquet_05", "bouquet_06"] },
    { title: "03 · 결혼식 날 받기", itemIds: ["bouquet_07"] },
  ],
  gift: [
    { title: "01 · 무엇을 줄지 정하기", itemIds: ["gift_01", "gift_02", "gift_03"] },
    { title: "02 · 확인하고 주문하기", itemIds: ["gift_04", "gift_05"] },
    { title: "03 · 받아서 결혼식장까지 챙기기", itemIds: ["gift_06", "gift_07"] },
  ],
  mc: [
    { title: "01 · 진행 맡을 사람 정하기", itemIds: ["mc_01", "mc_02"] },
    { title: "02 · 결혼식 순서에 넣을 것 정하기", itemIds: ["mc_03", "mc_04", "mc_07"] },
    { title: "03 · 결혼식 전에 맞춰보기", itemIds: ["mc_05", "mc_06"] },
  ],
  ham: [
    { title: "01 · 할지 정하기", itemIds: ["ham_01", "ham_02"] },
    { title: "02 · 전달할 사람과 물품 정하기", itemIds: ["ham_03", "ham_04"] },
    { title: "03 · 날짜와 비용 정하기", itemIds: ["ham_05", "ham_06"] },
  ],
  pyebaek: [
    { title: "01 · 할지 정하기", itemIds: ["pyebaek_01"] },
    { title: "02 · 음식과 장소 정하기", itemIds: ["pyebaek_02", "pyebaek_03", "pyebaek_04"] },
    { title: "03 · 결혼식 전에 확인하기", itemIds: ["pyebaek_07", "pyebaek_05", "pyebaek_06"] },
  ],
  registration: [
    { title: "01 · 신고 준비", itemIds: ["registration_01", "registration_02", "registration_03", "registration_04", "registration_05", "registration_06"] },
    { title: "02 · 접수하기", itemIds: ["registration_07", "registration_08"] },
    { title: "03 · 이사·보험은 해당 일정에 맞춰", itemIds: ["registration_11", "registration_09", "registration_10"] },
  ],
};

/**
 * 표시가 붙는 항목. 여기 없는 항목에는 아무것도 안 붙는다(그게 기본값이다).
 *
 * 시안의 조건 태그는 유지한다. 라벨 끝의 `(필요한 경우)`·`(해당하는 경우)`가
 * 있는 항목은 빠짐없이 `해당 시`다. 법정 의무를 확정할 수 없는 계약·신고 항목은
 * `필수` 대신 `중요 확인`으로 표시한다. 아래 목록은 법적 의무 목록이 아니다.
 *
 * ⚠️ 첫인사 시안(`ChecklistGreeting.dc.html`)은 `greeting_04` 에 접미사를 남기고
 * 표시를 안 달았는데, 혼인신고 시안은 접미사를 떼고 표시를 달았다. **문서의 규칙을
 * 따랐다**(둘 다 표시). 시안 둘이 서로 다를 때 규칙을 적어 둔 쪽이 정본이다.
 */
export const CHECKLIST_ITEM_TAGS: Record<string, ChecklistItemTag> = {
  venue_04: "중요 확인",
  venue_09: "중요 확인",
  venue_06: "중요 확인",
  venue_07: "중요 확인",
  studio_06: "중요 확인",
  ring_06: "중요 확인",
  snap_05: "중요 확인",
  housing_10: "중요 확인",
  housing_05: "중요 확인",
  housing_11: "중요 확인",
  registration_05: "중요 확인",
  registration_08: "중요 확인",
  registration_09: "해당 시",
  registration_11: "해당 시",
  greeting_04: "해당 시",
  studio_11: "해당 시",
  dress_09: "해당 시",
  ring_07: "해당 시",
  hanbok_08: "해당 시",
  honeymoon_09: "해당 시",
  honeymoon_07: "해당 시",
  snap_03: "해당 시",
  shoes_05: "해당 시",
  registration_02: "해당 시",
  registration_07: "해당 시",
  registration_10: "해당 시",
};

/**
 * 라벨 끝의 조건 표현을 뗀다 — **`해당 시` 표시를 함께 그릴 때만.**
 *
 * 시안이 그렇게 한다: `혼인신고 시기가 세금에 영향을 주는지 알아보기 (해당하는 경우)` 를
 * 라벨에서는 접미사 없이 적고 그 뜻을 표시로 올린다. 둘 다 그리면 같은 말이 두 번 나온다.
 *
 * **표시할 때만 자른다.** 정본 라벨은 그대로 둔다 — 검색 색인과 아모라가 그 문자열을
 * 쓰고, 표시가 안 붙는 항목(선물 준비 `(필요한 경우)` 등)은 접미사가 유일한 조건 신호다.
 */
export function labelWithoutConditionSuffix(label: string): string {
  return label.replace(/\s*\((?:해당하는|필요한)\s*경우\)\s*$/, "");
}

/**
 * 항목을 단계로 묶는다.
 *
 * 그룹에 없는 항목은 **버리지 않고** 마지막 그룹에 붙인다. 정본에 항목이 늘었는데
 * 여기에 안 적힌 경우인데, 그 상태로 배포되지 않게 가드가 따로 막는다. 런타임이
 * 조용히 항목을 지우는 것이 더 나쁘다.
 *
 * 그룹이 정의되지 않은 분야는 이름 없는 한 덩어리로 돌려준다 — 부르는 쪽이 그때는
 * 그룹 머리를 그리지 않는다.
 */
export function groupChecklistItems<T extends { id: string }>(
  categoryKey: string,
  items: readonly T[],
): { title: string; items: T[] }[] {
  const groups = CHECKLIST_GROUPS[categoryKey];
  if (!groups || groups.length === 0) return [{ title: "", items: [...items] }];

  const byId = new Map(items.map((item) => [item.id, item]));
  const placed = new Set<string>();
  const result = groups.map((group) => {
    const picked: T[] = [];
    for (const id of group.itemIds) {
      const item = byId.get(id);
      if (!item || placed.has(id)) continue;
      placed.add(id);
      picked.push(item);
    }
    return { title: group.title, items: picked };
  });

  const leftover = items.filter((item) => !placed.has(item.id));
  if (leftover.length > 0) result[result.length - 1].items.push(...leftover);

  return result.filter((group) => group.items.length > 0);
}

/** 이 항목에 붙는 표시. 없으면 undefined 다 — 대부분이 그렇다. */
export function checklistItemTag(itemId: string): ChecklistItemTag | undefined {
  return CHECKLIST_ITEM_TAGS[itemId];
}
