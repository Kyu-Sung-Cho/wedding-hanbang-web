/**
 * 아모라가 만든 "챙길 것" 카드를 앱이 읽을 수 있는 모양으로 바꾼다.
 *
 * ## 왜 앱에 이게 없었나
 *
 * 서버는 준비돼 있었다. `add_amora_action` 은 승인 카드로 나가고(2026-08-23 실측:
 * "메모해줘", "기억해줘", "챙겨줘", "리마인드 해줘" 에 서버가 이 도구를 연다),
 * `/api/amora/actions` 가 목록을 주고, 웹 라운지는 그 목록을 보여준다.
 *
 * **모바일에는 호출자가 하나도 없었다.** 그래서 앱에서 승인한 "챙길 것"이 저장은
 * 되는데 앱 어디에도 나타나지 않았다. 사용자 입장에서는 방금 누른 승인이 사라진다.
 *
 * 문구는 서버가 소유한다(`title`). 여기서 지어내지 않는다.
 */

/** 사용자에게 한 번에 보여줄 줄 수. 라운지는 카드가 여러 장 쌓이는 화면이다. */
export const AMORA_ACTION_VISIBLE_LIMIT = 3;

const PRIORITIES = new Set(["high", "medium", "low"]);
const STATUSES = new Set(["open", "done", "dismissed"]);

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** `YYYY-MM-DD` 만 날짜로 받는다. 그 밖의 값은 화면에 날짜인 척 올리지 않는다. */
function cleanYmd(value) {
  if (typeof value !== "string") return "";
  return /^\d{4}-\d{2}-\d{2}$/u.test(value.trim()) ? value.trim() : "";
}

/**
 * `/api/amora/actions` 응답에서 화면에 그릴 수 있는 항목만 남긴다.
 *
 * 제목이 없으면 버린다 — 제목 없는 줄은 사용자가 무엇을 완료하는지 알 수 없고,
 * 그 상태로 완료 버튼을 주면 확인하지 않은 변경이 된다.
 */
export function parseAmoraActions(payload) {
  const raw = payload && typeof payload === "object" ? payload.actions : null;
  if (!Array.isArray(raw)) return [];
  const parsed = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const id = cleanText(entry.id, 100);
    const title = cleanText(entry.title, 120);
    if (!id || !title) continue;
    const status = STATUSES.has(entry.status) ? entry.status : "open";
    const priority = PRIORITIES.has(entry.priority) ? entry.priority : "medium";
    parsed.push({ id, title, status, priority, dueDate: cleanYmd(entry.dueDate) });
  }
  return parsed;
}

/**
 * 아직 남은 것만, 정해진 줄 수만큼 고른다.
 *
 * 마감일이 있는 것을 먼저 보여준다 — 날짜가 붙은 것이 실제로 놓치면 곤란한 것이다.
 * 같은 조건이면 서버가 준 순서를 지킨다.
 */
export function selectOpenAmoraActions(actions, limit = AMORA_ACTION_VISIBLE_LIMIT) {
  const open = (Array.isArray(actions) ? actions : []).filter((a) => a.status === "open");
  const ordered = open
    .map((action, index) => ({ action, index }))
    .sort((left, right) => {
      const leftHas = left.action.dueDate ? 0 : 1;
      const rightHas = right.action.dueDate ? 0 : 1;
      if (leftHas !== rightHas) return leftHas - rightHas;
      if (left.action.dueDate && right.action.dueDate && left.action.dueDate !== right.action.dueDate) {
        return left.action.dueDate < right.action.dueDate ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.action);

  const visible = ordered.slice(0, Math.max(0, limit));
  return { visible, openCount: open.length, hiddenCount: Math.max(0, open.length - visible.length) };
}

/** 마감일을 사람이 읽는 말로. 날짜가 없으면 빈 문자열이고 화면은 그 줄을 안 그린다. */
export function formatAmoraActionDueDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(ymd ?? "")) return "";
  const [year, month, day] = ymd.split("-");
  return `${Number(year)}년 ${Number(month)}월 ${Number(day)}일까지`;
}

/** 완료 처리에 보낼 몸통. 서버는 `status` 만 바꾸면 되는 계약을 이미 갖고 있다. */
export function buildCompleteActionBody() {
  return { status: "done" };
}
