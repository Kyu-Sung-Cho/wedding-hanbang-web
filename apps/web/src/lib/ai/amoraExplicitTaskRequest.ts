import { AMORA_MAX_QUEUED_ACTIONS, type AmoraQueuedAction } from "./amoraPendingAction";
import { isValidScheduleYmd } from "@/utils/scheduleEvents";

const COUNTS: Record<string, number> = { 한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };
const DATE = "(?:[0-9]{4}년[ \\t]*[0-9]{1,2}월[ \\t]*[0-9]{1,2}일|[0-9]{4}-[0-9]{2}-[0-9]{2})";
const ROW = new RegExp(`^([0-9]{1,2})[).]\\s*제목은 ([^\\r\\n]+?),\\s*설명은 ([^\\r\\n]+?),\\s*예정일은 (${DATE})[.。]`);
const ENDING = /^(?:(?:둘 다|모두|전부) 아직 하지 않은 일이야[.。]\s*)?(?:담당자는 정하지 말고 )?저장 전 확인 카드를 보여(?:줘|주세요)[.。]?$/;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 필드가 명시된 현재 공유 할 일 목록만 복구한다. 추정·조건 생략 없이 기존 승인 큐로 보낸다. */
export function parseExplicitTaskRequest(text: string, modelText = ""): AmoraQueuedAction[] | null {
  if (text.length > 10000 || /[\p{Cf}\p{Zl}\p{Zp}]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) return null;
  const prefix = /^(?:함께 보는|공유) 할 일(?:에)?\s+([0-9]{1,2}|한|하나|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉|열)\s*(?:개를|건을) 추가해(?:줘|주세요)[.。]\s*/.exec(text.trim());
  if (!prefix) return null;
  const count = COUNTS[prefix[1]] ?? Number(prefix[1]);
  if (!Number.isInteger(count) || count < 1 || count > AMORA_MAX_QUEUED_ACTIONS) return null;
  let rest = text.trim().slice(prefix[0].length).trim();
  const actions: AmoraQueuedAction[] = [];
  const keys = new Set<string>();
  for (let index = 1; index <= count; index += 1) {
    const row = ROW.exec(rest);
    if (!row || Number(row[1]) !== index) return null;
    const title = row[2].trim();
    const description = row[3].trim();
    const korean = /^([0-9]{4})년[ \t]*([0-9]{1,2})월[ \t]*([0-9]{1,2})일$/.exec(row[4]);
    const due_date = korean ? `${korean[1]}-${korean[2].padStart(2, "0")}-${korean[3].padStart(2, "0")}` : row[4];
    // 추가 필드·명령처럼 보이는 문구를 제목/설명 안으로 삼켜 버리지 않는다.
    if (!title || title.length > 120 || !description || description.length > 500
      || /[\[\]{}<>]|(?:제목|설명|예정일|담당자|우선순위|카테고리)(?:은|는|:)|(?:저장|추가|등록|수정)\s*(?:하지\s*마|금지)|개인\s*(?:상담|할\s*일)|나만\s*(?:보|의)/u.test(`${title}\n${description}`)
      || !isValidScheduleYmd(due_date)) return null;
    const input = { title, description, due_date };
    const key = JSON.stringify(input);
    if (keys.has(key)) return null;
    keys.add(key);
    actions.push({ tool: "add_amora_action", input });
    rest = rest.slice(row[0].length).trim();
  }
  if ((rest && !ENDING.test(rest)) || (rest.startsWith("둘 다") && count !== 2)) return null;
  // 모델이 더 많은 조건을 담았다면 여기서 조용히 버리지 않는다. 원문과 같은 일부
  // 표식만 복구 가능하며 그 외에는 기존 표식 검증과 정직한 실패 안내에 맡긴다.
  if (modelText.length > 40000) return null;
  const seen = new Set<string>();
  let invalid = false;
  const remainder = modelText.replace(/\[pending_action\]([\s\S]*?)\[\/pending_action\]/g, (_match, payload: string) => {
    try {
      const value: unknown = JSON.parse(payload);
      if (!record(value) || Object.keys(value).sort().join(",") !== "input,tool"
        || value.tool !== "add_amora_action" || !record(value.input)
        || Object.keys(value.input).sort().join(",") !== "description,due_date,title") invalid = true;
      else {
        const key = JSON.stringify({ title: value.input.title, description: value.input.description, due_date: value.input.due_date });
        if (!keys.has(key) || seen.has(key)) invalid = true;
        seen.add(key);
      }
    } catch { invalid = true; }
    return "";
  });
  if (invalid || /pending[\s_-]*action|"(?:tool|input)"\s*:/i.test(remainder)) return null;
  return actions;
}
