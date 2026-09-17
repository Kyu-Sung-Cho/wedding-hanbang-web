import type { ReactNode } from "react";
import type { TASTE_DOMAIN_QUESTIONS, TASTE_MOOD_OPTIONS } from "@/lib/weddingCode/taste";

/**
 * 취향 질문의 **분위기 그림**. 사진이 아니라 선으로 그린 장면이다.
 *
 * ## 왜 사진이 아닌가
 *
 * 권리가 확인된 결혼식 사진이 저장소에 없다(출처를 아는 한 장은 AI 생성이고, 나머지는
 * 출처를 모른다). 원격 이미지도 CSP·국외 이전 고지 테스트가 막는다. 그래서 브랜드 토큰
 * 색만으로 **분위기를 그린다.** 실제 식장처럼 보이게 그리지 않고, 장소 이름도 붙이지 않는다.
 *
 * ## 지키는 것
 *
 * - `aria-hidden` 이고 글자 노드(`<title>`·`<text>`)가 없다. 선택지의 이름은 버튼의
 *   라벨이 맡는다 — 그림이 이름을 가지면 화면낭독기가 같은 말을 두 번 읽는다.
 * - 색은 `@theme` 토큰 유틸리티(`fill-*`·`stroke-*`)로만 칠한다. 16진수를 박지 않는다.
 * - 선 굵기는 화면 크기와 관계없이 같다(`non-scaling-stroke`). 좁은 폰에서 칸이 작아져도
 *   선이 뭉개지지 않고, 넓은 화면에서 굵어지지 않는다.
 * - 가로로 넓은 칸(2:1)에서는 위아래가 10씩 잘린다. 뜻을 지는 요소는 y 12~88 안에 둔다.
 */

function Scene({ ground, children }: { ground: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 160 100"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      data-taste-scene=""
      fill="none"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      // 칸의 비율은 부모가 정한다. `globals.css` 의 레이어 밖 규칙 `svg { height: auto }` 가
      // `h-full` 을 이겨 그림이 viewBox 의 8:5 로 늘어나 라벨을 덮었다(283px 칸에서 177px,
      // 칸은 141px). 그래서 높이만 `!` 로 못 박고, 흐름 밖(absolute)에 둬 부모 높이도 밀지 않는다.
      className="absolute inset-0 block h-full! w-full [&_*]:[vector-effect:non-scaling-stroke]"
    >
      <rect width="160" height="100" className={`${ground} stroke-none`} />
      {children}
    </svg>
  );
}

/** 작은 잎 하나. 원점에서 오른쪽으로 7만큼 뻗는다. */
function Leaf({ x, y, angle = 0, className }: { x: number; y: number; angle?: number; className: string }) {
  return <path d="M0 0q3.5-3 7 0q-3.5 3-7 0z" transform={`translate(${x} ${y}) rotate(${angle})`} className={className} />;
}

/** 간결한 분위기 — 넓은 여백, 가는 아치 하나, 꽃 한 줄기. */
function MinimalScene() {
  return (
    <Scene ground="fill-paper-sheet">
      <path d="M18 80H142" className="stroke-paper-divider" />
      <path d="M60 80V42a20 20 0 0 1 40 0v38z" className="fill-paper-tint stroke-none" />
      <path d="M60 80V42a20 20 0 0 1 40 0v38" className="stroke-paper-outline" />
      <path d="M118 69c0-9-2.5-17 1.2-27" className="stroke-paper-gyp" />
      <path d="M118.2 57c-4.2-.6-6.6-3.4-7.2-7 3.8.4 6.4 2.8 7.2 7z" className="fill-sage-pale stroke-paper-gyp" />
      <circle cx="119.4" cy="40" r="2.6" className="fill-rose-light stroke-rose-500" />
      <path d="M115 80c-1.3-3.6-1-7.6 1.2-11h4.6c2.2 3.4 2.5 7.4 1.2 11z" className="fill-paper-card stroke-paper-outline" />
    </Scene>
  );
}

function ClassicColumn({ x }: { x: number }) {
  return (
    <g className="stroke-noir-soft">
      <rect x={x - 4} y="28" width="8" height="40" className="fill-ivory-50" />
      <path d={`M${x - 1.3} 31v34M${x + 1.3} 31v34`} className="stroke-noir-soft/40" />
      <path d={`M${x - 6} 24h12v4h-12zM${x - 8} 24h16`} className="fill-ivory-50" />
      <path d={`M${x - 6} 68h12v4h-12zM${x - 8} 72h16`} className="fill-ivory-50" />
    </g>
  );
}

function Candle({ x }: { x: number }) {
  return (
    <g>
      <path d={`M${x} 72V53M${x - 4} 72h8M${x - 3} 53h6`} className="stroke-noir-soft" />
      <rect x={x - 1.5} y="45" width="3" height="8" className="fill-paper-card stroke-gold" />
      <path d={`M${x} 43.5c-1.3-1.5-1-3.2 0-4.8 1 1.6 1.3 3.3 0 4.8z`} className="fill-gold stroke-none" />
    </g>
  );
}

/** 정돈된 격식 — 좌우 대칭 기둥, 가라앉은 드레이프, 가운데 길. 장식은 절제한다. */
function ClassicScene() {
  return (
    <Scene ground="fill-ivory-100">
      <path d="M0 72H160V100H0z" className="fill-ivory-200 stroke-none" />
      <path d="M74 72h12l14 28H60z" className="fill-gold-light stroke-none" />
      <path d="M74 72 60 100M86 72l14 28" className="stroke-gold/70" />
      <path d="M68 72V44h24v28" className="stroke-noir-soft/40" />
      <path d="M65 44h30M67 41h26" className="stroke-noir-soft/60" />
      <ClassicColumn x={32} />
      <ClassicColumn x={128} />
      <path d="M38 25q42 27 84 0-42 15-84 0z" className="fill-gold-light stroke-gold" />
      <path d="M38 25c3 10 1 22 4 34M122 25c-3 10-1 22-4 34" className="stroke-gold" />
      <Candle x={58} />
      <Candle x={102} />
    </Scene>
  );
}

/** 꽃 한 송이 — 원 하나와 안쪽 소용돌이 한 획. */
function Bloom({ x, y, r, className }: { x: number; y: number; r: number; className: string }) {
  const s = r * 0.42;
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r} className={className} />
      <path d={`M${-s} 0a${s} ${s} 0 1 1 ${s} ${s}`} className="stroke-rose-500/80" />
    </g>
  );
}

/** 둥글게 모은 꽃 무더기. 가운데가 가장 짙고 가장자리로 갈수록 옅다. */
function Bouquet({ x, y, flip = false }: { x: number; y: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})${flip ? " scale(-1 1)" : ""}`}>
      <Leaf x={-9} y={2} angle={165} className="fill-sage-500/40 stroke-sage-500" />
      <Leaf x={8} y={3} angle={15} className="fill-sage-500/40 stroke-sage-500" />
      <Leaf x={-2} y={-9} angle={-100} className="fill-sage-500/40 stroke-sage-500" />
      <Bloom x={-6} y={0} r={4} className="fill-rose-light stroke-rose-500/70" />
      <Bloom x={6} y={.5} r={3.8} className="fill-rose-pale stroke-rose-500/70" />
      <Bloom x={-3} y={-6} r={3.6} className="fill-ivory-50 stroke-rose-500/70" />
      <Bloom x={4} y={-5.5} r={3.4} className="fill-rose-light stroke-rose-500/70" />
      <Bloom x={0} y={-1} r={4.6} className="fill-rose-500/80 stroke-rose-500" />
      <circle cx="-8.5" cy="-5" r=".9" className="fill-gold stroke-none" />
      <circle cx="9" cy="-4" r=".9" className="fill-gold stroke-none" />
    </g>
  );
}

function FloralPedestal({ x }: { x: number }) {
  return (
    <g>
      <path d={`M${x - 3} 80V62h6v18zM${x - 6} 62h12M${x - 5} 80h10`} className="fill-ivory-50 stroke-rose-500/60" />
      <Bouquet x={x} y={57} flip={x > 80} />
    </g>
  );
}

/** 눈에 띄는 연출 — 샹들리에, 겹겹의 꽃, 더 짙은 색. */
function FancyScene() {
  const drops: [number, number][] = [[66, 25.5], [73, 28.5], [87, 28.5], [94, 25.5]];
  const lights: [number, number][] = [[8, 19], [18, 23], [28, 25], [38, 24], [48, 21]];
  return (
    <Scene ground="fill-ivory-blush">
      <path d="M0 80H160V100H0z" className="fill-rose-pale stroke-none" />
      <path d="M72 80h16l12 20H60z" className="fill-rose-light/60 stroke-none" />
      {lights.map(([lx, ly]) => <circle key={lx} cx={lx} cy={ly} r="1" className="fill-gold stroke-none" />)}
      {lights.map(([lx, ly]) => <circle key={lx} cx={160 - lx} cy={ly} r="1" className="fill-gold stroke-none" />)}
      <path d="M0 16q28 14 56 2M160 16q-28 14-56 2" className="stroke-gold/50" />
      {/* 넓은 칸(2:1)에서 위 10이 잘리므로 샹들리에 전체를 4 내린다. 사슬은 잘려도 된다. */}
      <g transform="translate(0 4)">
        <g className="stroke-gold">
          <path d="M80-4v18M80 14v16.5M80 14c-8 8-16 8-20 4M80 14c8 8 16 8 20 4M66 21q14 10 28 0" />
          <path d="M66 21v3.3M73 24.8v2.5M87 24.8v2.5M94 21v3.3" className="stroke-gold/60" />
          <ellipse cx="80" cy="14" rx="3" ry="1.5" className="fill-gold-light" />
          <path d="M60 18v-3.5M100 18v-3.5M70 20.5v-3M90 20.5v-3" />
          {drops.map(([dx, dy]) => <circle key={dx} cx={dx} cy={dy} r="1.2" className="fill-gold-light" />)}
          <path d="M80 30.5l1.6 2.2-1.6 2.2-1.6-2.2z" className="fill-gold-light" />
        </g>
        <g className="fill-paper-tape stroke-none">
          <circle cx="60" cy="13.5" r="1.3" />
          <circle cx="100" cy="13.5" r="1.3" />
          <circle cx="70" cy="16.5" r="1.3" />
          <circle cx="90" cy="16.5" r="1.3" />
        </g>
      </g>
      <FloralPedestal x={28} />
      <FloralPedestal x={132} />
      <Bouquet x={70} y={80} />
      <Bouquet x={90} y={80} flip />
    </Scene>
  );
}

/** 편안한 분위기 — 바깥의 빛, 나무, 부드러운 둔덕, 나무로 된 아치. */
function NaturalScene() {
  const garland: [number, number, number][] = [[63, 44, 200], [69, 42, -20], [75, 44, 190], [81, 42, -10], [87, 44, 200], [92, 42, -30]];
  return (
    <Scene ground="fill-paper-tint">
      <circle cx="126" cy="26" r="14" className="fill-paper-tape/40 stroke-none" />
      <circle cx="126" cy="26" r="8" className="fill-paper-tape stroke-none" />
      <path d="M0 70c30-12 60-8 90-4 25 3 50-6 70-4v38H0z" className="fill-sage-pale/60 stroke-none" />
      <path d="M0 80c40-6 110-4 160 0v20H0z" className="fill-sage-pale stroke-none" />
      <path d="M0 80c40-6 110-4 160 0" className="stroke-sage-500/50" />
      <path d="M30 80V58M30 67l-5-5M30 63l5-4" className="stroke-paper-stem" />
      <path d="M16 50c-4-12 6-24 16-20 8-6 18 4 14 14 4 10-8 16-16 12-8 4-16 2-14-6z" className="fill-sage-500/30 stroke-sage-500" />
      <path d="M138 80V64" className="stroke-paper-stem" />
      <path d="M129 57c-2-8 4-14 10-12 6-3 11 3 9 9 2 6-5 10-10 7-5 2-10 0-9-4z" className="fill-sage-500/30 stroke-sage-500" />
      <path d="M67 80V45h2.5v35zM90.5 80V45H93v35z" className="fill-paper-stem/40 stroke-paper-stem" />
      <path d="M62 44h36M65 48h30" className="stroke-paper-stem" />
      {garland.map(([gx, gy, angle]) => <Leaf key={gx} x={gx} y={gy} angle={angle} className="fill-sage-500/45 stroke-sage-500" />)}
      <circle cx="72" cy="43" r="2" className="fill-rose-light stroke-rose-500" />
      <circle cx="88" cy="42.5" r="2" className="fill-rose-light stroke-rose-500" />
      <Leaf x={69.5} y={52} angle={-30} className="fill-sage-500/45 stroke-sage-500" />
      <Leaf x={66.5} y={58} angle={200} className="fill-sage-500/45 stroke-sage-500" />
      <path d="M50 85l1-4 1 4M110 84l1-4 1 4M120 88l1-4 1 4" className="stroke-sage-500" />
    </Scene>
  );
}

function Pendant({ x, top }: { x: number; top: number }) {
  return (
    <g>
      <path d={`M${x} ${top}v10`} className="stroke-noir-soft/60" />
      <circle cx={x} cy={top + 15} r="4.5" className="fill-paper-tape/50 stroke-none" />
      <path d={`M${x - 4} ${top + 14}l2-4h4l2 4z`} className="fill-paper-card stroke-noir-soft" />
    </g>
  );
}

/** 실내 — 벽과 천장이 있는 방, 아치형 창, 매달린 등. */
function IndoorScene() {
  return (
    <Scene ground="fill-ivory-100">
      <path d="M44 70h72l44 26v4H0v-4z" className="fill-ivory-200 stroke-none" />
      <path d="M44 22h72v48H44z" className="fill-ivory-50 stroke-paper-divider" />
      <path d="M0 8l44 14M160 8l-44 14M0 96l44-26M160 96l-44-26" className="stroke-paper-divider" />
      <path d="M74 70h12l10 30H64z" className="fill-rose-pale stroke-none" />
      <path d="M68 64V38a12 12 0 0 1 24 0v26z" className="fill-paper-card stroke-noir-soft/60" />
      <path d="M80 26v38M68 48h24" className="stroke-noir-soft/40" />
      <Pendant x={26} top={10} />
      <Pendant x={134} top={10} />
    </Scene>
  );
}

/** 야외 — 하늘, 해, 구름, 둔덕과 나무, 풀밭 사이의 길. */
function OutdoorScene() {
  return (
    <Scene ground="fill-paper-tint">
      <circle cx="32" cy="26" r="12" className="fill-paper-tape/40 stroke-none" />
      <circle cx="32" cy="26" r="7" className="fill-paper-tape stroke-none" />
      <path d="M96 30c1-4 7-5 9-1 3-2 7 0 7 3 3 0 4 3 2 4H96c-3 0-3-5 0-6z" className="fill-paper-card stroke-paper-divider" />
      <path d="M0 68c26-10 56-8 84-2 28 5 52-4 76-2v36H0z" className="fill-sage-pale/60 stroke-none" />
      <path d="M0 78c44-6 112-5 160 0v22H0z" className="fill-sage-pale stroke-none" />
      <path d="M0 78c44-6 112-5 160 0" className="stroke-sage-500/50" />
      <path d="M72 100c4-10 6-16 6-24h4c0 8 4 14 10 24z" className="fill-ivory-200 stroke-none" />
      <path d="M124 78V56M124 64l5-4" className="stroke-paper-stem" />
      <path d="M110 46c-3-10 5-19 13-16 7-5 16 2 13 10 4 8-5 14-12 11-7 4-15 1-14-5z" className="fill-sage-500/30 stroke-sage-500" />
      <path d="M40 84l1-4 1 4M58 88l1-4 1 4M104 86l1-4 1 4" className="stroke-sage-500" />
    </Scene>
  );
}

/** 실내와 야외를 함께 — 왼쪽은 등이 달린 실내, 활짝 열린 유리문 너머 오른쪽은 정원. */
function BothSpacesScene() {
  return (
    <Scene ground="fill-paper-tint">
      <circle cx="140" cy="24" r="6.5" className="fill-paper-tape stroke-none" />
      <path d="M0 18h78v62H0z" className="fill-ivory-100 stroke-none" />
      <path d="M0 80h78v20H0z" className="fill-ivory-200 stroke-none" />
      <path d="M78 80c22-8 52-8 82-4v24H78z" className="fill-sage-pale stroke-none" />
      <path d="M78 80c22-8 52-8 82-4" className="stroke-sage-500/50" />
      <path d="M0 18h82M78 18v18M0 80h96" className="stroke-noir-soft/60" />
      <path d="M78 38l12 4v34l-12 4z" className="fill-paper-card/70 stroke-noir-soft/60" />
      <path d="M40 18v10" className="stroke-noir-soft/60" />
      <circle cx="40" cy="33" r="5" className="fill-paper-tape/50 stroke-none" />
      <path d="M36 32l2-4h4l2 4z" className="fill-paper-card stroke-noir-soft" />
      <path d="M28 62h24M32 62v18M48 62v18" className="stroke-paper-stem" />
      <path d="M132 76V58M132 66l-5-4" className="stroke-paper-stem" />
      <path d="M119 50c-3-9 4-17 12-14 6-4 14 2 12 9 3 7-5 12-11 9-6 3-13 1-13-4z" className="fill-sage-500/30 stroke-sage-500" />
      <path d="M104 86l1-4 1 4M146 88l1-4 1 4" className="stroke-sage-500" />
    </Scene>
  );
}

type MoodValue = (typeof TASTE_MOOD_OPTIONS)[number]["value"];
type VenueValue = (typeof TASTE_DOMAIN_QUESTIONS)["venue"]["options"][number]["value"];

/**
 * 공유 상수(`WEDDING_STYLE_OPTIONS`)의 값에 그림을 붙인다. 값·라벨은 건드리지 않는다.
 * `Record` 라서 값이 늘면 그림이 빠진 채로는 컴파일되지 않는다.
 */
export const MOOD_SCENES: Record<MoodValue, () => ReactNode> = {
  minimal: MinimalScene,
  classic: ClassicScene,
  fancy: FancyScene,
  natural: NaturalScene,
};

export const VENUE_SCENES: Record<VenueValue, () => ReactNode> = {
  indoor: IndoorScene,
  outdoor: OutdoorScene,
  both_spaces: BothSpacesScene,
};
