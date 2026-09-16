// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WEDDING_CODE_RESEARCH_CONTRIBUTION_EFFECTIVE_AT,
  WEDDING_CODE_RESEARCH_RETENTION_DAYS,
  WEDDING_CODE_RESEARCH_TOMBSTONE_DAYS,
} from "@/lib/weddingCode/contribution/contract";
import PrivacyPage from "../page";

const SECRET = "test-secret-that-is-at-least-thirty-two-chars";

function render(): string {
  return renderToStaticMarkup(<PrivacyPage />).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function kstDateLabel(iso: string): string {
  const kst = new Date(Date.parse(iso) + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일부터`;
}

/**
 * 처리방침의 웨딩코드 답 보태기 고지는 **실제로 지키는 것만** 말해야 한다.
 *
 * 2026-09-16 적대 검토에서 두 가지가 잡혔다. "백업에서 복원돼도 다시 지운다"는 문장은
 * 그런 코드가 없는데 쓰여 있었고, 수집 플래그를 끄면 이미 받은 답이 남아 있는데도
 * 고지가 사라졌다. 그래서 고지는 **저장소를 지키는 스위치(비밀값)** 로 켜고, 문장은
 * 계약 상수에서 온 기간·날짜와 맞는지 렌더 결과로 본다.
 */
describe("privacy notice for WeddingCode research contributions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("저장소가 없으면 받는다고 말하지 않고, 답은 서버에 저장하지 않는다고만 말한다", () => {
    vi.stubEnv("WEDDING_CODE_RESEARCH_RECEIPT_SECRET", "");
    vi.stubEnv("WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED", "true");
    const text = render();
    expect(text).not.toContain("답 보태기");
    expect(text).toContain("웨딩코드: 답은 기기 안에서 계산하고 서버에 저장하지 않으며");
  });

  it("수집 플래그를 꺼도 저장소를 지키는 동안에는 고지·기간·삭제 방법을 계속 알린다", () => {
    vi.stubEnv("WEDDING_CODE_RESEARCH_RECEIPT_SECRET", SECRET);
    vi.stubEnv("WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED", "false");
    const text = render();
    const dateLabel = kstDateLabel(WEDDING_CODE_RESEARCH_CONTRIBUTION_EFFECTIVE_AT);

    expect(text).toContain("아래 답 보태기에 동의한 경우가 아니면 서버에 저장하지 않으며");
    // 제1조 항목, 제3조 보관, 부칙 — 세 곳 모두 같은 적용일
    expect(text).toContain(`웨딩코드 답 보태기에 동의한 경우(${dateLabel.replace(/부터$/, "")}부터, 선택)`);
    expect(text).toContain(`웨딩코드 답 보태기(선택, ${dateLabel})`);
    expect(text).toContain("개정분(제1조·제3조의 웨딩코드 답 보태기)은 같은 날부터 적용합니다");
    // 고지와 같은 날 열더라도, 화면·방침의 시작일은 한 상수에서 나온다.
    expect(text).toContain(`웨딩코드 답 보태기(선택, ${dateLabel})`);
    expect(text).toContain(`보낸 날부터 ${WEDDING_CODE_RESEARCH_RETENTION_DAYS}일이 지나면 자동으로 삭제합니다`);
    expect(text).toContain(`${WEDDING_CODE_RESEARCH_TOMBSTONE_DAYS}일간 보관합니다`);
    expect(text).toContain("저장 시각은 날짜 단위로만 남기며");
    expect(text).toContain("새 답 받기를 멈춘 뒤에도 이미 받은 답의 자동 삭제와 삭제 요청은 계속 처리합니다");
    // 코드가 하지 않는 약속은 쓰지 않는다. (방침의 다른 조항에는 "익명"이 원래 있으므로 이 문단만 본다.)
    const paragraph = text.slice(
      text.indexOf("웨딩코드 답 보태기(선택"),
      text.indexOf("계속 처리합니다") + "계속 처리합니다".length,
    );
    expect(paragraph.length).toBeGreaterThan(100);
    expect(paragraph).not.toMatch(/백업[^.]*다시 지우/);
    expect(paragraph).not.toContain("익명");
  });
});
