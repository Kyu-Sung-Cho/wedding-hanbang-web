import Svg, { Circle, Path, Rect } from "react-native-svg";

/**
 * 청첩장 디자인 아이콘. 아티팩트 SVG 의 좌표·선 굵기를 그대로 옮겼다(24×24 좌표계).
 * 모두 장식이다 — 읽어 줄 이름은 감싼 단추가 가진다.
 */
type IconProps = { size?: number; color: string };

const hidden = { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" } as const;

/** 뒤로(첫 대화·준비 순서·비교 22px, 상담 20px). 선 1.8. */
export function ChevronBackIcon({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...hidden}>
      <Path d="M15 5l-7 7 7 7" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** 상담 후보에 담기(비교 화면 하트). 켜면 분홍으로 채운다. */
export function HeartIcon({ filled, fill, stroke }: { filled: boolean; fill: string; stroke: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" {...hidden}>
      <Path
        d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"
        fill={filled ? fill : "none"}
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 준비 순서의 완료 표시. */
export function CheckIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" {...hidden}>
      <Path d="M5 12.5l4.5 4.5L19 7.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** 하단 메뉴: 청첩장 홈(봉투). */
export function TabHomeIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" {...hidden}>
      <Rect x={3.5} y={6} width={17} height={13} rx={1.5} stroke={color} strokeWidth={1.7} strokeLinejoin="round" />
      <Path d="M3.5 7l8.5 6 8.5-6" stroke={color} strokeWidth={1.7} strokeLinejoin="round" />
    </Svg>
  );
}

/** 하단 메뉴: 아모라와 대화(원 안의 작은 원). */
export function TabChatIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" {...hidden}>
      <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={1.7} strokeLinejoin="round" />
      <Circle cx={9.5} cy={9.5} r={2.2} stroke={color} strokeWidth={1.7} strokeLinejoin="round" />
    </Svg>
  );
}

/** 하단 메뉴: 준비 순서(점 세 개와 줄 세 개). */
export function TabJourneyIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" {...hidden}>
      <Path d="M8 6h12M8 12h12M8 18h12" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      <Circle cx={4} cy={6} r={1} stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      <Circle cx={4} cy={12} r={1} stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      <Circle cx={4} cy={18} r={1} stroke={color} strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  );
}

/** 하단 메뉴: 일정(달력). */
export function TabScheduleIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" {...hidden}>
      <Rect x={4} y={5} width={16} height={15} rx={2.5} stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      <Path d="M4 10h16M9 3v4M15 3v4" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  );
}
