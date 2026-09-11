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
  greeting: "배우자 부모님께 첫인사",
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
  registration: "혼인신고와 주소·보험 신고",
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
  // 기본 확인 순서 0: 두 사람이 각자 다녀오는 자리
  {
    key: "greeting",
    label: PLANNING_CATEGORY_LABELS.greeting,
    icon: "Users",
    tip: "배우자의 가족이나 보호자와 처음 인사를 나누는 자리입니다. 동행 여부와 날짜·장소를 함께 정하고 나눌 이야기와 필요한 배려를 먼저 맞춰보세요.",
    ddayStart: 390,
    ddayDeadline: 330,
    items: [
      {
        id: "greeting_01",
        label: "첫인사 날짜와 시간, 만날 곳 확정",
        done: false,
        note: "함께 갈지 따로 갈지, 집이나 식당 중 어디가 편한지 만날 분들과 먼저 맞춰 보세요.",
      },
      {
        id: "greeting_02",
        label: "결혼 계획을 어디까지 말할지 두 사람이 맞춰보기",
        done: false,
        note: "한 사람만 알고 있는 이야기가 그 자리에서 처음 나오지 않게 미리 나눠 보세요.",
      },
      {
        id: "greeting_03",
        label: "그 집에서 조심할 이야기 배우자에게 묻기",
        done: false,
        note: "나누기 불편한 가족 이야기와 미리 알려둘 음식·이동 배려가 있는지 필요한 범위만 물어보세요.",
      },
      {
        id: "greeting_04",
        label: "첫인사 때 드릴 선물이나 꽃 준비 (필요한 경우)",
        done: false,
        note: "선물이 필요한지 먼저 묻고 예산·취향·알레르기와 식품 보관 여건을 함께 확인하세요.",
      },
      {
        id: "greeting_05",
        label: "첫인사에서 들은 이야기 두 사람이 함께 확인",
        done: false,
        note: "서로 들은 날짜와 비용 이야기가 같은지 확인하고, 다른 가족에게 전할 내용은 함께 정해 주세요.",
      },
    ],
  },
  // 기본 확인 순서 1: 먼저 합의할 항목
  {
    key: "meeting",
    label: PLANNING_CATEGORY_LABELS.meeting,
    icon: "Users",
    tip: "두 사람이 양쪽 부모님과 처음 함께 만나는 일정입니다. 날짜·장소·참석자와 이 자리에서 나눌 주제를 미리 맞춰보세요.",
    ddayStart: 360,
    ddayDeadline: 300,
    items: [
      {
        id: "meeting_01",
        label: "양쪽 부모님 첫 만남 날짜 조율",
        done: false,
        note: "부모님 외에 함께할 가족이나 보호자가 있는지 확인하고 참석 가능한 날을 맞춰 보세요.",
      },
      {
        id: "meeting_02",
        label: "만날 장소 정하고 예약",
        done: false,
        note: "직접 방문하거나 식당에 문의해 좌석·소음·이동 편의와 식이 제한을 확인하세요.",
      },
      {
        id: "meeting_07",
        label: "식사비를 누가 낼지 미리 정하기",
        done: false,
        note: "누가 낼지 그 자리에서 정하지 말고, 두 사람이 각자 부모님 생각을 먼저 여쭤보세요.",
      },
      {
        id: "meeting_03",
        label: "참석자와 옷차림 확인",
        done: false,
        note: "형제자매도 함께 오는지, 어느 정도로 차려입을지 두 집안에 같은 질문으로 미리 물어보세요.",
      },
      { id: "meeting_04", label: "서로 드릴 선물이 필요한지 합의", done: false, note: "선물을 생략할 수도 있어요. 준비한다면 대상과 부담 없는 예산을 함께 정해 주세요.",},
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
        note: "서로 이해한 내용이 같은지 적어 확인하고 가족에게 전달할 범위와 시점을 정해 주세요.",
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
      {
        id: "venue_01",
        label: "원하는 결혼식장 형태 정하기",
        done: false,
        note: "종교시설에서 하실 생각이면 그곳에 먼저 가능한 일정과 미리 받아야 할 절차가 있는지 물어보세요.",
      },
      { id: "venue_02", label: "비교할 장소 후보 정리", done: false, note: "같은 날짜와 인원 조건으로 견적을 요청하고 포함 항목과 추가 비용을 나란히 비교하세요.",},
      {
        id: "venue_03",
        label: "장소 방문 날짜 예약하고 직접 확인",
        done: false,
        note: "입구에서 식장·화장실까지 계단 없이 갈 수 있는지 방문한 날 직접 걸어서 확인해 보세요.",
      },
      {
        id: "venue_04",
        label: "하객 식사 메뉴와 1인당 금액 확인",
        done: false,
        note: "주류와 음료, 아이 식사가 식대에 포함인지 별도인지 항목으로 나눠 받아두세요.",
      },
      { id: "venue_05", label: "결혼식 시간대 정하기", done: false, note: "하객 이동과 두 사람의 준비 시간을 고려하고 다른 예식과 공간을 나눠 쓰는지도 물어보세요.",},
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
        note: "대기실 이용 시작·종료, 사진 촬영 가능 시간과 주차 지원 범위를 서면으로 확인하세요.",
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
      { id: "studio_01", label: "원하는 사진 분위기와 촬영 장소 정하기", done: false, note: "원하는 장면과 피하고 싶은 연출을 각각 골라 촬영자에게 보여줄 참고 사진을 정리하세요.",},
      { id: "studio_02", label: "사진 촬영 업체 후보 비교", done: false, note: "같은 촬영 시간과 결과물 조건으로 비교하고 담당자 변경 가능성도 확인하세요.",},
      { id: "studio_03", label: "업체가 실제로 찍은 사진과 이용 후기 확인", done: false, note: "홍보용 대표 사진 외에 한 팀의 전체 촬영 결과와 후기가 어떤 상품인지 확인하세요.",},
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
        note: "준비·이동·촬영·휴식에 걸릴 시간을 업체에 물어보고 두 사람 일정에 여유를 두세요.",
      },
      {
        id: "studio_09",
        label: "촬영 취소나 날짜 변경 때 돌려받는 금액 확인",
        done: false,
        note: "패키지의 계약 상대방과 취소 접수 방법을 확인하고 업체별 적용 조건을 서면으로 받아두세요.",
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
        note: "계약 장소와 체결 방식에 맞는 취소·철회 조건을 확인하고 계약서와 결제 증빙을 보관하세요.",
      },
      { id: "studio_07", label: "원하는 사진 분위기와 입을 옷 협의", done: false, note: "필요한 의상·소품의 준비 담당, 옷 갈아입는 장소와 촬영 중 휴식 시간을 맞춰 주세요.",},
      {
        id: "studio_08",
        label: "보정해 준 사진 확인하고 받을 사진 선택",
        done: false,
        note: "고른 뒤에 바꿀 수 있는지, 고르지 않은 사진은 언제까지 남아 있는지 함께 물어보세요.",
      },
      {
        id: "studio_11",
        label: "완성된 사진 파일과 앨범 받고 확인 (해당하는 경우)",
        done: false,
        note: "받은 자리에서 파일이 열리는지 확인하고 고른 사진이 다 들어왔는지 맞춰 보세요.",
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
      { id: "dress_01", label: "원하는 드레스 분위기와 편안함 기준 정하기", done: false, note: "드레스나 정장 등 입고 싶은 옷부터 정하고 앉기·걷기와 온도에 불편함이 없는지 살펴보세요.",},
      { id: "dress_02", label: "비교할 드레스 매장 후보 정리", done: false, note: "대여와 구매, 입어보는 비용·추가 옵션·수선 및 반납 조건을 같은 기준으로 비교하세요.",},
      {
        id: "dress_03",
        label: "드레스 입어볼 날짜 예약하고 방문",
        done: false,
        note: "예약할 때 하루에 몇 벌을 입어 볼 수 있는지, 현장에서 따로 내는 돈이 있는지 물어보세요.",
      },
      { id: "dress_04", label: "최종 드레스 선정", done: false, note: "추가 비용과 취소 조건을 확인하고 선택한 옷의 모델·색상·포함품을 문서에 남겨 주세요.",},
      {
        id: "dress_05",
        label: "드레스를 몸에 맞게 고치는 날짜 확인",
        done: false,
        note: "그 날짜 뒤에 몸이 달라지면 다시 손볼 수 있는지, 값이 더 붙는지 함께 물어보세요.",
      },
      { id: "dress_06", label: "머리에 쓰는 면사포·머리 장식·장갑·신발 포함 여부 확인", done: false, note: "액세서리별 포함 여부와 별도 요금, 직접 준비할 수 있는 범위를 목록으로 받아두세요.",},
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
      {
        id: "dress_09",
        label: "빌린 드레스와 예식 정장 돌려주기 (해당하는 경우)",
        done: false,
        note: "언제까지 어디로 가져가야 하는지, 맡긴 돈이 있다면 언제 돌아오는지 함께 물어보세요.",
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
      { id: "makeup_01", label: "원하는 헤어·메이크업 분위기 사진 정리", done: false, note: "원하는 분위기와 피할 제품을 정리하고 피부 민감성이나 알레르기는 담당자에게 알려 주세요.",},
      { id: "makeup_02", label: "헤어·메이크업 업체 후보 비교", done: false, note: "담당자·준비 장소·이동 비용과 이른 시간 추가 요금을 포함해 비교하세요.",},
      { id: "makeup_03", label: "업체가 실제로 한 작업과 이용 후기 확인", done: false, note: "조명과 보정이 다른 사진만으로 판단하지 말고 실제 담당자의 작업 예시를 확인하세요.",},
      {
        id: "makeup_04",
        label: "결혼식 전에 미리 받아볼 날짜 예약",
        done: false,
        note: "미리 받아보는 비용과 당일 담당자가 같은지 확인하고 필요할 때만 예약하세요.",
      },
      { id: "makeup_05", label: "미리 받아보고 사진으로 남겨 확인", done: false, note: "미리 받아본다면 자연광과 실내에서 편안함·지속력·피부 반응을 살펴 수정점을 적어 주세요.",},
      {
        id: "makeup_06",
        label: "수정 사항 전달",
        done: false,
        note: "불편했던 부분과 원하는 수정점을 구체적으로 전하고 새 제품 사용은 미리 상의하세요.",
      },
      { id: "makeup_07", label: "결혼식 날 헤어·메이크업 최종 확인", done: false, note: "준비 시작·완료 시간과 이동 동선, 늦어질 때 연락할 사람을 함께 확인하세요.",},
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
      { id: "ring_01", label: "결혼반지·기념 선물 전체 예산 정하기", done: false, note: "각자 낼 금액과 무리 없는 상한을 정하고 반지 외에 필요한 선물이 있는지 확인하세요.",},
      { id: "ring_02", label: "준비할 품목 정하기", done: false, note: "착용 빈도와 취향을 이야기하고 반지나 선물을 생략할지까지 함께 정해 주세요.",},
      { id: "ring_03", label: "완성된 반지를 파는 매장과 직접 만들어 주는 매장 비교", done: false, note: "제품 가격뿐 아니라 제작 기간과 취소·교환·수리 조건을 같은 기준으로 비교하세요.",},
      { id: "ring_04", label: "후보 매장 방문하고 가격·조건 비교", done: false, note: "재질·중량·보증 범위가 같은 상품인지 확인하고 최종 견적을 서면으로 받아두세요.",},
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
      { id: "ring_07", label: "반지 안쪽에 새길 문구 정하기 (필요한 경우)", done: false, note: "철자와 날짜를 두 사람이 대조하고 각인 뒤 변경·취소 비용도 확인하세요.",},
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
        note: "여쭐 어른이 계시면 어느 분까지 입으실지 먼저 여쭤보고, 아니면 두 사람 것부터 정하세요.",
      },
      { id: "hanbok_03", label: "한복 업체 후보 방문하고 비교", done: false, note: "대여·맞춤별 포함품과 수령·반납, 오염이나 손상 때 비용을 함께 비교하세요.",},
      { id: "hanbok_04", label: "한복 천과 색상 선택", done: false, note: "입는 사람의 취향과 움직임을 먼저 확인하고 특정 성별이나 가족 역할의 색을 강요하지 마세요.",},
      {
        id: "hanbok_05",
        label: "치수 측정 및 주문",
        done: false,
        note: "속치마와 버선처럼 함께 갖춰야 할 것도 주문에 들어가는지 확인해 두세요.",
      },
      { id: "hanbok_06", label: "완성 전에 치수와 모양 중간 확인", done: false, note: "입고 앉거나 걸어 보고 불편한 부분과 수정 후 다시 확인할 날짜를 정해 주세요.",},
      {
        id: "hanbok_07",
        label: "완성된 한복 입어보고 수령",
        done: false,
        note: "받는 자리에서 단추와 끈을 직접 매어 보면 결혼식 당일에 입는 시간이 줄어요.",
      },
      {
        id: "hanbok_08",
        label: "빌린 한복 돌려주기 (해당하는 경우)",
        done: false,
        note: "빌릴 때 함께 받은 것을 목록으로 적어 두고 가져가기 전에 맞춰 보세요.",
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
        note: "두 사람이 먼저 원하는 범위와 예산을 이야기하고 가족에게 전할 내용을 함께 정해 주세요.",
      },
      {
        id: "yedan_02",
        label: "준비할 품목과 전체 예산 정하기",
        done: false,
        note: "정해진 품목이나 금액은 없어요. 생략·간소화 여부와 받는 분의 필요를 먼저 확인하세요.",
      },
      { id: "yedan_03", label: "필요한 품목의 업체와 가격 비교", done: false, note: "같은 품목·수량으로 비교하고 보관·배송과 교환 조건까지 견적에 포함해 주세요.",},
      { id: "yedan_04", label: "최종 선물 품목과 수량 확인", done: false, note: "받는 분과 품목·수량을 대조하고 변경 가능한 기한을 업체에 확인하세요.",},
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
      { id: "honeymoon_01", label: "국내 또는 해외 여행지 정하기", done: false, note: "예산·이동 시간·휴식 계획과 여행지의 공식 안전 안내를 함께 보고 정해 주세요.",},
      {
        id: "honeymoon_02",
        label: "여행 일정 및 기간 확정",
        done: false,
        note: "결혼식 날짜가 밀릴 수도 있으니 일정을 바꾸거나 취소할 때 어떤 비용이 생기는지 예약 전에 물어보세요.",
      },
      {
        id: "honeymoon_09",
        label: "각자 회사에 결혼 휴가 신청하기 (해당하는 경우)",
        done: false,
        note: "며칠을 쓸 수 있는지, 언제까지 내야 하는지가 회사마다 달라서 여행 날짜를 굳히기 전에 물어보세요.",
      },
      { id: "honeymoon_03", label: "항공권 예약", done: false, note: "여권과 같은 영문 이름인지 대조하고 수하물·경유지 입국 조건·취소 요금을 확인하세요.",},
      {
        id: "honeymoon_04",
        label: "숙소 예약",
        done: false,
        note: "세금·보증금·취소 비용과 도착 시간을 확인하고 늦게 도착할 때 입실 방법도 물어보세요.",
      },
      {
        id: "honeymoon_05",
        label: "여행자 보험 가입",
        done: false,
        note: "보장 제외 사항과 질환·활동별 조건을 확인하고 필요한 범위의 상품인지 비교하세요.",
      },
      {
        id: "honeymoon_06",
        label: "여권과 비자 필요 여부 확인하고 갱신",
        done: false,
        note: "목적지와 경유지의 공식 안내에서 여권 잔여기간·비자·입국 요건을 예약 전과 출발 전에 확인하세요.",
      },
      { id: "honeymoon_07", label: "현지 여행 프로그램 예약 (필요한 경우)", done: false, note: "운영 업체와 만나는 장소, 취소·기상 악화 때 처리 방법과 안전 조건을 확인하세요.",},
      { id: "honeymoon_08", label: "환전 및 카드 준비", done: false, note: "해외 결제 가능 여부와 수수료를 확인하고 분실 때 정지할 연락처를 따로 보관하세요.",},
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
        note: "정한 몫을 두 사람이 확인하고 가족의 지원이 있다면 그분들과 나눌 내용만 함께 정해 주세요.",
      },
      { id: "houseware_02", label: "필요한 가전 목록 작성", done: false, note: "이미 가진 물건과 이사할 집의 설치 공간을 대조하고 꼭 필요한 것부터 골라 주세요.",},
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
      { id: "houseware_06", label: "침구와 생활용품 구매", done: false, note: "함께 쓰는 생활 습관과 수납 공간을 확인하고 당장 필요한 물건과 나중에 정할 물건을 나눠 보세요.",},
      { id: "houseware_07", label: "신혼집 입주 및 정리", done: false, note: "배송 동선·엘리베이터 예약과 설치에 필요한 전기·급수 조건을 관리사무소에 확인하세요.",},
      {
        id: "houseware_08",
        label: "배송받은 자리에서 설치와 상태 확인",
        done: false,
        note: "흠집·누락·작동 상태를 확인해 사진을 남기고 교환·수리 접수 방법을 판매자에게 물어보세요.",
      },
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
      { id: "housing_01", label: "신혼집을 보증금으로 빌릴지, 살지, 매달 임대료를 낼지 정하기", done: false, note: "월 지출과 목돈, 거주 기간을 함께 계산하고 각 방식의 계약 조건을 비교하세요.",},
      {
        id: "housing_02",
        label: "지역 및 예산 범위 확정",
        done: false,
        note: "집을 구하는 값만 세지 말고 이사와 집을 손보는 데 드는 돈까지 예산에 넣을지 먼저 이야기해 보세요.",
      },
      {
        id: "housing_12",
        label: "신혼집 자금을 누가 얼마나 낼지 합의",
        done: false,
        note: "두 집안에서 보태 주시는 돈이 있다면 그냥 주시는 것인지 나중에 갚는 것인지까지 함께 확인해 두세요.",
      },
      { id: "housing_03", label: "부동산 방문 및 매물 탐색", done: false, note: "낮과 저녁의 소음·채광·교통을 살펴보고 누수·곰팡이·설비 상태도 기록하세요.",},
      {
        id: "housing_04",
        label: "대출이 필요하다면 금융기관에서 조건 확인",
        done: false,
        note: "명의·소득·기존 대출별 조건을 금융기관에 비교 문의한 뒤 차입자와 상환 계획을 정해 주세요.",
      },
      {
        id: "housing_08",
        label: "대출이 나오지 않으면 계약을 되돌릴 수 있는지 확인",
        done: false,
        note: "대출이나 반환보증이 거절될 경우 계약금 반환 조건을 서면으로 협의하고 문구를 검토받으세요.",
      },
      {
        id: "housing_09",
        label: "계약 기간을 못 채우고 나갈 때 보증금 조건 확인",
        done: false,
        note: "중도 해지 가능 조건과 통지 방법, 보증금 반환 시점·비용 부담을 서면으로 확인하세요.",
      },
      {
        id: "housing_10",
        label: "계약 전에 등기부등본으로 집 주인과 빚 상태 확인",
        done: false,
        note: "소유자·대리 권한과 선순위 권리, 건축물대장·체납 자료·반환보증 조건을 함께 확인하세요.",
      },
      {
        id: "housing_05",
        label: "계약 및 계약금 납부",
        done: false,
        note: "계약 당사자와 계좌 명의, 계약 유형별 신고·세금·등기 절차와 기한을 확인한 뒤 지급하세요.",
      },
      {
        id: "housing_13",
        label: "주택 임대차 계약 신고 대상 확인하고 신고하기 (해당하는 경우)",
        done: false,
        note: "입주일이 아니라 계약 체결일을 기준으로 대상 여부와 신고 기한을 공식 안내에서 확인하세요.",
      },
      {
        id: "housing_06",
        label: "집 수리·벽지·바닥 공사가 필요한지 결정",
        done: false,
        note: "빌린 집이라면 손댄 곳을 나갈 때 되돌려 놓아야 하는지, 비용은 누가 내는지 시작 전에 집주인에게 확인하세요.",
      },
      {
        id: "housing_07",
        label: "입주 청소 및 이사 일정 확정",
        done: false,
        note: "짐을 직접 보여주고 받은 값인지, 이사하는 날 더 붙는 비용이 있는지 날짜를 잡기 전에 물어보세요.",
      },
      {
        id: "housing_11",
        label: "남은 금액 납부하고 열쇠 받기",
        done: false,
        note: "송금 직전 권리 변동과 수취인을 다시 확인하고 열쇠·인도 상태·지급 증빙을 남겨 주세요.",
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
      { id: "invitation_01", label: "종이·모바일 초대장 중 필요한 형태 정하기", done: false, note: "받는 분의 이용 편의와 공개할 개인정보 범위를 고려해 종이와 모바일의 필요량을 정해 주세요.",},
      {
        // 171항목 중 축의금에 닿는 유일한 항목이다. 예절 안내가 "예식이 끝난 뒤에
        // 처음 꺼내면 반드시 감정이 상한다"며 초대장 발송 전을 시한으로 못 박는데,
        // 그 시한이 걸린 분야가 바로 여기인데도 항목이 없었다.
        id: "invitation_09",
        label: "축의금을 누가 받고 어떻게 나눌지 두 집안과 정하기",
        done: false,
        note: "초대장 발송 전에 접수·정산 담당과 분배 기준을 두 사람이 맞추고 관련 가족과 공유 범위를 정해 주세요.",
      },
      { id: "invitation_02", label: "초대장 디자인 초안 선택", done: false, note: "작은 화면에서도 날짜·장소가 잘 읽히는지, 지도와 연락 링크가 작동하는지 확인하세요.",},
      {
        id: "invitation_03",
        label: "문구 및 정보 작성",
        done: false,
        note: "날짜·장소를 대조하고 이름·연락처·사진·계좌를 넣을 분들의 동의를 확인하세요.",
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
        note: "개인정보를 외부에 넘기기 전에 동의를 확인하고 인쇄·발송 전 내용을 다시 대조하세요.",
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
        note: "이름과 날짜·장소를 함께 안내하고 실제로 보낼 링크가 맞는지 직접 열어 확인하세요.",
      },
      {
        id: "invitation_08",
        label: "결혼식장에 최종 식사 인원 알리기",
        done: false,
        note: "보낸 명단이 아니라 오겠다고 답한 사람을 세고, 부모님 쪽 인원은 두 집안에 미리 여쭤 두세요.",
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
      { id: "snap_01", label: "결혼식 날 사진·영상 중 필요한 것 정하기", done: false, note: "필요한 장면과 결과물을 정하고 사진·영상의 담당 범위와 중복 촬영 여부를 확인하세요.",},
      { id: "snap_02", label: "사진 촬영 업체가 실제로 찍은 사진 비교", done: false, note: "한 예식의 전체 결과를 보고 어두운 실내나 움직이는 장면의 품질도 확인하세요.",},
      { id: "snap_03", label: "영상 촬영 업체 비교 (필요한 경우)", done: false, note: "촬영 시간·편집 길이·음원 사용과 결과물 전달 조건을 같은 기준으로 비교하세요.",},
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
        note: "홍보 사용 여부와 공개 범위를 사전에 동의할지 정하고 거절·철회 방법까지 서면으로 확인하세요.",
      },
      { id: "snap_06", label: "당일 촬영 동선 사전 협의", done: false, note: "찍고 싶은 사람과 장면, 촬영을 원치 않는 분의 의사와 이동 편의를 함께 전달하세요.",},
      {
        id: "snap_07",
        label: "보정해 준 사진과 영상을 받는 날짜 확인",
        done: false,
        note: "받는 날짜만 정하지 말고 파일을 내려받을 수 있는 기간이 언제까지인지도 함께 물어보세요.",
      },
      {
        id: "snap_10",
        label: "완성된 사진과 영상 내려받아 따로 보관",
        done: false,
        note: "빠진 장면이 없는지 확인하고 다른 곳에도 한 벌 옮겨 두세요.",
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
      { id: "shoes_03", label: "결혼식 신발 구매", done: false, note: "입을 옷과 함께 걸어보고 교환 가능 조건과 필요한 수선 여부를 확인하세요.",},
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
      { id: "shoes_06", label: "배우자 결혼식 신발 준비", done: false, note: "두 사람이 신을 신발을 각자 골라보고 행사 동선에서 편하게 움직일 수 있는지 확인하세요.",},
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
      { id: "bouquet_01", label: "손에 들 꽃을 생화·인조 꽃 중에서 정하기", done: false, note: "무게·보관·알레르기와 사용 뒤 처리 방법을 비교하고 꽃이 필요한지도 함께 정해 주세요.",},
      {
        id: "bouquet_02",
        label: "원하는 꽃 모양과 크기 정하기",
        done: false,
        note: "실제로 한 번 잡아 보고 팔 높이가 편한지 확인한 다음에 고르세요.",
      },
      { id: "bouquet_03", label: "꽃 업체 후보 비교하고 정하기", done: false, note: "원하는 크기와 전달 조건으로 비교하고 꽃 종류가 바뀔 때의 대안과 비용을 확인하세요.",},
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
        note: "옷 손상과 피부 불편이 없는 고정 방법을 확인하고 직접 달아볼 수 있는지 물어보세요.",
      },
      {
        id: "bouquet_06",
        label: "결혼식장 꽃 장식이 더 필요한지 협의",
        done: false,
        note: "포함이라고 들은 꽃 장식이 어디까지인지 계약서에 항목으로 적어 달라고 하세요.",
      },
      {
        id: "bouquet_07",
        label: "결혼식 당일 꽃이 도착할 시간과 장소 확인",
        done: false,
        note: "받을 장소와 담당자를 정하고 연락처를 업체에 전달해도 되는지 당사자에게 확인하세요.",
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
      { id: "gift_01", label: "하객 선물 전체 예산 정하기", done: false, note: "선물을 생략할지도 함께 정하고 준비한다면 수량과 배송비까지 포함한 상한을 정해 주세요.",},
      { id: "gift_02", label: "선물 종류 정하기", done: false, note: "받는 분들의 이동·보관 편의와 식품 알레르기를 고려하고 선택하기 어려우면 간소화하세요.",},
      { id: "gift_03", label: "선물 업체와 가격 비교", done: false, note: "같은 수량으로 견적을 받고 주문 변경·취소와 배송 지연 때 처리 조건을 확인하세요.",},
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
      { id: "gift_07", label: "결혼식장에 도착할 날짜와 장소 확인", done: false, note: "행사장에서 받을 담당자와 보관 장소를 정하고 누락·파손이 생길 때 연락 방법을 확인하세요.",},
    ],
  },
  {
    key: "mc",
    label: PLANNING_CATEGORY_LABELS.mc,
    icon: "Mic",
    tip: "주례와 진행자, 축하 노래가 각각 필요한지 정한 뒤, 맡을 사람과 순서, 필요한 장비, 사전 확인 날짜를 맞추세요.",
    ddayStart: 90,
    ddayDeadline: 14,
    items: [
      {
        id: "mc_01",
        label: "결혼식 진행을 맡을 사람 정하기",
        done: false,
        note: "맡을 일과 시간을 설명해 동의를 구하고 부담되면 거절해도 괜찮다고 먼저 전해 주세요.",
      },
      {
        id: "mc_02",
        label: "전문 진행자를 이용한다면 계약 조건 확인",
        done: false,
        note: "진행자가 못 오게 됐을 때 대신 올 사람이 있는지 계약 전에 확인해 두세요.",
      },
      {
        id: "mc_03",
        label: "축하 노래를 부탁할 사람과 곡 정하기",
        done: false,
        note: "곡 전체의 가사와 길이를 함께 확인하고 부를 분의 의사와 음향 준비를 맞춰 주세요.",
      },
      {
        id: "mc_04",
        label: "축하 공연이나 별도 행사가 필요한지 정하기",
        done: false,
        note: "넣기로 하면 앞뒤 순서에서 시간을 얼마나 쓸지 결혼식장과 먼저 맞춰 보세요.",
      },
      {
        id: "mc_07",
        label: "주례를 모실지 정하고 부탁드리기",
        done: false,
        note: "주례가 없어도 괜찮아요. 두 사람이 원하는 진행 순서와 생략할 부분을 진행 담당자와 정해 주세요.",
      },
      {
        id: "mc_05",
        label: "결혼식 진행 순서를 맡은 사람에게 전달",
        done: false,
        note: "순서표만 보내지 말고 맡은 분의 이름과 관계를 어떻게 부를지까지 함께 전하세요.",
      },
      {
        id: "mc_06",
        label: "결혼식 전 진행 순서를 맞춰볼 날짜 정하기",
        done: false,
        note: "음향 장비로 노래를 실제 틀어 보는 시간까지 그날 안에 넣어 두세요.",
      },
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
      { id: "ham_01", label: "전통 혼례 선물인 함을 진행할지 가족과 합의", done: false, note: "두 사람이 원하는 방식부터 이야기하고 생략하거나 간소화하는 선택도 함께 검토해 주세요.",},
      {
        id: "ham_02",
        label: "전통 방식과 간단한 방식 중 범위 정하기",
        done: false,
        note: "정해진 방식에 맞추기보다 하고 싶은 것과 부담스러운 것을 나눠 범위를 맞춰 주세요.",
      },
      {
        id: "ham_03",
        label: "전달할 사람과 방법 정하기",
        done: false,
        note: "참여할 분들에게 역할과 시간을 설명하고 사진·영상 촬영도 각자의 의사를 확인하세요.",
      },
      {
        id: "ham_04",
        label: "함에 넣을 물품을 가족과 확인",
        done: false,
        note: "넣고 싶은 물품과 뜻을 가족에게 물어보고 필요하지 않은 것은 생략해도 괜찮아요.",
      },
      { id: "ham_05", label: "함을 전달할 날짜 정하기", done: false, note: "받는 분들의 일정과 이동·소음을 고려하고 장소 이용 조건도 미리 확인하세요.",},
      {
        id: "ham_06",
        label: "전달 과정에 드는 비용 확인",
        done: false,
        note: "선물·음식·이동에 쓸 예산과 부담할 사람을 미리 정하고 원치 않는 비용은 거절해도 괜찮아요.",
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
      { id: "pyebaek_01", label: "결혼식 뒤 전통 인사를 진행할지 가족과 합의", done: false, note: "두 사람의 의사를 먼저 나누고 생략·간소화 여부를 참여할 가족과 함께 맞춰 주세요.",},
      { id: "pyebaek_02", label: "진행한다면 음식 업체와 품목 정하기", done: false, note: "참여 인원과 식이 제한을 확인하고 음식·의상·진행이 이미 포함되어 있는지 비교하세요.",},
      {
        id: "pyebaek_03",
        label: "전통 인사에 쓸 음식 주문",
        done: false,
        note: "결혼식장에서 음식까지 차려 주는지 먼저 알아본 다음에 업체에 맡기세요.",
      },
      { id: "pyebaek_04", label: "결혼식장 안에 진행할 장소가 있는지 확인", done: false, note: "이동 동선·준비 시간·별도 요금과 앉거나 절하기 어려운 분을 위한 대안을 확인하세요.",},
      {
        id: "pyebaek_07",
        label: "주문한 음식이 도착할 시간과 장소 확인",
        done: false,
        note: "상하기 쉬운 것이 있는지, 남은 음식은 어떻게 하는지 업체에 미리 물어보세요.",
      },
      {
        id: "pyebaek_05",
        label: "진행 순서를 미리 확인",
        done: false,
        note: "참여자의 의사를 먼저 묻고 절이나 신체 접촉이 부담스러우면 말로 인사하는 방법도 정해 주세요.",
      },
      { id: "pyebaek_06", label: "입을 한복과 신발 확인", done: false, note: "맞는 치수와 포함품을 확인하고 움직이기 불편하지 않은지 입고 걸어보세요.",},
    ],
  },

  {
    key: "registration",
    label: PLANNING_CATEGORY_LABELS.registration,
    icon: "FileText",
    tip: "혼인신고 시기는 두 사람이 정하되 상황별 절차와 기한을 확인하세요. 임대차·이사 관련 신고는 혼인신고 순서와 관계없이 해당 일정에 맞춰 확인하세요.",
    ddayStart: 90,
    ddayDeadline: -30,
    items: [
      {
        id: "registration_01",
        label: "혼인신고를 언제 할지 두 사람이 정하기",
        done: false,
        note: "국내에서 새로 혼인하는 경우와 외국에서 성립한 혼인을 신고하는 경우의 기한을 구분해 확인하세요.",
      },
      {
        id: "registration_02",
        label: "혼인신고 시기가 세금에 영향을 주는지 알아보기 (해당하는 경우)",
        done: false,
        note: "미루기로 정하기 전에 두 사람 각각 해당되는지 국세청 안내로 먼저 확인해 보세요.",
      },
      {
        id: "registration_03",
        label: "자녀의 성과 본을 어떻게 할지 이야기하기",
        done: false,
        note: "어머니의 성과 본을 따를 협의가 필요한지 두 사람이 이야기하고 신고서 안내와 변경 절차를 확인하세요.",
      },
      {
        id: "registration_04",
        label: "혼인신고서에 적을 등록기준지 확인하기",
        done: false,
        note: "각자의 등록기준지를 확인하고 증명서를 제출해야 하는지도 접수기관에 미리 물어보세요.",
      },
      {
        id: "registration_05",
        label: "성인 증인 두 사람에게 신고서 서명 부탁하기",
        done: false,
        note: "증인이 적을 사항과 서명 방법을 신고서 안내에서 확인하고 방문 전에 준비하세요.",
      },
      {
        id: "registration_06",
        label: "혼인신고를 접수하는 곳 확인하기",
        done: false,
        note: "주소 옮기는 신고를 받는 곳과 안내되는 곳이 달라서 출발 전에 전화로 물어보세요.",
      },
      {
        id: "registration_07",
        label: "한 사람만 갈 때 필요한 서류 확인하기 (해당하는 경우)",
        done: false,
        note: "서명이나 도장만으로는 모자랄 수 있으니 무엇을 더 챙겨야 하는지 미리 물어보세요.",
      },
      {
        id: "registration_08",
        label: "혼인신고서 작성하고 접수하기",
        done: false,
        note: "방문·우편 등 접수 방법과 당사자 확인 서류를 접수기관에 확인하고 처리 결과도 확인하세요.",
      },
      {
        id: "registration_11",
        label: "빌린 집의 확정일자·전입신고 시점 확인 (해당하는 경우)",
        done: false,
        note: "혼인신고를 기다리지 말고 남은 금액을 보내는 날·입주일에 맞춰 필요한 절차와 효력을 확인하세요.",
      },
      {
        id: "registration_09",
        label: "이사했다면 전입신고 기한 확인하고 신고하기 (해당하는 경우)",
        done: false,
        note: "주소를 실제로 옮겼을 때의 신고 기한과 방법을 정부 공식 안내에서 확인하세요.",
      },
      {
        id: "registration_10",
        label: "건강보험에 배우자를 올릴 수 있는지 알아보기 (해당하는 경우)",
        done: false,
        note: "소득·재산 등 자격 요건과 신고 시점별 적용일을 국민건강보험공단에 확인하세요.",
      },
    ],
  },
];

// 카테고리 키로 템플릿 빠르게 조회
export const CHECKLIST_MAP = Object.fromEntries(
  CATEGORY_CHECKLISTS.map((c) => [c.key, c])
) as Record<string, CategoryChecklistTemplate>;
