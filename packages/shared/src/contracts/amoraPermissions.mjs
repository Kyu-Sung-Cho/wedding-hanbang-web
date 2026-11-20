// 허락 규칙 화면(설계 25장 3절)의 웹·앱 공용 표. 문장은 파운더가 정한다(18장 D-12).
//
// 화면에는 오늘 쓸 수 있는 일만 쓴다(CLAUDE.md "오늘 사용자가 직접 재현할 수 있는 것만"). 인터넷 찾기(갈래 3)와
// 맡은 일(갈래 4)은 그 기능이 켜졌다고 서버가 알려 줄 때만 줄이 생긴다. 그 갈래는 자기 스위치를 이 함수의
// `features` 로 넘기면 된다.

const ROWS = Object.freeze([
  { section: "auto", id: "read_plan", text: "준비 기록 읽기" },
  { section: "auto", id: "web_search", text: "인터넷에서 찾아보기", feature: "webSearch" },
  { section: "auto", id: "read_official", text: "업체 공식 페이지 읽기", feature: "webSearch" },
  { section: "auto", id: "tables", text: "표와 요약 만들기" },
  { section: "auto", id: "drafts", text: "글 초안 쓰기" },
  { section: "auto", id: "run_tasks", text: "맡은 일 이어 가기", feature: "agentTasks" },
  { section: "ask", id: "start_task", text: "맡은 일 시작하기", feature: "agentTasks" },
  { section: "ask", id: "save_plan", text: "예산과 일정, 할 일, 조건 저장하기" },
  { section: "ask", id: "confirm_letter", text: "문의 편지 확정하기" },
  { section: "never", id: "send_vendor", text: "업체에 직접 보내기" },
  { section: "never", id: "login", text: "두 분 계정으로 로그인하기" },
  { section: "never", id: "pay", text: "결제하거나 예약 확정하기" },
  { section: "never", id: "contact", text: "시키지 않은 연락하기" },
]);

export const AMORA_PERMISSION_COPY = Object.freeze({
  title: "아모라가 하는 일",
  intro: "아모라가 혼자 하는 일, 물어보고 하는 일, 하지 않는 일을 정해 두었어요.",
  sections: Object.freeze({
    auto: "알아서 해요",
    ask: "물어보고 해요",
    never: "하지 않아요",
  }),
  askNote: "카드를 한 번 눌러야 반영돼요. 한 사람이 바꾸면 상대에게 알림이 가요.",
  neverNote: "업체에 보내는 일은 두 분이 직접 해요.",
  controlsTitle: "알림과 기억",
  memoryLink: "아모라가 기억하는 것 보기",
  memoryLinkSub: "기억을 켜고 끄거나 지울 수 있어요",
});

/**
 * @param {{ webSearch?: boolean, agentTasks?: boolean }} [features]
 * @returns {{ auto: string[], ask: string[], never: string[] }}
 */
export function buildAmoraPermissionTable(features = {}) {
  const table = { auto: [], ask: [], never: [] };
  for (const row of ROWS) {
    if (row.feature && features[row.feature] !== true) continue;
    table[row.section].push(row.text);
  }
  return table;
}
