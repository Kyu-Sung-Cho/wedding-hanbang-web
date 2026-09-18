import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SHARED_ACTION_ID_PATTERN,
  SHARED_ACTION_SOURCE_LABELS,
  SHARED_ACTION_STATUS_ANNOUNCEMENTS,
  SHARED_ACTION_STATUS_COLUMNS,
  normalizeLikeServer,
} from "@hanbang/shared/amora-shared-actions";
import { PREPARATION_COLUMNS, PREPARATION_SOURCES } from "@/lib/amora/preparationBoard";
import { cleanOptionalText } from "@/utils/requestValidation";

/**
 * 앱의 공유 할 일 화면은 `@hanbang/shared/amora-shared-actions` 로 웹과 같은 말·같은 정규화를 쓴다.
 * 웹 실행 코드는 그대로 두므로(출시 점검 W08 통과본), 둘이 갈라지면 여기서 빨간불이 나야 한다.
 */

const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), "utf8");

const CORPUS: unknown[] = [
  "첫 줄\n둘째 줄",
  "윗줄\r\n\r\n아랫줄",
  "두  칸   띄움",
  "\t탭과\u00a0줄바꿈 없는 공백\t",
  "   앞뒤 공백   ",
  "<b>굵게</b> 확인",
  "앞<script>x</script>뒤",
  "<SCRIPT type=\"a\">alert(1)</SCRIPT>남는 글",
  "<style>p{}</style><input value=\"x\"/>본문",
  "<!-- 메모 -->주석 뒤",
  "<!-- a > b -->주석 안의 꺾쇠",
  "a < b 그리고 c > d",
  "<p>문단</p><br/>줄",
  "가".repeat(600),
  `${" ".repeat(39)}가나`,
  `${"가".repeat(39)}  나`,
  `${"😀".repeat(30)}`,
  "",
  "   ",
  "<b></b>",
  null,
  undefined,
  42,
];

describe("shared action contract parity with the web board", () => {
  it("normalizeLikeServer equals the server cleanOptionalText for every length the API uses", () => {
    for (const max of [40, 80, 120, 500, 3]) {
      for (const value of CORPUS) {
        expect(normalizeLikeServer(value, max), `${JSON.stringify(value)} @${max}`).toBe(cleanOptionalText(value, max));
      }
    }
  });

  it("status labels and rules equal PREPARATION_COLUMNS in the same order", () => {
    expect(SHARED_ACTION_STATUS_COLUMNS.map(({ status, label, rule }) => ({ status, label, rule })))
      .toEqual(PREPARATION_COLUMNS.map(({ status, label, rule }) => ({ status, label, rule })));
  });

  it("source labels equal PREPARATION_SOURCES", () => {
    expect({ ...SHARED_ACTION_SOURCE_LABELS }).toEqual(PREPARATION_SOURCES);
  });

  it("status-change announcements are the web board's words", () => {
    const board = read("../../../components/app/amora-board/AmoraDecisionBoard.tsx");
    for (const message of Object.values(SHARED_ACTION_STATUS_ANNOUNCEMENTS)) expect(board).toContain(`"${message}"`);
  });

  it("the id rule matches the PATCH route's SAFE_ACTION_ID_RE", () => {
    const route = read("../../../app/api/amora/actions/[id]/route.ts");
    const literal = route.match(/const SAFE_ACTION_ID_RE = \/(.+)\/;/u)?.[1];
    expect(literal).toBeTruthy();
    const routeRule = new RegExp(literal!);
    for (const id of ["act_1234", "abc", "a".repeat(120), "a".repeat(121), "act/1234", "act 1234", "amora_manual_0f", "ACT-z_9", ""]) {
      expect(SHARED_ACTION_ID_PATTERN.test(id), id).toBe(routeRule.test(id));
    }
  });
});
