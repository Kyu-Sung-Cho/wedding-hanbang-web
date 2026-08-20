export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  /**
   * 이 항목을 할 때 놓치기 쉬운 한 가지. 없으면 안 그린다.
   *
   * label은 **무엇을 할지**만 말한다. 그래서 "샘플 확인" 같은 항목은 열어도 무슨 샘플을
   * 뭘 보고 판단하는지 알 수 없었다. 이 자리는 그 한 칸을 메운다.
   *
   * 규칙 세 가지 —
   *   1. 금액·기간 수치와 법령명을 넣지 않는다. 업체·계약마다 다르고 틀리면 그게 사고다.
   *      "얼마"가 아니라 **무엇을 물어야 하는지**를 쓴다.
   *   2. label을 다시 말하지 않는다. 반복은 정보량이 0이다.
   *   3. **사실을 주장하면 근거가 필요하고, 물어볼 것을 알려주면 필요 없다.**
   *      "철회 기간은 며칠입니다"는 틀리면 사고라 예절 안내 25편
   *      (`apps/web/src/lib/manners/data.ts`)에 근거를 둔다. "철회 기간을 계약서에
   *      적어달라고 하세요"는 애초에 참·거짓이 없고, 쓸모없을 수는 있어도 틀릴 수는
   *      없다. 그래서 이 자리는 대부분 **무엇을 물어야 하는지**로 채운다.
   *      근거도 없고 물어볼 것도 아닌 단정만 비워 둔다.
   *
   * 진행 상태와 무관하다. 이 문구를 고쳐도 사용자의 완료 기록은 `id`로만 저장되므로
   * 영향이 없다.
   */
  note?: string;
}

/**
 * 일정·예산·아모라가 함께 쓰는 사용자용 준비 항목 이름.
 *
 * 업계 용어를 처음 보는 사람도 뜻을 유추하지 않도록 일상어를 먼저 쓰고,
 * 필요한 경우에만 익숙한 명칭을 뒤에 덧붙인다.
 */
export const PLANNING_CATEGORY_LABELS = {
  meeting: "부모님 첫 만남",
  venue: "결혼식장",
  studio: "웨딩 사진 촬영",
  dress: "드레스·예식 정장",
  makeup: "헤어·메이크업",
  ring: "결혼반지·기념 선물",
  hanbok: "한복",
  yedan: "두 가족에게 드릴 선물",
  honeymoon: "신혼여행",
  houseware: "가전·가구·생활용품",
  housing: "신혼집",
  invitation: "종이·모바일 초대장",
  snap: "결혼식 날 사진·영상",
  shoes: "결혼식 신발",
  bouquet: "손에 드는 꽃·꽃 장식",
  gift: "결혼식에 온 분께 드릴 선물",
  mc: "결혼식 진행·축하 노래",
  ham: "가족에게 전하는 전통 혼례 선물",
  pyebaek: "결혼식 뒤 전통 인사",
  reserve: "예비비·사용처 미정",
} as const;

export type PlanningCategoryKey = keyof typeof PLANNING_CATEGORY_LABELS;

export interface CategoryChecklistTemplate {
  key: string;
  label: string;
  icon: string;
  tip: string;
  /** 화면 정렬용 기본 확인 시작점이며 실제 계약 시작일이 아니다. */
  ddayStart: number;
  /** 화면 정렬용 기본 확인 시점이며 실제 마감일이 아니다. */
  ddayDeadline: number;
  items: ChecklistItem[];
}

export const CATEGORY_CHECKLISTS: CategoryChecklistTemplate[] = [
  // 기본 확인 순서 1: 먼저 합의할 항목
  {
    key: "meeting",
    label: PLANNING_CATEGORY_LABELS.meeting,
    icon: "Users",
    tip: "두 사람이 양쪽 부모님과 처음 함께 만나는 일정입니다. 날짜·장소·참석자와 이 자리에서 나눌 주제를 미리 맞춰보세요.",
    ddayStart: 360,
    ddayDeadline: 300,
    items: [
      { id: "meeting_01", label: "양쪽 부모님 첫 만남 날짜 조율", done: false },
      {
        id: "meeting_02",
        label: "만날 장소 정하고 예약",
        done: false,
        note: "방 크기와 소음, 화장실 위치는 사진에 안 나오니 예약 전에 한 번 가보세요.",
      },
      {
        id: "meeting_03",
        label: "참석자와 옷차림 확인",
        done: false,
        note: "형제자매도 함께 오는지, 어느 정도로 차려입을지 두 집안에 같은 질문으로 미리 물어보세요.",
      },
      { id: "meeting_04", label: "서로 드릴 선물이 필요한지 합의", done: false },
      {
        id: "meeting_05",
        label: "결혼식 날짜와 전체 예산 이야기",
        done: false,
        note: "그날 정해진 것을 두 사람이 어떤 말로 전할지 정해두세요. 말이 서로 다르면 이야기가 다시 돌아갈 수 있어요.",
      },
      {
        id: "meeting_06",
        label: "가전·가구와 두 가족에게 드릴 선물의 비용 분담 이야기",
        done: false,
        note: "그 자리에서 말로 오간 약속은 서로 다르게 기억하니 그날 안에 적어 함께 확인해 두세요.",
      },
    ],
  },
  {
    key: "venue",
    label: PLANNING_CATEGORY_LABELS.venue,
    icon: "Building2",
    tip: "원하는 날짜에 가능한 장소가 적을 수 있습니다. 후보 날짜와 예상 하객 수를 정한 뒤 각 장소의 가능 일정과 계약 조건을 확인하세요.",
    ddayStart: 360,
    ddayDeadline: 270,
    items: [
      { id: "venue_01", label: "원하는 결혼식장 형태 정하기", done: false },
      { id: "venue_02", label: "비교할 장소 후보 정리", done: false },
      { id: "venue_03", label: "장소 방문 날짜 예약하고 직접 확인", done: false },
      {
        id: "venue_04",
        label: "하객 식사 메뉴와 1인당 금액 확인",
        done: false,
        note: "주류와 음료, 아이 식사가 식대에 포함인지 별도인지 항목으로 나눠 받아보세요.",
      },
      { id: "venue_05", label: "결혼식 시간대 정하기", done: false },
      {
        id: "venue_06",
        label: "취소·변경 때 내거나 돌려받는 금액 확인",
        done: false,
        note: "돌려받을 때 무엇을 빼는지, 그 항목과 금액을 계약 전에 서면으로 받아두세요.",
      },
      {
        id: "venue_09",
        label: "하객이 적어도 식사비를 내야 하는 최소 인원 확인",
        done: false,
        note: "인원을 낮출 수 있는지, 낮추면 대관료가 올라가는 구조인지 함께 물어보세요.",
      },
      {
        id: "venue_07",
        label: "계약금 납부 및 계약서 보관",
        done: false,
        note: "상담에서 말로 들은 조건도 계약서에 문장으로 옮겨 적혔는지 보고 서명하세요.",
      },
      {
        id: "venue_08",
        label: "대기실·주차장·사진 촬영 공간 확인",
        done: false,
        note: "우리 뒤에 다른 결혼식이 있는지, 있다면 몇 시에 들어오는지 물어보세요. 사진 찍을 시간이 대개 그 시각에 맞춰 정해져요.",
      },
    ],
  },

  // 기본 확인 순서 2: 주요 업체와 상품
  {
    key: "studio",
    label: PLANNING_CATEGORY_LABELS.studio,
    icon: "Camera",
    tip: "원하는 사진 분위기와 촬영 장소를 먼저 이야기한 뒤, 업체가 실제로 찍은 사진과 견적에 포함된 결과물을 비교하세요.",
    ddayStart: 300,
    ddayDeadline: 150,
    items: [
      { id: "studio_01", label: "원하는 사진 분위기와 촬영 장소 정하기", done: false },
      { id: "studio_02", label: "사진 촬영 업체 후보 비교", done: false },
      { id: "studio_03", label: "업체가 실제로 찍은 사진과 이용 후기 확인", done: false },
      {
        id: "studio_04",
        label: "받는 사진 수와 보정해 주는 사진 수 확인",
        done: false,
        note: "앨범이나 액자를 함께 사야 사진 파일을 받을 수 있는 구조인지 물어보세요.",
      },
      {
        id: "studio_05",
        label: "촬영 일정 확정",
        done: false,
        note: "준비와 이동까지 합치면 하루의 상당 부분을 쓰는 경우가 많으니, 촬영 다음 날에는 중요한 일정을 두지 마세요.",
      },
      {
        id: "studio_09",
        label: "촬영 취소나 날짜 변경 때 돌려받는 금액 확인",
        done: false,
        note: "패키지로 묶여 있어도 제휴업체마다 위약금 기준이 다르니 업체별로 받아보세요.",
      },
      {
        id: "studio_10",
        label: "완성 사진 받는 날짜와 늦어질 때 어떻게 되는지 확인",
        done: false,
        note: "남은 금액은 완성 사진을 받은 뒤에 내도 되는지 계약 전에 물어보세요.",
      },
      {
        id: "studio_06",
        label: "계약 및 계약금 납부",
        done: false,
        note: "박람회장처럼 사업장 밖에서 맺는 계약은 철회 규정이 다르니, 기간과 방법을 계약서에 적어달라고 하세요.",
      },
      { id: "studio_07", label: "원하는 사진 분위기와 입을 옷 협의", done: false },
      {
        id: "studio_08",
        label: "보정해 준 사진 확인하고 받을 사진 선택",
        done: false,
        note: "고른 뒤에 바꿀 수 있는지, 고르지 않은 사진은 언제까지 남아 있는지 함께 물어보세요.",
      },
    ],
  },
  {
    key: "dress",
    label: PLANNING_CATEGORY_LABELS.dress,
    icon: "Shirt",
    tip: "입었을 때의 편안함, 움직임, 원하는 분위기를 함께 보세요. 배우자가 입을 예식용 정장도 필요한지 따로 확인하세요.",
    ddayStart: 300,
    ddayDeadline: 120,
    items: [
      { id: "dress_01", label: "원하는 드레스 분위기와 편안함 기준 정하기", done: false },
      { id: "dress_02", label: "비교할 드레스 매장 후보 정리", done: false },
      {
        id: "dress_03",
        label: "드레스 입어볼 날짜 예약하고 방문",
        done: false,
        note: "예약할 때 하루에 몇 벌을 입어 볼 수 있는지, 현장에서 따로 내는 돈이 있는지 물어보세요.",
      },
      { id: "dress_04", label: "최종 드레스 선정", done: false },
      {
        id: "dress_05",
        label: "드레스를 몸에 맞게 고치는 날짜 확인",
        done: false,
        note: "그 날짜 뒤에 몸이 달라지면 다시 손볼 수 있는지, 값이 더 붙는지 함께 물어보세요.",
      },
      { id: "dress_06", label: "머리에 쓰는 면사포·머리 장식·장갑·신발 포함 여부 확인", done: false },
      {
        id: "dress_07",
        label: "배우자 예식 정장 선택하고 대여·맞춤 정하기",
        done: false,
        note: "셔츠와 넥타이, 소매 단추, 신발까지 하루 전에 한 번 다 입어 보세요.",
      },
      {
        id: "dress_08",
        label: "결혼식 전 드레스를 입어보고 최종 확인",
        done: false,
        note: "당일에 뒷지퍼와 잠금 고리를 누가 잠가 줄지 이때 함께 정해 두세요.",
      },
    ],
  },
  {
    key: "makeup",
    label: PLANNING_CATEGORY_LABELS.makeup,
    icon: "Palette",
    tip: "결혼식 전에 헤어와 메이크업을 미리 받아볼지는 업체의 제공 범위와 두 사람의 필요에 따라 정하세요.",
    ddayStart: 240,
    ddayDeadline: 60,
    items: [
      { id: "makeup_01", label: "원하는 헤어·메이크업 분위기 사진 정리", done: false },
      { id: "makeup_02", label: "헤어·메이크업 업체 후보 비교", done: false },
      { id: "makeup_03", label: "업체가 실제로 한 작업과 이용 후기 확인", done: false },
      {
        id: "makeup_04",
        label: "결혼식 전에 미리 받아볼 날짜 예약",
        done: false,
        note: "미리 받아보는 날 맡을 사람이 결혼식 당일에도 오는지, 그 사람을 지정하면 값이 더 드는지 물어보세요.",
      },
      { id: "makeup_05", label: "미리 받아보고 사진으로 남겨 확인", done: false },
      {
        id: "makeup_06",
        label: "수정 사항 전달",
        done: false,
        note: "감정이 올라오는 순간은 예고 없이 오니 번지지 않는 눈 화장으로 요청해 두세요.",
      },
      { id: "makeup_07", label: "결혼식 날 헤어·메이크업 최종 확인", done: false },
      {
        id: "makeup_08",
        label: "부모님 헤어·메이크업이 필요한지 확인",
        done: false,
        note: "부모님도 같은 날 함께 받으시면 준비 시작 시간이 당겨지는지, 비용이 어떻게 달라지는지 정하기 전에 물어보세요.",
      },
    ],
  },
  {
    key: "ring",
    label: PLANNING_CATEGORY_LABELS.ring,
    icon: "Gem",
    tip: "결혼반지나 기념 선물을 준비한다면 누가 비용을 내는지, 전체 금액, 필요한 품목과 수령 날짜를 먼저 정리하세요.",
    ddayStart: 270,
    ddayDeadline: 120,
    items: [
      { id: "ring_01", label: "결혼반지·기념 선물 전체 예산 정하기", done: false },
      { id: "ring_02", label: "준비할 품목 정하기", done: false },
      { id: "ring_03", label: "완성된 반지를 파는 매장과 직접 만들어 주는 매장 비교", done: false },
      { id: "ring_04", label: "후보 매장 방문하고 가격·조건 비교", done: false },
      {
        id: "ring_05",
        label: "디자인 및 사이즈 확정",
        done: false,
        note: "반지 치수는 예전에 알던 값 대신 정하는 날 다시 재어 보고, 주문서에 그 값이 적혔는지 보세요.",
      },
      {
        id: "ring_09",
        label: "만들기 시작한 뒤 취소가 되는지 확인",
        done: false,
        note: "각인이나 사이즈 조정이 들어가면 취소가 막히는 시점이 앞당겨지는지 함께 물어보세요.",
      },
      {
        id: "ring_10",
        label: "사이즈를 고치거나 다시 만들 때 드는 비용 확인",
        done: false,
        note: "사후 수리를 어디까지 해주는지 보증서에 적혀 있는지 사러 가기 전에 확인하세요.",
      },
      {
        id: "ring_06",
        label: "주문 및 계약금 납부",
        done: false,
        note: "완성된 반지를 받는 날짜를 결혼식보다 넉넉히 앞으로 잡아 주문서에 적어두세요.",
      },
      { id: "ring_07", label: "반지 안쪽에 새길 문구 정하기 (필요한 경우)", done: false },
      {
        id: "ring_08",
        label: "최종 수령 및 확인",
        done: false,
        note: "매장을 나서기 전에 새긴 글자와 사이즈가 주문서와 같은지 맞춰 보세요.",
      },
    ],
  },

  // 기본 확인 순서 3: 생활과 가족 관련 항목
  {
    key: "hanbok",
    label: PLANNING_CATEGORY_LABELS.hanbok,
    icon: "Flower2",
    tip: "한복을 입을 사람과 맞춤·대여 여부를 정한 뒤, 업체가 안내한 제작 또는 대여 기간과 수령 날짜를 확인하세요.",
    ddayStart: 180,
    ddayDeadline: 60,
    items: [
      {
        id: "hanbok_01",
        label: "한복을 맞출지 빌릴지 정하기",
        done: false,
        note: "결혼식장이나 업체 견적에 한복 대여가 이미 들어 있는지 고르기 전에 물어보세요.",
      },
      {
        id: "hanbok_02",
        label: "한복을 입을 사람 정하기",
        done: false,
        note: "두 집안 어른 중 어느 분까지 입으실지 먼저 여쭤보고 몇 벌이 필요한지 정하세요.",
      },
      { id: "hanbok_03", label: "한복 업체 후보 방문하고 비교", done: false },
      { id: "hanbok_04", label: "한복 천과 색상 선택", done: false },
      {
        id: "hanbok_05",
        label: "치수 측정 및 주문",
        done: false,
        note: "속치마와 버선처럼 함께 갖춰야 할 것도 주문에 들어가는지 확인해 두세요.",
      },
      { id: "hanbok_06", label: "완성 전에 치수와 모양 중간 확인", done: false },
      {
        id: "hanbok_07",
        label: "완성된 한복 입어보고 수령",
        done: false,
        note: "받는 자리에서 단추와 끈을 직접 매어 보면 결혼식 당일에 입는 시간이 줄어요.",
      },
    ],
  },
  {
    key: "yedan",
    label: PLANNING_CATEGORY_LABELS.yedan,
    icon: "Package",
    tip: "두 가족에게 선물을 준비할지는 가족과 먼저 합의하세요. 진행한다면 품목, 금액, 전달 방법을 적어두세요.",
    ddayStart: 180,
    ddayDeadline: 60,
    items: [
      {
        id: "yedan_01",
        label: "두 가족에게 드릴 선물을 준비할지 가족과 합의",
        done: false,
        note: "선물 이야기는 미루면 갈등으로 이어지는 경우가 많으니 부모님 첫 만남 무렵에 꺼내 보세요.",
      },
      {
        id: "yedan_02",
        label: "준비할 품목과 전체 예산 정하기",
        done: false,
        note: "예전부터 준비하던 목록을 그대로 채우기보다 품목을 줄이거나 현금으로 대신하는 집도 많아요.",
      },
      { id: "yedan_03", label: "필요한 품목의 업체와 가격 비교", done: false },
      { id: "yedan_04", label: "최종 선물 품목과 수량 확인", done: false },
      {
        id: "yedan_05",
        label: "포장과 전달 날짜 확인",
        done: false,
        note: "날짜는 한쪽이 정해 알리기보다 두 집안이 미리 함께 맞춰 두세요.",
      },
      {
        id: "yedan_06",
        label: "두 가족에게 선물 전달 완료",
        done: false,
        note: "주고받은 목록을 적어 남겨두면 나중에 답례를 정할 때 기준이 돼요.",
      },
    ],
  },
  {
    key: "honeymoon",
    label: PLANNING_CATEGORY_LABELS.honeymoon,
    icon: "Plane",
    tip: "여행지와 기간을 정한 뒤 항공·숙소의 취소 조건과 여권·비자 필요 여부를 공식 안내에서 확인하세요.",
    ddayStart: 180,
    ddayDeadline: 30,
    items: [
      { id: "honeymoon_01", label: "국내 또는 해외 여행지 정하기", done: false },
      {
        id: "honeymoon_02",
        label: "여행 일정 및 기간 확정",
        done: false,
        note: "결혼식 날짜가 밀릴 수도 있으니 일정을 바꾸거나 취소할 때 어떤 비용이 생기는지 예약 전에 물어보세요.",
      },
      { id: "honeymoon_03", label: "항공권 예약", done: false },
      {
        id: "honeymoon_04",
        label: "숙소 예약",
        done: false,
        note: "쌓아둔 숙박 포인트를 쓸 수 있는 곳인지 예약 전에 확인해 보세요.",
      },
      {
        id: "honeymoon_05",
        label: "여행자 보험 가입",
        done: false,
        note: "일정이 바뀌거나 짐이 없어졌을 때 어디까지 보상되는지 가입 전에 물어보세요.",
      },
      {
        id: "honeymoon_06",
        label: "여권과 비자 필요 여부 확인하고 갱신",
        done: false,
        note: "가려는 나라가 여권 남은 기간을 얼마나 요구하는지 비행기표를 사기 전에 확인하세요.",
      },
      { id: "honeymoon_07", label: "현지 여행 프로그램 예약 (필요한 경우)", done: false },
      { id: "honeymoon_08", label: "환전 및 카드 준비", done: false },
    ],
  },
  {
    key: "houseware",
    label: PLANNING_CATEGORY_LABELS.houseware,
    icon: "Home",
    tip: "가전·가구·생활용품은 실제로 필요한 목록과 공간 크기를 먼저 확인하고, 비용을 누가 얼마나 낼지 정리하세요.",
    ddayStart: 180,
    ddayDeadline: 30,
    items: [
      {
        id: "houseware_01",
        label: "가전·가구 비용을 누가 얼마나 낼지 합의",
        done: false,
        note: "정한 몫은 그날 안에 글로 적어서 양쪽 집안에 똑같이 보내 두세요.",
      },
      { id: "houseware_02", label: "필요한 가전 목록 작성", done: false },
      {
        id: "houseware_03",
        label: "가전 가격 비교 및 구매",
        done: false,
        note: "적힌 값에 배송과 설치, 쓰던 가전 수거까지 들어 있는지 계산 전에 물어보세요.",
      },
      {
        id: "houseware_04",
        label: "가구 리스트 및 배치 계획",
        done: false,
        note: "주문하기 전에 들어갈 집 치수를 직접 재고 문이 열리는 방향까지 그려 보세요.",
      },
      {
        id: "houseware_05",
        label: "가구 구매 및 배송 일정 확인",
        done: false,
        note: "신혼집에 들어가는 날과 배송일이 어긋나면 보관비가 따로 붙는지 주문 전에 물어보세요.",
      },
      { id: "houseware_06", label: "침구와 생활용품 구매", done: false },
      { id: "houseware_07", label: "신혼집 입주 및 정리", done: false },
    ],
  },
  {
    key: "housing",
    label: PLANNING_CATEGORY_LABELS.housing,
    icon: "Key",
    tip: "예산, 출퇴근, 교통, 생활 편의를 함께 비교하세요. 대출이나 임대 조건은 금융기관과 계약 문서에서 직접 확인하세요.",
    ddayStart: 180,
    ddayDeadline: 60,
    items: [
      { id: "housing_01", label: "신혼집을 보증금으로 빌릴지, 살지, 매달 임대료를 낼지 정하기", done: false },
      {
        id: "housing_02",
        label: "지역 및 예산 범위 확정",
        done: false,
        note: "집을 구하는 값만 세지 말고 이사와 집을 손보는 데 드는 돈까지 예산에 넣을지 먼저 이야기해 보세요.",
      },
      { id: "housing_03", label: "부동산 방문 및 매물 탐색", done: false },
      {
        id: "housing_04",
        label: "대출이 필요하다면 금융기관에서 조건 확인",
        done: false,
        note: "누구 이름으로 받을지에 따라 상환과 세금이 달라지니 명의를 먼저 정하고 가세요.",
      },
      {
        id: "housing_08",
        label: "대출이 나오지 않으면 계약을 되돌릴 수 있는지 확인",
        done: false,
        note: "말로 듣는 데서 끝내지 말고 그 조건을 계약서 특약란에 적어달라고 요청하세요.",
      },
      {
        id: "housing_09",
        label: "계약 기간을 못 채우고 나갈 때 보증금 조건 확인",
        done: false,
        note: "새로 들어올 사람을 구하는 일과 중개 수수료를 누가 맡는지까지 함께 물어보세요.",
      },
      {
        id: "housing_05",
        label: "계약 및 계약금 납부",
        done: false,
        note: "계약서에 입주일을 적기 전에 결혼식 날짜와 어긋나지 않는지 다시 맞춰보세요.",
      },
      {
        id: "housing_06",
        label: "집 수리·벽지·바닥 공사가 필요한지 결정",
        done: false,
        note: "빌린 집이라면 손댄 곳을 나갈 때 되돌려 놓아야 하는지, 그 비용은 누가 내는지 시작 전에 집주인에게 확인하세요.",
      },
      {
        id: "housing_07",
        label: "입주 청소 및 이사 일정 확정",
        done: false,
        note: "짐을 직접 보여주고 받은 값인지, 이사하는 날 더 붙는 비용이 있는지 날짜를 잡기 전에 물어보세요.",
      },
    ],
  },

  // 기본 확인 순서 4: 결혼식 전 세부 항목
  {
    key: "invitation",
    label: PLANNING_CATEGORY_LABELS.invitation,
    icon: "Mail",
    tip: "종이와 모바일 중 필요한 형태를 정하고, 제작 업체의 실제 소요 기간과 발송할 날짜를 확인하세요.",
    ddayStart: 120,
    ddayDeadline: 45,
    items: [
      { id: "invitation_01", label: "종이·모바일 초대장 중 필요한 형태 정하기", done: false },
      { id: "invitation_02", label: "초대장 디자인 초안 선택", done: false },
      {
        id: "invitation_03",
        label: "문구 및 정보 작성",
        done: false,
        note: "계좌번호를 넣을지 말지는 인쇄·배포 전에 두 사람과 두 집안이 함께 정해 두세요.",
      },
      {
        id: "invitation_04",
        label: "하객 명단 정리 및 수량 확정",
        done: false,
        note: "식사 인원을 언제까지 알려야 하는지 결혼식장에 먼저 물어보면 하객 답을 받아 둘 기한이 계산돼요.",
      },
      {
        id: "invitation_05",
        label: "초대장 주문·제작",
        done: false,
        note: "인쇄를 넘기기 전에 준비에 관여하지 않은 사람에게 교정을 한 번 맡기세요.",
      },
      {
        id: "invitation_06",
        label: "수령 및 오류 확인",
        done: false,
        note: "받자마자 날짜와 요일은 달력으로 대조하고, 성함은 소리 내어 한 글자씩 읽어 보세요.",
      },
      {
        id: "invitation_07",
        label: "초대장 보낼 날짜 정하고 발송",
        done: false,
        note: "링크만 덜렁 보내면 가짜 문자로 오해받으니 이름과 날짜·장소를 메시지에 그대로 적어 보내세요.",
      },
    ],
  },
  {
    key: "snap",
    label: PLANNING_CATEGORY_LABELS.snap,
    icon: "Video",
    tip: "결혼식 날 사진과 영상은 서로 다른 상품일 수 있습니다. 촬영 시간, 받는 파일 수, 보정 범위, 전달 날짜를 각각 확인하세요.",
    ddayStart: 120,
    ddayDeadline: 30,
    items: [
      { id: "snap_01", label: "결혼식 날 사진·영상 중 필요한 것 정하기", done: false },
      { id: "snap_02", label: "사진 촬영 업체가 실제로 찍은 사진 비교", done: false },
      { id: "snap_03", label: "영상 촬영 업체 비교 (필요한 경우)", done: false },
      {
        id: "snap_04",
        label: "자연스러운 장면과 연출 장면의 비중 협의",
        done: false,
        note: "연출 장면에 시간이 얼마나 드는지 물어보고, 결혼식장에서 그 시간을 낼 수 있는지도 확인하세요.",
      },
      {
        id: "snap_08",
        label: "촬영을 맡은 사람이 못 올 때 대신할 사람 확인",
        done: false,
        note: "대신 오는 분이 찍은 사진도 미리 볼 수 있는지 물어보고, 사람이 바뀌면 금액은 어떻게 되는지 계약서에 적어 달라고 하세요.",
      },
      {
        id: "snap_09",
        label: "결혼식 날짜가 바뀔 때 촬영도 옮길 수 있는지 확인",
        done: false,
        note: "옮길 수 있는 날이 없으면 취소로 보는지, 그때 드는 비용은 얼마인지 계약서에 적어 달라고 하세요.",
      },
      {
        id: "snap_05",
        label: "계약 및 계약금 납부",
        done: false,
        note: "촬영본을 업체가 홍보에 쓸 수 있는지, 쓰기 전에 알려줄지 계약서에 적어두세요.",
      },
      { id: "snap_06", label: "당일 촬영 동선 사전 협의", done: false },
      {
        id: "snap_07",
        label: "보정해 준 사진과 영상을 받는 날짜 확인",
        done: false,
        note: "받는 날짜만 정하지 말고 파일을 내려받을 수 있는 기간이 언제까지인지도 함께 물어보세요.",
      },
    ],
  },
  {
    key: "shoes",
    label: PLANNING_CATEGORY_LABELS.shoes,
    icon: "Sparkles",
    tip: "옷 길이와 이동 동선을 고려해 신발 높이와 편안함을 확인하세요. 갈아 신을 신발이 필요한지도 함께 정하세요.",
    ddayStart: 90,
    ddayDeadline: 30,
    items: [
      {
        id: "shoes_01",
        label: "드레스에 맞는 굽 높이 결정",
        done: false,
        note: "굽만 신어 보면 알기 어려우니, 긴 자락이 있는 옷을 입은 채 걸어 보고 정하세요.",
      },
      {
        id: "shoes_02",
        label: "결혼식 신발 모양과 편안함 확인",
        done: false,
        note: "새 신발은 바닥이 미끄러울 수 있으니 카펫 위를 한 번 걸어보세요.",
      },
      { id: "shoes_03", label: "결혼식 신발 구매", done: false },
      {
        id: "shoes_04",
        label: "결혼식 뒤 식사나 모임에서 갈아 신을 편한 신발 준비",
        done: false,
        note: "결혼식이 끝나면 두고 오기 쉬운 물건이라 누가 챙겨 나올지 미리 정해 두세요.",
      },
      {
        id: "shoes_05",
        label: "전통 인사용 꽃신·신발 준비 (필요한 경우)",
        done: false,
        note: "한복을 빌린다면 신발도 함께 나오는지, 따로 준비해야 하는지 업체에 미리 물어보세요.",
      },
      { id: "shoes_06", label: "배우자 결혼식 신발 준비", done: false },
    ],
  },
  {
    key: "bouquet",
    label: PLANNING_CATEGORY_LABELS.bouquet,
    icon: "Flower",
    tip: "손에 들 꽃이 필요하다면 원하는 분위기, 생화나 인조 꽃 여부, 전달 시간과 보관 방법을 업체와 확인하세요.",
    ddayStart: 90,
    ddayDeadline: 14,
    items: [
      { id: "bouquet_01", label: "손에 들 꽃을 생화·인조 꽃 중에서 정하기", done: false },
      {
        id: "bouquet_02",
        label: "원하는 꽃 모양과 크기 정하기",
        done: false,
        note: "실제로 한 번 잡아 보고 팔 높이가 편한지 확인한 다음에 고르세요.",
      },
      { id: "bouquet_03", label: "꽃 업체 후보 비교하고 정하기", done: false },
      {
        id: "bouquet_04",
        label: "꽃 색과 종류를 정해 주문",
        done: false,
        note: "고른 꽃을 결혼식 무렵에 구하기 어려우면 무엇으로 바꾸는지 주문 전에 물어보세요.",
      },
      {
        id: "bouquet_05",
        label: "배우자가 옷에 달 작은 꽃 장식도 필요한지 확인",
        done: false,
        note: "옷에 다는 꽃은 핀이 빠지기 쉬우니 고정 방법을 미리 확인해 두세요.",
      },
      {
        id: "bouquet_06",
        label: "결혼식장 꽃 장식이 더 필요한지 협의",
        done: false,
        note: "포함이라고 들은 꽃 장식이 어디까지인지 계약서에 항목으로 적어 달라고 하세요.",
      },
    ],
  },
  {
    key: "gift",
    label: PLANNING_CATEGORY_LABELS.gift,
    icon: "Gift",
    tip: "하객 선물을 준비한다면 대상 인원, 한 사람당 금액, 수량 변경 기한과 남은 물품의 처리 조건을 확인하세요.",
    ddayStart: 90,
    ddayDeadline: 14,
    items: [
      { id: "gift_01", label: "하객 선물 전체 예산 정하기", done: false },
      { id: "gift_02", label: "선물 종류 정하기", done: false },
      { id: "gift_03", label: "선물 업체와 가격 비교", done: false },
      {
        id: "gift_04",
        label: "샘플 확인",
        done: false,
        note: "하객이 하루 끝에 쥐고 돌아갈 물건이니 한 손에 들리는 크기와 무게인지 직접 들어 보세요.",
      },
      {
        id: "gift_05",
        label: "최종 하객 수량 기준 주문",
        done: false,
        note: "선물이 모자라 더 주문하게 되면 결혼식 전에 받을 수 있는지, 며칠 걸리는지 함께 물어보세요.",
      },
      {
        id: "gift_06",
        label: "포장 상태 확인",
        done: false,
        note: "선물이 식품이라면 겉포장에 적힌 소비기한과 보관 온도까지 함께 살펴 두세요.",
      },
      { id: "gift_07", label: "결혼식장에 도착할 날짜와 장소 확인", done: false },
    ],
  },
  {
    key: "mc",
    label: PLANNING_CATEGORY_LABELS.mc,
    icon: "Mic",
    tip: "진행자와 축하 노래가 필요한지 정한 뒤, 맡을 사람과 순서, 필요한 장비, 사전 확인 날짜를 맞추세요.",
    ddayStart: 90,
    ddayDeadline: 14,
    items: [
      { id: "mc_01", label: "결혼식 진행을 맡을 사람 정하기", done: false },
      {
        id: "mc_02",
        label: "전문 진행자를 이용한다면 계약 조건 확인",
        done: false,
        note: "진행자가 못 오게 됐을 때 대신 올 사람이 있는지 계약 전에 확인해 두세요.",
      },
      { id: "mc_03", label: "축하 노래를 부탁할 사람과 곡 정하기", done: false },
      { id: "mc_04", label: "축하 공연이나 별도 행사가 필요한지 정하기", done: false },
      { id: "mc_05", label: "결혼식 진행 순서를 맡은 사람에게 전달", done: false },
      { id: "mc_06", label: "결혼식 전 진행 순서를 맞춰볼 날짜 정하기", done: false },
    ],
  },
  {
    key: "ham",
    label: PLANNING_CATEGORY_LABELS.ham,
    icon: "Box",
    tip: "전통 혼례 선물인 함을 진행할지는 가족과 먼저 합의하세요. 진행한다면 내용물, 전달 방식, 날짜와 비용을 정리하세요.",
    ddayStart: 60,
    ddayDeadline: 7,
    items: [
      { id: "ham_01", label: "전통 혼례 선물인 함을 진행할지 가족과 합의", done: false },
      {
        id: "ham_02",
        label: "전통 방식과 간단한 방식 중 범위 정하기",
        done: false,
        note: "짧게 끝내거나 아예 생략하는 집도 많으니 어느 선까지 할지 두 집안과 맞춰보세요.",
      },
      {
        id: "ham_03",
        label: "전달할 사람과 방법 정하기",
        done: false,
        note: "함을 들 사람 말고 사진과 영상을 남길 사람도 그날 전에 함께 정해 두세요.",
      },
      {
        id: "ham_04",
        label: "함에 넣을 물품을 가족과 확인",
        done: false,
        note: "청혼의 뜻을 적은 글을 함께 넣는 집도 있으니 누가 쓸지 미리 정해 두세요.",
      },
      { id: "ham_05", label: "함을 전달할 날짜 정하기", done: false },
      {
        id: "ham_06",
        label: "전달 과정에 드는 비용 확인",
        done: false,
        note: "봉투와 대접할 음식까지 미리 이야기해 두면 그 자리에서 실랑이가 생기지 않아요.",
      },
    ],
  },
  {
    key: "pyebaek",
    label: PLANNING_CATEGORY_LABELS.pyebaek,
    icon: "Heart",
    tip: "결혼식 뒤 전통 인사를 진행할지는 가족과 먼저 합의하세요. 진행한다면 의상, 음식, 장소와 비용을 각각 확인하세요.",
    ddayStart: 60,
    ddayDeadline: 7,
    items: [
      { id: "pyebaek_01", label: "결혼식 뒤 전통 인사를 진행할지 가족과 합의", done: false },
      { id: "pyebaek_02", label: "진행한다면 음식 업체와 품목 정하기", done: false },
      {
        id: "pyebaek_03",
        label: "전통 인사에 쓸 음식 주문",
        done: false,
        note: "결혼식장에서 음식까지 차려 주는지 먼저 알아본 다음에 업체에 맡기세요.",
      },
      { id: "pyebaek_04", label: "결혼식장 안에 진행할 장소가 있는지 확인", done: false },
      {
        id: "pyebaek_05",
        label: "진행 순서를 미리 확인",
        done: false,
        note: "절 순서와 횟수는 집안마다 달라서, 맞히려 하기보다 인사를 받으실 어른께 직접 여쭤보세요.",
      },
      { id: "pyebaek_06", label: "입을 한복과 신발 확인", done: false },
    ],
  },
];

// 카테고리 키로 템플릿 빠르게 조회
export const CHECKLIST_MAP = Object.fromEntries(
  CATEGORY_CHECKLISTS.map((c) => [c.key, c])
) as Record<string, CategoryChecklistTemplate>;
