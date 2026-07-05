// 아모라 케어 이메일 빌더 — "먼저 연락하는 친언니"의 아웃바운드 채널.
// 본문은 모멘트 카탈로그의 셀 메시지(친언니 톤, 체크리스트 조립 완료)를 그대로 쓰고,
// 제목은 카톡 첫 줄처럼 셀 종류(d3/d1/dAfter)별로 만든다.
// 채널 전략: Phase1 이메일(즉시 가동) → Phase2 모바일 푸시(출시 시) → Phase3 카카오 알림톡.

import type { DueMomentCell } from "@/lib/amora/momentLoop";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://hanbang.ai";

export function buildCareEmailSubject(cell: Pick<DueMomentCell, "momentLabel" | "cellKind">): string {
  switch (cell.cellKind) {
    case "d3":
      return `${cell.momentLabel} 3일 전이에요 — 아모라가 미리 챙겨왔어요`;
    case "d1":
      return `내일 ${cell.momentLabel}! 나가기 전 30초 체크`;
    case "dAfter":
      return `${cell.momentLabel} 어땠어요? 아모라가 궁금해서요`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildCareEmailHtml(params: {
  recipientName: string | null;
  cell: Pick<DueMomentCell, "momentLabel" | "cellKind" | "message">;
}): string {
  const greeting = params.recipientName
    ? `${escapeHtml(params.recipientName)}님,`
    : "안녕하세요,";
  const body = escapeHtml(params.cell.message).replace(/\n/g, "<br>");

  return `
    <div style="font-family: 'Paperlogy', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #FDFCFA;">
      <div style="text-align: center; margin-bottom: 28px;">
        <img src="${SITE}/images/logo-512-transparent.png" alt="웨딩한방" width="56" height="56" style="width: 56px; height: 56px; object-fit: contain;" />
      </div>
      <p style="font-size: 13px; color: #9d6f36; text-align: center; margin-bottom: 8px; letter-spacing: 0.08em;">
        아모라가 먼저 챙겨왔어요
      </p>
      <h1 style="font-size: 21px; font-weight: 500; color: #1A1A1F; text-align: center; margin-bottom: 24px;">
        ${escapeHtml(params.cell.momentLabel)}
      </h1>
      <div style="background: #ffffff; border: 1px solid #eadfc9; border-radius: 16px; padding: 20px 18px; margin-bottom: 28px;">
        <p style="font-size: 14px; color: #34445a; line-height: 1.75; margin: 0;">
          ${greeting}<br><br>${body}
        </p>
      </div>
      <div style="text-align: center; margin-bottom: 28px;">
        <a href="${SITE}/chat" style="display: inline-block; padding: 13px 36px; background: #36534E; color: white; border-radius: 24px; text-decoration: none; font-size: 14px; font-weight: 500;">
          아모라랑 이어서 얘기하기
        </a>
      </div>
      <p style="font-size: 12px; color: #B5ADA3; text-align: center; line-height: 1.7;">
        이 안내는 직접 입력하신 일정을 기준으로 보내드려요.<br>
        받고 싶지 않으시면 <a href="${SITE}/settings" style="color: #9d6f36;">설정 &gt; 알림</a>에서 끌 수 있어요.
      </p>
      <p style="font-size: 11px; color: #D5D0C9; text-align: center; margin-top: 20px;">
        © 2026 웨딩한방
      </p>
    </div>
  `;
}
