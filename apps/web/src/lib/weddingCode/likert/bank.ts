import type { Domain, Item } from "./types";

/** Local preference prototype. These items are not a validated psychological scale. */
export interface ItemScene {
  id: string;
  domain: Domain;
  title: string;
  context: string;
}

const moneyContext =
  "필수 결혼 비용과 결혼 후 생활비는 이미 확보되어 있습니다. 기본 구성만으로도 필요한 수준은 갖추었습니다. 같은 추가 비용으로 검토할 수 있는 옵션에 예산을 어떻게 배정하고 싶은지 생각해 주세요.";

const processContext =
  "두 사람 모두 후보를 살펴볼 시간과 필요한 정보가 있습니다. 비교 기준은 이미 합의했습니다. 여기서는 초기 후보 추리기만 생각해 주세요. 한 사람이 후보를 추려 와도 다른 사람이 자료를 직접 볼 수 있고, 최종 선택은 두 사람이 함께 합니다.";

const familyContext =
  "가족 의견을 듣기 위한 대화를 준비하고 있습니다. 가족이 중요하게 생각하는 점을 확인하는 일과 두 사람이 원하는 기준을 정리하는 일은 모두 아직 할 수 있습니다. 최종 결정권이나 어떤 일을 먼저 할지는 묻지 않습니다.";

const supportContext =
  "지금부터 처음 몇 분 동안 받을 도움을 생각해 주세요. 급한 마감은 없고 상대에게도 여유가 있습니다. 정리할 자료가 남아 있으며 잠시 쉬는 것도 가능합니다. 각 도움을 바라는 정도를 따로 답해 주세요.";

const scenes = {
  moneyVenue: {
    id: "likert.money.venue.v1",
    domain: "money",
    title: "예식장에 더 쓸 예산",
    context: `${moneyContext} 기본 좌석은 이미 충분합니다. 좌석 편의를 보강하는 옵션과 내가 원하는 조명 연출을 더하는 옵션을 같은 추가 비용으로 검토하고 있습니다. 장소와 행사 시간은 같습니다.`,
  },
  moneyPhoto: {
    id: "likert.money.photo.v1",
    domain: "money",
    title: "사진에 더 쓸 예산",
    context: `${moneyContext} 기본 촬영과 앨범은 이미 필요한 수준입니다. 앨범의 인화 품질을 높이는 옵션과 내가 원하는 추가 장면을 촬영하는 옵션을 같은 추가 비용으로 검토하고 있습니다. 촬영 시간과 준비 범위는 같습니다.`,
  },
  moneyMeal: {
    id: "likert.money.meal.v1",
    domain: "money",
    title: "식사에 더 쓸 예산",
    context: `${moneyContext} 기본 식사의 맛과 양은 이미 충분하고 내 취향에 맞습니다. 취향에 맞는 음식 한 가지를 더하는 옵션과 내가 원하는 제공 연출을 더하는 옵션을 같은 추가 비용으로 검토하고 있습니다. 식사 시간은 같습니다.`,
  },
  processPhoto: {
    id: "likert.process.photo.v1",
    domain: "process",
    title: "사진 촬영 업체 후보 추리기",
    context: `${processContext} 사진 촬영 업체의 작업물과 촬영 방식 자료를 살펴보는 상황입니다. 촬영 실행이나 계약을 맡기는 질문은 아닙니다.`,
  },
  processVenue: {
    id: "likert.process.venue.v1",
    domain: "process",
    title: "예식장 후보 추리기",
    context: `${processContext} 예식장의 위치와 공간, 이용 조건 자료를 살펴보는 상황입니다. 현장 방문이나 예약을 맡기는 질문은 아닙니다.`,
  },
  processOrder: {
    id: "likert.process.order.v1",
    domain: "process",
    title: "예식 식순 후보 추리기",
    context: `${processContext} 이미 제시된 식순 후보의 구성을 살펴보는 상황입니다. 당일 진행 책임이나 역할 배분을 맡기는 질문은 아닙니다.`,
  },
  familyGuests: {
    id: "likert.family.guests.v1",
    domain: "family",
    title: "초대 범위에 관한 가족 대화",
    context: `${familyContext} 초대할 사람의 범위를 정하기 전입니다.`,
  },
  familyOrder: {
    id: "likert.family.order.v1",
    domain: "family",
    title: "예식 순서에 관한 가족 대화",
    context: `${familyContext} 예식 순서를 정하기 전입니다.`,
  },
  familyPhoto: {
    id: "likert.family.photo.v1",
    domain: "family",
    title: "가족사진 구성에 관한 대화",
    context: `${familyContext} 함께 찍을 가족사진의 구성을 정하기 전입니다.`,
  },
  supportTour: {
    id: "likert.support.tour.v1",
    domain: "support",
    title: "홀 투어를 마친 직후",
    context: `홀 투어를 마치고 피로를 느껴 잠깐 멈춘 직후입니다. ${supportContext} 정리할 홀 투어 메모가 있습니다.`,
  },
  supportCompare: {
    id: "likert.support.compare.v1",
    domain: "support",
    title: "후보 비교를 마친 직후",
    context: `후보 비교를 마치고 피로를 느껴 잠깐 멈춘 직후입니다. ${supportContext} 정리할 후보 비교표가 있습니다.`,
  },
  supportContact: {
    id: "likert.support.contact.v1",
    domain: "support",
    title: "업체 연락으로 지친 직후",
    context: `업체 연락을 마치고 피로를 느껴 잠깐 멈춘 직후입니다. ${supportContext} 정리할 업체 답변 메모가 있습니다.`,
  },
} satisfies Record<string, ItemScene>;

export const SCENES: readonly ItemScene[] = Object.freeze(
  Object.values(scenes).map((scene) => Object.freeze(scene)),
);

type ItemCopy = Pick<Item, "id" | "facet" | "text" | "construct" | "resultUse">;

function inScene(scene: ItemScene, copy: ItemCopy): Item {
  return Object.freeze({
    ...copy,
    domain: scene.domain,
    sceneId: scene.id,
    sceneTitle: scene.title,
    context: scene.context,
  });
}

/** IDs identify an exact item and context. Changed wording requires a new ID. */
export const ITEMS: readonly Item[] = Object.freeze([
  inScene(scenes.moneyVenue, {
    id: "likert.money.venue.C.v1",
    facet: "C",
    text: "예식장 추가 예산은 기본 공간의 좌석 편의를 보강하는 데 우선 배정하고 싶다.",
    construct: "장소의 기본 편의에 추가 예산을 우선 배정하려는 욕구",
    resultUse: "장소 예산을 논의할 때 좌석 편의 보강을 검토할 단서로 쓴다.",
  }),
  inScene(scenes.moneyVenue, {
    id: "likert.money.venue.E.v1",
    facet: "E",
    text: "예식장 추가 예산은 내가 원했던 조명 연출을 더하는 데 우선 배정하고 싶다.",
    construct: "원하는 공간 경험에 추가 예산을 우선 배정하려는 욕구",
    resultUse: "장소 예산을 논의할 때 원하는 조명 연출을 검토할 단서로 쓴다.",
  }),
  inScene(scenes.moneyPhoto, {
    id: "likert.money.photo.C.v1",
    facet: "C",
    text: "사진 추가 예산은 기본 앨범의 인화 품질을 높이는 데 우선 배정하고 싶다.",
    construct: "기본 사진 결과물의 품질에 추가 예산을 우선 배정하려는 욕구",
    resultUse: "사진 예산을 논의할 때 기본 앨범의 인화 품질 보강을 검토할 단서로 쓴다.",
  }),
  inScene(scenes.moneyPhoto, {
    id: "likert.money.photo.E.v1",
    facet: "E",
    text: "사진 추가 예산은 내가 원했던 추가 촬영 장면을 만드는 데 우선 배정하고 싶다.",
    construct: "원하는 촬영 경험에 추가 예산을 우선 배정하려는 욕구",
    resultUse: "사진 예산을 논의할 때 원하는 추가 촬영 장면을 검토할 단서로 쓴다.",
  }),
  inScene(scenes.moneyMeal, {
    id: "likert.money.meal.C.v1",
    facet: "C",
    text: "식사 추가 예산은 기본 메뉴에 음식 한 가지를 더하는 데 우선 배정하고 싶다.",
    construct: "기본 식사 구성에 추가 예산을 우선 배정하려는 욕구",
    resultUse: "식사 예산을 논의할 때 기본 메뉴 구성을 보강할 단서로 쓴다.",
  }),
  inScene(scenes.moneyMeal, {
    id: "likert.money.meal.E.v1",
    facet: "E",
    text: "식사 추가 예산은 내가 원했던 음식 제공 연출을 더하는 데 우선 배정하고 싶다.",
    construct: "원하는 식사 경험에 추가 예산을 우선 배정하려는 욕구",
    resultUse: "식사 예산을 논의할 때 원하는 음식 제공 연출을 검토할 단서로 쓴다.",
  }),
  inScene(scenes.processPhoto, {
    id: "likert.process.photo.J.v1",
    facet: "J",
    text: "사진 촬영 업체 후보를 추리는 과정에서 나도 직접 작업물을 비교해 보고 싶다.",
    construct: "사진 후보 검토에 직접 참여하려는 욕구",
    resultUse: "사진 후보를 추릴 때 본인이 직접 작업물을 볼 기회를 마련할 단서로 쓴다.",
  }),
  inScene(scenes.processPhoto, {
    id: "likert.process.photo.T.v1",
    facet: "T",
    text: "두 사람이 합의한 기준 안에서는 한 사람이 사진 촬영 업체 후보를 추려 와도 괜찮다.",
    construct: "함께 정한 기준 안에서 한 사람이 초기 사진 촬영 업체 후보를 추려 공유하는 방식의 수용도",
    resultUse: "함께 정한 기준 안에서 한 사람이 초기 사진 촬영 업체 후보를 추려 공유하는 방식의 수용을 논의할 단서로 쓴다. 수행자나 위임 욕구를 직접 추론하지 않으며, 누가 후보를 추릴지는 따로 상의한다.",
  }),
  inScene(scenes.processVenue, {
    id: "likert.process.venue.J.v1",
    facet: "J",
    text: "예식장 후보를 추리는 과정에서 나도 직접 각 장소의 자료를 비교해 보고 싶다.",
    construct: "장소 후보 검토에 직접 참여하려는 욕구",
    resultUse: "장소 후보를 추릴 때 본인이 직접 자료를 볼 기회를 마련할 단서로 쓴다.",
  }),
  inScene(scenes.processVenue, {
    id: "likert.process.venue.T.v1",
    facet: "T",
    text: "두 사람이 합의한 기준 안에서는 한 사람이 예식장 후보를 추려 와도 괜찮다.",
    construct: "함께 정한 기준 안에서 한 사람이 초기 예식장 후보를 추려 공유하는 방식의 수용도",
    resultUse: "함께 정한 기준 안에서 한 사람이 초기 예식장 후보를 추려 공유하는 방식의 수용을 논의할 단서로 쓴다. 수행자나 위임 욕구를 직접 추론하지 않으며, 누가 후보를 추릴지는 따로 상의한다.",
  }),
  inScene(scenes.processOrder, {
    id: "likert.process.order.J.v1",
    facet: "J",
    text: "예식 식순 후보를 추리는 과정에서 나도 직접 각 식순의 구성을 비교해 보고 싶다.",
    construct: "식순 후보 검토에 직접 참여하려는 욕구",
    resultUse: "식순 후보를 추릴 때 본인이 직접 구성을 볼 기회를 마련할 단서로 쓴다.",
  }),
  inScene(scenes.processOrder, {
    id: "likert.process.order.T.v1",
    facet: "T",
    text: "두 사람이 합의한 기준 안에서는 한 사람이 예식 식순 후보를 추려 와도 괜찮다.",
    construct: "함께 정한 기준 안에서 한 사람이 초기 예식 식순 후보를 추려 공유하는 방식의 수용도",
    resultUse: "함께 정한 기준 안에서 한 사람이 초기 예식 식순 후보를 추려 공유하는 방식의 수용을 논의할 단서로 쓴다. 수행자나 위임 욕구를 직접 추론하지 않으며, 누가 후보를 추릴지는 따로 상의한다.",
  }),
  inScene(scenes.familyGuests, {
    id: "likert.family.guests.O.v1",
    facet: "O",
    text: "초대 범위에 관해 가족이 중요하게 생각하는 점을 확인하고 싶다.",
    construct: "초대 범위에 관한 가족의 생각을 확인하려는 욕구",
    resultUse: "가족과 초대 범위를 논의할 때 확인하고 싶은 점을 대화할 단서로 쓴다.",
  }),
  inScene(scenes.familyGuests, {
    id: "likert.family.guests.U.v1",
    facet: "U",
    text: "초대 범위에 관해 두 사람이 원하는 기준을 정리해 두고 싶다.",
    construct: "초대 범위에 관한 두 사람의 기준을 정리하려는 욕구",
    resultUse: "두 사람이 원하는 초대 기준을 구체적으로 정리할 단서로 쓴다.",
  }),
  inScene(scenes.familyOrder, {
    id: "likert.family.order.O.v1",
    facet: "O",
    text: "예식 순서에 관해 가족이 중요하게 생각하는 점을 확인하고 싶다.",
    construct: "예식 순서에 관한 가족의 생각을 확인하려는 욕구",
    resultUse: "가족과 예식 순서를 논의할 때 확인하고 싶은 점을 대화할 단서로 쓴다.",
  }),
  inScene(scenes.familyOrder, {
    id: "likert.family.order.U.v1",
    facet: "U",
    text: "예식 순서에 관해 두 사람이 원하는 기준을 정리해 두고 싶다.",
    construct: "예식 순서에 관한 두 사람의 기준을 정리하려는 욕구",
    resultUse: "두 사람이 원하는 예식 순서의 기준을 구체적으로 정리할 단서로 쓴다.",
  }),
  inScene(scenes.familyPhoto, {
    id: "likert.family.photo.O.v1",
    facet: "O",
    text: "가족사진 구성에 관해 가족이 중요하게 생각하는 점을 확인하고 싶다.",
    construct: "가족사진 구성에 관한 가족의 생각을 확인하려는 욕구",
    resultUse: "가족사진을 논의할 때 가족에게 확인하고 싶은 점을 대화할 단서로 쓴다.",
  }),
  inScene(scenes.familyPhoto, {
    id: "likert.family.photo.U.v1",
    facet: "U",
    text: "가족사진 구성에 관해 두 사람이 원하는 기준을 정리해 두고 싶다.",
    construct: "가족사진 구성에 관한 두 사람의 기준을 정리하려는 욕구",
    resultUse: "두 사람이 원하는 가족사진 구성의 기준을 구체적으로 정리할 단서로 쓴다.",
  }),
  inScene(scenes.supportTour, {
    id: "likert.support.tour.L.v1",
    facet: "L",
    text: "홀 투어를 마친 지금은 상대가 내 이야기를 들어 줬으면 좋겠다.",
    construct: "홀 투어 직후 처음 몇 분의 경청 요청",
    resultUse: "홀 투어 직후 이야기를 들어 주는 도움을 바라는지 확인할 단서로 쓴다.",
  }),
  inScene(scenes.supportTour, {
    id: "likert.support.tour.A.v1",
    facet: "A",
    text: "홀 투어를 마친 지금은 상대가 홀 투어 메모를 정리해 줬으면 좋겠다.",
    construct: "홀 투어 직후 처음 몇 분의 메모 정리 요청",
    resultUse: "홀 투어 직후 메모 정리 도움을 바라는지 확인할 단서로 쓴다.",
  }),
  inScene(scenes.supportTour, {
    id: "likert.support.tour.together-rest.v1",
    facet: "together_rest",
    text: "홀 투어를 마친 지금은 상대가 나와 함께 잠시 쉬었으면 좋겠다.",
    construct: "홀 투어 직후 처음 몇 분의 함께 쉬기 요청",
    resultUse: "그 순간 함께 쉬고 싶은지 경청과 실무 정리 요청과 별도로 확인한다.",
  }),
  inScene(scenes.supportTour, {
    id: "likert.support.tour.alone-rest.v1",
    facet: "alone_rest",
    text: "홀 투어를 마친 지금은 상대가 나에게 잠시 혼자 쉴 시간을 줬으면 좋겠다.",
    construct: "홀 투어 직후 처음 몇 분의 혼자 쉬기 요청",
    resultUse: "그 순간 혼자 쉬고 싶은지 경청과 실무 정리 요청과 별도로 확인한다.",
  }),
  inScene(scenes.supportCompare, {
    id: "likert.support.compare.L.v1",
    facet: "L",
    text: "후보 비교를 마친 지금은 상대가 내 이야기를 들어 줬으면 좋겠다.",
    construct: "후보 비교 직후 처음 몇 분의 경청 요청",
    resultUse: "후보 비교 직후 이야기를 들어 주는 도움을 바라는지 확인할 단서로 쓴다.",
  }),
  inScene(scenes.supportCompare, {
    id: "likert.support.compare.A.v1",
    facet: "A",
    text: "후보 비교를 마친 지금은 상대가 후보 비교표를 정리해 줬으면 좋겠다.",
    construct: "후보 비교 직후 처음 몇 분의 비교표 정리 요청",
    resultUse: "후보 비교 직후 비교표 정리 도움을 바라는지 확인할 단서로 쓴다.",
  }),
  inScene(scenes.supportCompare, {
    id: "likert.support.compare.together-rest.v1",
    facet: "together_rest",
    text: "후보 비교를 마친 지금은 상대가 나와 함께 잠시 쉬었으면 좋겠다.",
    construct: "후보 비교 직후 처음 몇 분의 함께 쉬기 요청",
    resultUse: "그 순간 함께 쉬고 싶은지 경청과 실무 정리 요청과 별도로 확인한다.",
  }),
  inScene(scenes.supportCompare, {
    id: "likert.support.compare.alone-rest.v1",
    facet: "alone_rest",
    text: "후보 비교를 마친 지금은 상대가 나에게 잠시 혼자 쉴 시간을 줬으면 좋겠다.",
    construct: "후보 비교 직후 처음 몇 분의 혼자 쉬기 요청",
    resultUse: "그 순간 혼자 쉬고 싶은지 경청과 실무 정리 요청과 별도로 확인한다.",
  }),
  inScene(scenes.supportContact, {
    id: "likert.support.contact.L.v1",
    facet: "L",
    text: "업체 연락을 마친 지금은 상대가 내 이야기를 들어 줬으면 좋겠다.",
    construct: "업체 연락 피로 직후 처음 몇 분의 경청 요청",
    resultUse: "업체 연락 직후 이야기를 들어 주는 도움을 바라는지 확인할 단서로 쓴다.",
  }),
  inScene(scenes.supportContact, {
    id: "likert.support.contact.A.v1",
    facet: "A",
    text: "업체 연락을 마친 지금은 상대가 업체 답변 메모를 정리해 줬으면 좋겠다.",
    construct: "업체 연락 피로 직후 처음 몇 분의 답변 메모 정리 요청",
    resultUse: "업체 연락 직후 답변 메모 정리 도움을 바라는지 확인할 단서로 쓴다.",
  }),
  inScene(scenes.supportContact, {
    id: "likert.support.contact.together-rest.v1",
    facet: "together_rest",
    text: "업체 연락을 마친 지금은 상대가 나와 함께 잠시 쉬었으면 좋겠다.",
    construct: "업체 연락 피로 직후 처음 몇 분의 함께 쉬기 요청",
    resultUse: "그 순간 함께 쉬고 싶은지 경청과 실무 정리 요청과 별도로 확인한다.",
  }),
  inScene(scenes.supportContact, {
    id: "likert.support.contact.alone-rest.v1",
    facet: "alone_rest",
    text: "업체 연락을 마친 지금은 상대가 나에게 잠시 혼자 쉴 시간을 줬으면 좋겠다.",
    construct: "업체 연락 피로 직후 처음 몇 분의 혼자 쉬기 요청",
    resultUse: "그 순간 혼자 쉬고 싶은지 경청과 실무 정리 요청과 별도로 확인한다.",
  }),
]);

export function getItem(id: string): Item | undefined {
  return ITEMS.find((item) => item.id === id);
}

export function getItemsByDomain(domain: Domain): readonly Item[] {
  return ITEMS.filter((item) => item.domain === domain);
}

export function getItemsByScene(sceneId: string): readonly Item[] {
  return ITEMS.filter((item) => item.sceneId === sceneId);
}
