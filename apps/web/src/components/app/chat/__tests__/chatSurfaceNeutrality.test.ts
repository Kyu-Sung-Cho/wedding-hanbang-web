import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// 채팅 표면은 사용자가 고른 적 없는 성별을 화면에 찍지 않는다.
// bride/groom은 저장 슬롯이지 사람의 정체성이 아니므로, 라벨은 이름을 쓰고
// 색은 "나 vs 상대" 축으로 가른다. 이 가드가 없으면 다음 사람이 색만
// 되돌려 놓아도 아무도 모른다 — 실제로 이 파일들에는 안전망이 0건이었다.
const CHAT_ROOT = join(process.cwd(), "src/components/app/chat");
const MOBILE_CHAT = join(process.cwd(), "../mobile/app/(tabs)/chat.tsx");

// 이전에 성별을 인코딩하던 색. 하나라도 돌아오면 라벨이 중립이어도 성별이 샌다.
// 이 목록에는 채팅 밖에서 쓰이지 않는 값만 넣는다 — #E8D5CD·#E8C4B8는 예절
// 가이드 카드 등 성별과 무관한 곳에도 쓰여 여기 넣으면 거짓 양성이 된다.
const GENDERED_HEXES = [
  "#F5E6DF", // 신부 상대 말풍선
  "#E8EDF5", // 신랑 상대 말풍선
  "#D4DCE8", // 신랑 테두리
  "#3B5998", // 신랑 내 말풍선·아바타
  "#6B8CCE", // 신랑 아바타 그라디언트 끝
  "#E8C5B8", // 모바일 신부 테두리
  "#C5CEE0", // 모바일 신랑 테두리
];

const SURFACES: ReadonlyArray<{ label: string; path: string }> = [
  { label: "ChatBubble", path: join(CHAT_ROOT, "ChatBubble.tsx") },
  { label: "ChatContent", path: join(CHAT_ROOT, "ChatContent.tsx") },
  { label: "ChatSidePanel", path: join(CHAT_ROOT, "ChatSidePanel.tsx") },
  { label: "mobile chat", path: MOBILE_CHAT },
];

describe("채팅 표면 중립성", () => {
  for (const surface of SURFACES) {
    const source = readFileSync(surface.path, "utf8");

    it(`${surface.label}은 성별 명사를 화면 문자열로 쓰지 않는다`, () => {
      expect(source).not.toContain('"신부"');
      expect(source).not.toContain('"신랑"');
      expect(source).not.toContain("`신부");
      expect(source).not.toContain("`신랑");
    });

    it(`${surface.label}은 발신자 색을 성별로 가르지 않는다`, () => {
      for (const hex of GENDERED_HEXES) {
        expect(source.toUpperCase()).not.toContain(hex);
      }
    });
  }

  for (const surface of SURFACES) {
    const source = readFileSync(surface.path, "utf8");

    // 색 목록은 새 hex가 추가되면 뚫린다. 진짜 막아야 하는 건 "발신자를 성별로
    // 분기하는 것" 자체이므로 분기 변수의 부활을 구조적으로 막는다.
    // 원시 `sender_type === "bride"` 비교 자체는 막지 않는다 — 실시간 payload
    // 경계 검증(모바일 chat.tsx의 chatMessageFromRealtimeRow)이 DB CHECK 제약과
    // 짝을 이뤄 그 비교를 정당하게 쓴다. 막아야 하는 건 그 값으로 화면을 가르는
    // 것이고, 그 관용구가 정확히 isBride였다.
    it(`${surface.label}은 발신자를 성별 슬롯으로 분기하지 않는다`, () => {
      expect(source).not.toContain("isBride");
      expect(source).not.toContain("isGroom");
    });
  }

  it("ChatBubble은 이름을 못 찾아도 성별로 되돌아가지 않는다", () => {
    const source = readFileSync(join(CHAT_ROOT, "ChatBubble.tsx"), "utf8");
    // 폴백까지 중립이어야 한다. sender_id가 없는 과거 메시지에 현재 파트너
    // 이름을 붙이면 오귀속이므로 별도 문구를 쓴다.
    expect(source).toContain('senderName ?? (message.sender_id ? "파트너" : "이전 참여자")');
  });
});
