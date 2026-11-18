/**
 * 청첩장 디자인(2026-11-17) 아이콘. 아티팩트 SVG 의 좌표와 선 굵기를 그대로 옮겼다.
 * 모두 장식이라 읽어 주지 않는다. 이름은 감싼 링크나 단추가 갖는다.
 */

type SizeProps = { size?: number };

const DECORATIVE = { "aria-hidden": true, focusable: "false" } as const;

/** 뒤로 가기 꺾쇠(첫 대화·준비 순서·비교는 22, 상담 확정은 20). */
export function BackChevronIcon({ size = 22 }: SizeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...DECORATIVE}
    >
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

/** 하단 메뉴: 청첩장 홈(봉투). */
export function NavInvitationIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" {...DECORATIVE}>
      <rect x="3.5" y="6" width="17" height="13" rx="1.5" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </svg>
  );
}

/** 하단 메뉴: 아모라와 대화(작은 빛이 든 원). */
export function NavAmoraIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" {...DECORATIVE}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="9.5" cy="9.5" r="2.2" />
    </svg>
  );
}

/** 하단 메뉴: 준비 순서(점 목록). */
export function NavJourneyIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" {...DECORATIVE}>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </svg>
  );
}

/** 하단 메뉴: 일정(달력). */
export function NavScheduleIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" {...DECORATIVE}>
      <rect x="4" y="5" width="16" height="15" rx="2.5" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </svg>
  );
}

/** 웨딩홀 담기 하트. 담으면 분홍으로 채운다. */
export function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      strokeLinejoin="round"
      className={filled ? "fill-inv-heart stroke-inv-heart" : "fill-none stroke-inv-ink"}
      {...DECORATIVE}
    >
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
    </svg>
  );
}

/** 웹 입력칸의 보내기 화살표(흰 선). */
export function SendArrowIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stroke-inv-white"
      {...DECORATIVE}
    >
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

/**
 * 끝난 단계 표시. 아티팩트가 이 아이콘에만 이름("완료")을 붙였다. 글자 없이 끝났음을 알리는
 * 유일한 표시라서다. 그래서 이 아이콘은 장식이 아니라 그림으로 읽힌다.
 */
export function DoneCheckIcon({ label }: { label: string }) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stroke-inv-gold-ink"
      role="img"
      aria-label={label}
      focusable="false"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
