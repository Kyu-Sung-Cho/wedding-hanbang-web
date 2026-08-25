import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  describeUnconfirmedAmoraPendingAction,
  extractAmoraPendingAction,
} from "@/lib/ai/amoraPendingAction";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";

/**
 * 아모라가 못 누르는 버튼을 가리켰다.
 *
 * 오늘(2026-08-25) 카드가 뜬 뒤 말로 승인하면 "화면의 **이대로 적용** 버튼을
 * 눌러야 반영됩니다" 라고 안내하도록 고쳤다. 그런데 화면은 카드가 **최신 공유
 * 메시지**에 있을 때만 누를 수 있게 한다(`getPendingActionDisabledReason` 의
 * `not_latest`; 웹 `ChatContent.tsx` 는 `msg.id === latestSharedMessageId` 로 판정).
 *
 * 즉 사용자가 "응 그렇게 해줘" 라고 치는 **그 순간** 그 카드가 잠긴다.
 *
 *     아모라: "화면의 이대로 적용 버튼을 눌러야 반영됩니다"
 *     버튼:   "새 대화가 이어져 이 제안은 적용할 수 없어요"  ← 비활성
 *
 * 그래서 아직 안 누른 카드를 새 답변으로 **옮긴다.**
 *
 * ## 새 권한을 만드는 것이 아니다
 *
 * 같은 `action_id`·같은 만료·같은 입력을 그대로 옮긴다. 실행은 여전히 서버가
 * 발급한 id 를 받아야 하고, 저니 리비전도 원래 값을 들고 가므로 그 사이 계획이
 * 바뀌었으면 적용은 정상적으로 거부된다.
 */

const MUTATING_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));
const NOW = 1_787_600_000_000;

function issueRealCard() {
  const extracted = extractAmoraPendingAction({
    text: '신혼여행 예산을 잡을게요.[pending_action]{"tool":"update_category_budget","input":{"category":"honeymoon","budget":7000000}}[/pending_action]',
    allowedTools: MUTATING_TOOLS,
    now: NOW,
    createActionId: () => "11111111-2222-4333-8444-555555555555",
  });
  if (!extracted.pendingAction) throw new Error("운영 경로로 카드를 못 만들었다");
  return extracted.pendingAction;
}

describe("옮겨진 카드는 같은 카드다", () => {
  const original = issueRealCard();

  it("서버가 읽어들이는 값이 원본과 같다", () => {
    // 라우트는 이 함수가 돌려준 것을 그대로 새 답변 metadata 에 넣는다.
    const carried = describeUnconfirmedAmoraPendingAction({
      value: original,
      allowedTools: MUTATING_TOOLS,
      now: NOW + 60_000,
    });
    expect(carried).not.toBeNull();
    expect(carried?.actionId).toBe(original.actionId);
    expect(carried?.expiresAt).toBe(original.expiresAt);
    expect(carried?.issuedAt).toBe(original.issuedAt);
    expect(carried?.inputDigest).toBe(original.inputDigest);
    expect(carried?.operationKey).toBe(original.operationKey);
  });

  it("만료 시각은 옮긴다고 늘어나지 않는다", () => {
    // 옮길 때마다 시간이 늘면 카드가 영원히 산다.
    expect(
      describeUnconfirmedAmoraPendingAction({
        value: original,
        allowedTools: MUTATING_TOOLS,
        now: original.expiresAt + 1,
      }),
    ).toBeNull();
  });

  it("입력이 바뀐 카드는 옮기지 않는다", () => {
    const tampered = { ...original, input: { ...original.input, budget: 99_000_000 } };
    expect(
      describeUnconfirmedAmoraPendingAction({
        value: tampered,
        allowedTools: MUTATING_TOOLS,
        now: NOW + 60_000,
      }),
    ).toBeNull();
  });
});

/**
 * 위 검사들은 값이 보존되는지만 본다. 라우트가 실제로 옮기는지는 별개 문제라
 * 배선을 따로 고정한다. 주석은 먼저 걷어낸다 — 주석 안의 문장을 코드로 세면
 * 지워진 배선에도 초록불이 난다.
 */
describe("라우트가 실제로 옮긴다", () => {
  const BLOCK_COMMENT = new RegExp("/\\*[\\s\\S]*?\\*/", "g");
  const LINE_COMMENT = new RegExp("(^|\\s)//.*$");

  const source = readFileSync(
    join(process.cwd(), "src", "app", "api", "chat", "route.ts"),
    "utf8",
  )
    .replace(BLOCK_COMMENT, " ")
    .split("\n")
    .map((line) => line.replace(LINE_COMMENT, ""))
    .join("\n");

  it("주석 제거가 실제로 동작한다", () => {
    expect(source).not.toContain("아직 안 누른 카드를 새 답변으로 옮긴다");
  });

  it("새 표식이 없을 때 대기 중인 카드를 붙인다", () => {
    const collapsed = source.replace(/\s+/g, " ");
    expect(collapsed).toContain(
      ": awaitingPendingCard ? { pending_amora_action: awaitingPendingCard,",
    );
  });

  it("저니 리비전을 새로 계산하지 않고 원래 값을 들고 간다", () => {
    // 새로 계산하면 그 사이 바뀐 계획 위에 옛 카드가 적용될 수 있다.
    const collapsed = source.replace(/\s+/g, " ");
    expect(collapsed).toContain("carriedPendingActionRevision");
    expect(collapsed).toContain(
      "previousCanonicalRow.metadata.pending_amora_action_journey_revision",
    );
  });
});
