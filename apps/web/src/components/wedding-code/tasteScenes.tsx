import type { ReactNode } from "react";
import type { TASTE_DOMAIN_QUESTIONS, TASTE_MOOD_OPTIONS, TasteDomain } from "@/lib/weddingCode/taste";

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
 * - 사람은 실루엣으로만 그린다. 머리는 민 원 하나(윗부분만 머리카락 색)이고 눈·코·입을
 *   그리지 않는다. 옷은 사람 없이 마네킹 틀이나 옷걸이에 건다.
 * - 클립 경로·패턴·그라디언트를 쓰지 않는다(`url(#…)` 참조가 생긴다). 작은 그림 안의 내용은
 *   좌표로 테두리 안에 맞춘다.
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

/** 좌표를 계산해 문자열에 넣을 때 부동소수 꼬리(2.5500000000000003)를 자른다. */
const round = (value: number) => Math.round(value * 100) / 100;

/** 사람 머리 — 민 원 하나에 윗부분만 머리카락 색. 얼굴은 그리지 않는다. */
function Head({ y }: { y: number }) {
  return (
    <g>
      <circle cy={y} r="2.6" className="fill-ivory-200 stroke-noir-soft/70" />
      <path d={`M-2.6 ${y}a2.6 2.6 0 0 1 5.2 0q-2.6-1.5-5.2 0z`} className="fill-noir-soft/70 stroke-none" />
    </g>
  );
}

/** 작은 꽃다발. 드레스 실루엣이 두 손으로 든다. */
function Posy({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-.6 .8l.6 3 .6-3" className="stroke-sage-500" />
      <circle cx="-1.3" cy="0" r="1.5" className="fill-rose-light stroke-rose-500/70" />
      <circle cx="1.3" cy=".2" r="1.4" className="fill-rose-pale stroke-rose-500/70" />
      <circle cx="0" cy="-1.2" r="1.5" className="fill-rose-500/80 stroke-rose-500" />
    </g>
  );
}

/**
 * 드레스를 입은 사람 실루엣과 정장을 입은 사람 실루엣을 나란히 세운다.
 * 원점은 두 사람 발 사이 가운데이고, 위로 약 29 만큼 선다.
 *
 * - `walking`: 걷는 자세(벌린 다리, 흩날리는 베일, 맞잡은 손).
 * - `posed`: 정면을 보고 곧게 선 자세(드레스 쪽이 꽃다발을 든다).
 */
function Couple({ x, y, s = 1, lean = 0, pose = "posed" }: { x: number; y: number; s?: number; lean?: number; pose?: "walking" | "posed" }) {
  const walking = pose === "walking";
  return (
    <g transform={`translate(${x} ${y}) rotate(${lean}) scale(${s})`}>
      <g transform="translate(-6.5 0)">
        <path d={walking ? "M-.8-28.2C-7-28.4-13-24-17.5-17c5-2 9.6-2.8 13.6-2.2" : "M-.8-28.2c-4 2.2-5.4 9-5 17.2l3.2-3.8"} className="fill-ivory-50/80 stroke-paper-divider" />
        <path d={walking ? "M-3.6-15.5h7.2l3.9 15.1q-7.4 1.6-16.4.3z" : "M-3.6-15.5h7.2L7 0H-7z"} className="fill-paper-card stroke-noir-soft/70" />
        <path d="M-2.8-22.5h5.6l.8 7h-7.2z" className="fill-paper-card stroke-noir-soft/70" />
        <path d={walking ? "M-2.8-22.2q-2.2 3.4-3.2 7.8M2.8-22.2q2.4 3 3.6 7" : "M-2.8-22.2q-1.4 4.4 2 7.2M2.8-22.2q1.4 4.4-2 7.2"} className="stroke-noir-soft/70" />
        <Head y={-25.8} />
        {walking ? null : <Posy x={0} y={-15.6} />}
      </g>
      <g transform="translate(6.5 0)">
        <path d={walking ? "M-3.4-12.5-6.8-.4l2.9.6L0-8l2.6 8h3L3.4-12.5z" : "M-3.4-12.5-3.6 0h3L0-9l.6 9h3l-.2-12.5z"} className="fill-noir-soft stroke-noir-soft" />
        <path d="M-3.8-23.2h7.6l.5 11.2h-8.6z" className="fill-noir-soft/85 stroke-noir-soft" />
        <path d="M-1.4-23.2 0-19.4l1.4-3.8z" className="fill-paper-card stroke-none" />
        <path d={walking ? "M-3.8-22.6q-1.6 4.4-2.4 8.4M3.8-22.6q1.6 4.6 1.2 9" : "M-3.8-22.6l-1 9M3.8-22.6l1 9"} className="stroke-noir-soft" />
        <Head y={-26.2} />
      </g>
      {walking ? <path d="M-.3-14.2q2.4 1.6 4.3-.4" className="stroke-noir-soft/70" /> : null}
    </g>
  );
}

/** 카메라 화면의 네 귀퉁이. 사진 질문의 그림이 "찍히는 장면" 으로 읽히게 한다. */
function Viewfinder() {
  return <path d="M14 24V14h10M136 14h10v10M146 76v10h-10M24 86H14V76" className="stroke-noir-soft/60" />;
}

/** 자연스러운 순간 — 야외에서 손잡고 걷는 두 사람, 날리는 베일과 꽃잎, 한쪽으로 치우친 구도. */
function CandidScene() {
  const petals: [number, number, number][] = [[30, 36, 20], [42, 28, -40], [88, 34, 60], [98, 46, -10], [80, 24, 140]];
  return (
    <Scene ground="fill-paper-tint">
      <circle cx="120" cy="30" r="11" className="fill-paper-tape/40 stroke-none" />
      <circle cx="120" cy="30" r="6" className="fill-paper-tape stroke-none" />
      <path d="M0 72c30-7 66-7 98-2 24 4 44 1 62-2v32H0z" className="fill-sage-pale stroke-none" />
      <path d="M0 72c30-7 66-7 98-2 24 4 44 1 62-2" className="stroke-sage-500/50" />
      <path d="M134 71V53M134 61l5-4" className="stroke-paper-stem" />
      <path d="M121 45c-3-9 4-17 12-14 6-4 14 2 12 9 3 7-5 12-11 9-6 3-13 1-13-4z" className="fill-sage-500/30 stroke-sage-500" />
      <path d="M20 50h-7M22 57h-10M20 64h-6" className="stroke-paper-outline/60" />
      <Couple x={60} y={80} s={1.35} lean={6} pose="walking" />
      {petals.map(([px, py, angle]) => <Leaf key={px} x={px} y={py} angle={angle} className="fill-rose-light stroke-rose-500/60" />)}
      <path d="M104 84l1-4 1 4M118 86l1-4 1 4" className="stroke-sage-500" />
      <Viewfinder />
    </Scene>
  );
}

/** 준비한 포즈와 장면 — 삼각대 위 카메라, 조명, 배경지 앞에 곧게 선 두 사람. */
function DirectedScene() {
  return (
    <Scene ground="fill-ivory-100">
      <path d="M0 82H160V100H0z" className="fill-ivory-200 stroke-none" />
      <path d="M20 22 20 34 98 76 98 44z" className="fill-paper-tape/30 stroke-none" />
      <path d="M58 16h90" className="stroke-noir-soft/60" />
      <path d="M62 16h82v54q0 10 10 12H52q10-2 10-12z" className="fill-ivory-50 stroke-paper-divider" />
      <Couple x={103} y={78} s={1.3} />
      <path d="M90 80.5h6M110 80.5h6" className="stroke-gold" />
      <path d="M12 38v48M7 86l5-5 5 5" className="stroke-noir-soft/70" />
      <path d="M8 20 20 22v12l-12 2z" className="fill-paper-card stroke-noir-soft/70" />
      <path d="M38 60 29 86M38 60v26M38 60l9 26" className="stroke-noir-soft" />
      <path d="M34 57h8v3h-8z" className="fill-noir-soft stroke-noir-soft" />
      <rect x="28" y="43" width="18" height="14" rx="2" className="fill-noir-soft/80 stroke-noir-soft" />
      <path d="M31 43v-3h6v3" className="fill-noir-soft stroke-noir-soft" />
      <path d="M46 46h6v8h-6z" className="fill-noir-soft stroke-noir-soft" />
      <path d="M40 43v-2h4v2" className="fill-paper-tape stroke-noir-soft" />
    </Scene>
  );
}

/** 사진 한 장(아래 여백이 넓은 인화지). 안쪽 그림 칸은 가로 44·세로 42, 원점은 칸 가운데. */
function Print({ x, y, angle, children, taped = false }: { x: number; y: number; angle: number; children: ReactNode; taped?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <path d="M-26-26H26V34H-26z" className="fill-paper-card stroke-paper-outline/70" />
      {children}
      {taped ? <path d="M-8-29h16v6H-8z" className="fill-paper-tape/80 stroke-none" /> : null}
    </g>
  );
}

/** 두 방식 모두 — 겹쳐 둔 사진 두 장. 왼쪽은 걷는 순간, 오른쪽은 배경지 앞의 포즈. */
function BothStylesScene() {
  return (
    <Scene ground="fill-ivory-blush">
      <Print x={56} y={50} angle={-7}>
        <path d="M-22-22H22V20H-22z" className="fill-paper-tint stroke-none" />
        <circle cx="12" cy="-12" r="4" className="fill-paper-tape stroke-none" />
        <path d="M-22 8q22-6 44-1v13h-44z" className="fill-sage-pale stroke-none" />
        <Couple x={-3} y={15} s={0.7} lean={6} pose="walking" />
        <Leaf x={9} y={-3} angle={30} className="fill-rose-light stroke-rose-500/60" />
      </Print>
      <Print x={106} y={48} angle={6} taped>
        <path d="M-22-22H22V20H-22z" className="fill-ivory-50 stroke-none" />
        <path d="M-22 10H22v10H-22z" className="fill-ivory-200 stroke-none" />
        <Couple x={0} y={15} s={0.7} />
      </Print>
      <path d="M134 80v-3h3l1.5-2h5l1.5 2h3v10h-14z" className="fill-noir-soft/80 stroke-noir-soft" />
      <circle cx="141" cy="82" r="2.4" className="fill-paper-tape stroke-none" />
    </Scene>
  );
}

/** 마네킹 틀의 목과 어깨. 원점은 받침 바닥 가운데, 틀은 위로 약 63 만큼 선다. */
function FormNeck({ shoulders = true }: { shoulders?: boolean }) {
  return (
    <g>
      <path d="M-2-59.5v-3h4v3" className="fill-paper-stem/40 stroke-paper-stem" />
      {shoulders ? <path d="M-7-55.5c0-2.6 2.2-4 5-4h4c2.8 0 5 1.4 5 4" className="fill-ivory-200 stroke-noir-soft/60" /> : null}
    </g>
  );
}

/** 정장 한 벌을 입힌 틀. 색과 장식은 부르는 쪽이 정한다. */
function SuitForm({ x, y, jacket, trousers, lapel, children }: { x: number; y: number; jacket: string; trousers: string; lapel: string; children?: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <FormNeck />
      <path d="M-7.4-31-7.8-3h6.2L0-24l1.6 21h6.2l-.4-28z" className={trousers} />
      <path d="M-2.6-59Q-6.6-58.6-8.6-55.5L-9.2-31H9.2L8.6-55.5Q6.6-58.6 2.6-59L0-50z" className={jacket} />
      <path d="M-2.6-59 0-50l2.6-9z" className="fill-paper-card stroke-noir-soft/50" />
      <path d="M0-50v19M-2.6-59l-1.8 8 3 1.8M2.6-59l1.8 8-3 1.8M-7.6-53l-.3 20M7.6-53l.3 20" className={lapel} />
      <path d="M-6 0h12M0-3v3" className="stroke-paper-stem" />
      {children}
    </g>
  );
}

/** 옷 한 벌을 입힌 틀. 옷 모양은 `children` 이 그린다. 어깨까지 덮는 옷(한복)은 `covered`. */
function DressForm({ x, y, covered = false, children }: { x: number; y: number; covered?: boolean; children: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {children}
      <FormNeck shoulders={!covered} />
    </g>
  );
}

function FittingFloor({ ground }: { ground: string }) {
  return <path d="M0 80H160V100H0z" className={`${ground} stroke-none`} />;
}

/** 간결한 선과 장식 — 곧게 떨어지는 드레스와 어두운 단추 하나짜리 정장, 뒤에 가는 아치 하나. */
function SimpleAttireScene() {
  return (
    <Scene ground="fill-paper-sheet">
      <path d="M71 84V40a9 9 0 0 1 18 0v44" className="fill-paper-tint stroke-paper-divider" />
      <path d="M0 84H160" className="stroke-paper-divider" />
      <DressForm x={56} y={84}>
        <path d="M-7-55.5Q0-54 7-55.5L5.2-41 7.2-31 9 0H-9l1.8-31 2-10z" className="fill-paper-card stroke-noir-soft/70" />
        <path d="M-5.2-41H5.2" className="stroke-paper-divider" />
      </DressForm>
      <SuitForm x={104} y={84} jacket="fill-noir-soft/85 stroke-noir-soft" trousers="fill-noir-soft/70 stroke-noir-soft" lapel="stroke-ivory-50/70">
        <circle cy="-40" r=".9" className="fill-ivory-50 stroke-none" />
      </SuitForm>
      <path d="M140 76c0-8-2-15 1-24" className="stroke-paper-gyp" />
      <path d="M140.2 66c-3.6-.6-5.6-3-6.2-6 3.2.4 5.4 2.4 6.2 6z" className="fill-sage-pale stroke-paper-gyp" />
      <circle cx="141.2" cy="50" r="2.2" className="fill-rose-light stroke-rose-500" />
      <path d="M137 84c-1.2-3-1-6 1-8.6h4.2c2 2.6 2.2 5.6 1 8.6z" className="fill-paper-card stroke-paper-outline" />
    </Scene>
  );
}

/** 부드럽게 흐르는 형태 — 물결치듯 퍼지는 치마와 긴 뒷자락, 바람에 날리는 베일, 밝은 리넨 정장. */
function FlowingAttireScene() {
  return (
    <Scene ground="fill-paper-tint">
      <FittingFloor ground="fill-ivory-100" />
      <path d="M8 30q8-4 16 0t16 0M120 22q8-4 16 0t16 0M130 40q6-3 12 0" className="stroke-paper-divider" />
      <DressForm x={54} y={84}>
        <path d="M-1.5-62.2C-12-56-20-38-24-14c5-6 10-18 22.5-44" className="fill-ivory-50/80 stroke-paper-divider" />
        <path d="M-7-55.5Q0-52 7-55.5L5.4-41q7 16 11 32 6 5 14 9-8 2-16 0-3 2-7 0-4 2-8 0-4 2-8 0-4 2-8 0 2-20 11-41z" className="fill-paper-card stroke-noir-soft/70" />
        <path d="M-5.4-41H5.4M-1.5-39q-3 18-6 38M2-39q4 17 9 37M5-38q8 16 16 35" className="stroke-paper-divider" />
        <path d="M-7-55q-4 3-5.4 8 3 1 5-1M7-55q4 3 5.4 8-3 1-5-1" className="fill-paper-card stroke-noir-soft/60" />
      </DressForm>
      <SuitForm x={108} y={84} jacket="fill-ivory-200 stroke-paper-outline" trousers="fill-ivory-50 stroke-paper-outline" lapel="stroke-paper-outline/60" />
    </Scene>
  );
}

/** 반짝임 하나(네 갈래 별). */
function Sparkle({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return <path d="M0-4Q.6-.6 4 0 .6.6 0 4-.6.6-4 0-.6-.6 0-4z" transform={`translate(${x} ${y}) scale(${s})`} className="fill-gold stroke-none" />;
}

/** 눈에 띄는 장식 — 크게 부푼 치마에 겹겹의 주름과 리본, 반짝임, 금단추와 꽃을 단 정장. */
function DecorativeAttireScene() {
  const lace: [number, number][] = [[-14, -18], [-6, -24], [4, -20], [12, -14], [-10, -8], [2, -10], [16, -6], [-18, -4]];
  return (
    <Scene ground="fill-ivory-blush">
      <FittingFloor ground="fill-rose-pale" />
      <path d="M0 14q30 12 60 2M100 16q30 10 60-2" className="stroke-gold/50" />
      <Sparkle x={20} y={34} />
      <Sparkle x={28} y={54} s={0.7} />
      <Sparkle x={134} y={36} s={0.8} />
      <Sparkle x={142} y={60} />
      <DressForm x={56} y={84}>
        <path d="M-7-55.5Q0-52 7-55.5L5.2-41Q22-28 24 0H-24Q-22-28-5.2-41z" className="fill-paper-card stroke-noir-soft/70" />
        <path d="M-19-18q4.75 3 9.5 0t9.5 0 9.5 0 9.5 0M-22.5-7q5.6 3 11.2 0t11.2 0 11.2 0 11.2 0M-24 0q6 3 12 0t12 0 12 0 12 0" className="stroke-rose-500/50" />
        {lace.map(([lx, ly]) => <circle key={`${lx}${ly}`} cx={lx} cy={ly} r=".8" className="fill-gold stroke-none" />)}
        <path d="M0-41l-5-3v6zM0-41l5-3v6z" className="fill-rose-light stroke-rose-500" />
        <path d="M-7-55q-4 0-4.6 4.4 3 1.6 5 0M7-55q4 0 4.6 4.4-3 1.6-5 0" className="fill-rose-pale stroke-rose-500/70" />
      </DressForm>
      <SuitForm x={110} y={84} jacket="fill-noir-soft/85 stroke-noir-soft" trousers="fill-noir-soft/70 stroke-noir-soft" lapel="stroke-gold">
        <path d="M-3-57.6v2.8l3-1.4zM3-57.6v2.8l-3-1.4z" className="fill-gold stroke-gold" />
        <circle cx="-2" cy="-42" r=".9" className="fill-gold stroke-none" />
        <circle cx="2" cy="-42" r=".9" className="fill-gold stroke-none" />
        <circle cx="-2" cy="-37" r=".9" className="fill-gold stroke-none" />
        <circle cx="2" cy="-37" r=".9" className="fill-gold stroke-none" />
        <circle cx="-5.2" cy="-50.5" r="1.8" className="fill-rose-light stroke-rose-500" />
        <path d="M4.2-48.5h3.2l-.6 1.8h-2z" className="fill-rose-light stroke-rose-500" />
      </SuitForm>
    </Scene>
  );
}

/** 한복 소매(배래). 끝에 색동 한 줄을 두른다. 원점은 어깨, `side` 가 -1 이면 왼쪽. */
function HanbokSleeve({ side, fill, cuff }: { side: 1 | -1; fill: string; cuff: string }) {
  return (
    <g transform={`scale(${side} 1)`}>
      <path d="M0 0C4-.4 6.6 4 6.8 10.4c.2 2.8-1.6 4-4 3.4L.4 7.4" className={fill} />
      <path d="M6.9 9.2c-.6 2.4-2.2 3.6-4.2 3.2" className={cuff} />
    </g>
  );
}

/** 저고리의 깃·동정·고름. 원점은 목 가운데. */
function HanbokCollar({ ribbon, ribbonSoft }: { ribbon: string; ribbonSoft: string }) {
  return (
    <g>
      <path d="M-3-59.4-1.6-59.6 3-52.8 1.8-52z" className="fill-paper-card stroke-noir-soft/60" />
      <path d="M3-59.4 1.6-59.6-.2-56.8" className="stroke-noir-soft/60" />
      <path d="M1.4-52.2h1.6c1 6 .2 11.6 1.8 17.4l-1.8.4c-1.4-5.8-.6-11.6-1.6-17.8z" className={`${ribbon} stroke-none`} />
      <path d="M1-52h1.4c.2 5-.4 9 0 13.4l-1.6.2c-.6-4.4.2-8.8.2-13.6z" className={`${ribbonSoft} stroke-none`} />
      <circle cx="2.2" cy="-52.4" r="1.2" className={`${ribbon} stroke-none`} />
    </g>
  );
}

/** 문살 창 — 전통 공간이라는 것을 옷 뒤에서 조용히 알린다. */
function LatticeWindow({ x }: { x: number }) {
  return (
    <g transform={`translate(${x} 24)`}>
      <path d="M0 0h22v34H0z" className="fill-paper-card stroke-paper-stem" />
      <path d="M5.5 0v34M11 0v34M16.5 0v34M0 8.5h22M0 17h22M0 25.5h22" className="stroke-paper-stem/60" />
    </g>
  );
}

/** 전통 의복의 모습 — 녹색 저고리에 붉은 치마를 입힌 한복과, 바지저고리 한 벌. */
function TraditionalAttireScene() {
  return (
    <Scene ground="fill-ivory-100">
      <FittingFloor ground="fill-ivory-200" />
      <LatticeWindow x={10} />
      <LatticeWindow x={128} />
      <DressForm x={58} y={84} covered>
        <path d="M-7-50C-11-36-17-14-18 0H18C17-14 11-36 7-50z" className="fill-rose-light stroke-rose-500" />
        <path d="M-3.4-46Q-6.4-22-8.4-1M0-46V-1M3.4-46Q6.4-22 8.4-1" className="stroke-rose-500/40" />
        <g transform="translate(-7 -56)"><HanbokSleeve side={-1} fill="fill-sage-pale stroke-sage-500" cuff="stroke-rose-500" /></g>
        <g transform="translate(7 -56)"><HanbokSleeve side={1} fill="fill-sage-pale stroke-sage-500" cuff="stroke-rose-500" /></g>
        <path d="M-7-55.5Q-7-59-2.5-59.5h5Q7-59 7-55.5l.6 7q-7.6 1.6-15.2 0z" className="fill-sage-pale stroke-sage-500" />
        <HanbokCollar ribbon="fill-rose-500" ribbonSoft="fill-rose-500/70" />
      </DressForm>
      <DressForm x={102} y={84} covered>
        <path d="M-8-40C-12.5-30-11.5-12-8-5l.4 4h5.4L-2-5C-1.4-14-.8-22 0-26c.8 4 1.4 12 2 21l-.2 4h5.4L7.6-5C11.5-12 12.5-30 8-40z" className="fill-ivory-50 stroke-paper-outline" />
        <path d="M-8.2-5h6M2.2-5h6" className="stroke-noir-soft/60" />
        <g transform="translate(-7.4 -56)"><HanbokSleeve side={-1} fill="fill-ivory-200 stroke-noir-soft/60" cuff="stroke-noir-soft/40" /></g>
        <g transform="translate(7.4 -56)"><HanbokSleeve side={1} fill="fill-ivory-200 stroke-noir-soft/60" cuff="stroke-noir-soft/40" /></g>
        <path d="M-7.4-55.5Q-7.4-59-2.5-59.5h5Q7.4-59 7.4-55.5L8.6-38Q0-36.4-8.6-38z" className="fill-ivory-200 stroke-noir-soft/60" />
        <HanbokCollar ribbon="fill-noir-soft/80" ribbonSoft="fill-noir-soft/55" />
      </DressForm>
    </Scene>
  );
}

/** 위에 둥근 뚜껑을 덮은 음식 데우는 그릇. 원점은 탁자 위 가운데. `open` 이면 뚜껑 없이 음식이 보인다. */
function ChafingDish({ x, open = false }: { x: number; open?: boolean }) {
  return (
    <g transform={`translate(${x} 54)`}>
      <path d="M-11 0l1.6-6M11 0l-1.6-6" className="stroke-gold" />
      <path d="M0-1.6c-1.1-1.1-.9-2.6 0-3.8.9 1.2 1.1 2.7 0 3.8z" className="fill-gold stroke-none" />
      {open ? <g>
        <path d="M-10-12q10-5 20 0" className="fill-rose-light stroke-rose-500/70" />
        <circle cx="-4" cy="-13.4" r="1.2" className="fill-sage-500/60 stroke-none" />
        <circle cx="3" cy="-14" r="1.2" className="fill-sage-500/60 stroke-none" />
        <path d="M2-12 9-22" className="stroke-noir-soft/70" />
        <ellipse cx="9.8" cy="-23" rx="1.6" ry="1.1" className="fill-paper-card stroke-noir-soft/70" />
      </g> : <g>
        <path d="M-12-12a12 9 0 0 1 24 0z" className="fill-gold-light stroke-gold" />
        <path d="M-1.6-21h3.2" className="stroke-gold" />
      </g>}
      <path d="M-12-12h24v6h-24z" className="fill-gold-light stroke-gold" />
    </g>
  );
}

/** 각자 고르는 뷔페 — 긴 테이블 위의 접시 더미, 데우는 그릇 셋, 층층이 담은 디저트. */
function BuffetScene() {
  return (
    <Scene ground="fill-ivory-100">
      <path d="M0 84H160V100H0z" className="fill-ivory-200 stroke-none" />
      <path d="M10 54h140v30H10z" className="fill-paper-card stroke-paper-divider" />
      <path d="M10 58q10 6 20 0t20 0 20 0 20 0 20 0 20 0 20 0" className="stroke-paper-divider" />
      <path d="M30 64v20M70 64v20M110 64v20M150 64v20" className="stroke-paper-divider/70" />
      <rect x="15" y="45" width="14" height="9" rx="1" className="fill-paper-card stroke-noir-soft/50" />
      <path d="M15 48h14M15 51h14" className="stroke-noir-soft/40" />
      <ChafingDish x={48} />
      <ChafingDish x={80} open />
      <ChafingDish x={112} />
      <path d="M140 54V30M130 54h20" className="stroke-gold" />
      <path d="M131 44h18M134 34h12" className="stroke-gold" />
      <circle cx="135" cy="42" r="1.6" className="fill-rose-light stroke-rose-500/70" />
      <circle cx="140" cy="41.6" r="1.6" className="fill-sage-pale stroke-sage-500" />
      <circle cx="145" cy="42" r="1.6" className="fill-rose-light stroke-rose-500/70" />
      <circle cx="137.6" cy="32" r="1.5" className="fill-gold-light stroke-gold" />
      <circle cx="142.4" cy="32" r="1.5" className="fill-rose-pale stroke-rose-500/70" />
    </Scene>
  );
}

/** 순서대로 나오는 식사 — 위에서 본 한 사람의 자리. 위쪽에 접시 셋이 화살표로 차례를 잇는다. */
function CourseScene() {
  return (
    <Scene ground="fill-ivory-50">
      <rect x="38" y="36" width="84" height="48" rx="6" className="fill-gold-light/50 stroke-none" />
      <circle cx="56" cy="21" r="5.5" className="fill-paper-card stroke-noir-soft/50" />
      <circle cx="56" cy="21" r="3" className="fill-sage-pale stroke-none" />
      <circle cx="80" cy="21" r="5.5" className="fill-paper-card stroke-noir-soft/50" />
      <circle cx="80" cy="21" r="2.6" className="fill-rose-light stroke-rose-500/70" />
      <circle cx="104" cy="21" r="5.5" className="fill-paper-card stroke-noir-soft/50" />
      <path d="M101.6 23.2 104 18l2.4 5.2z" className="fill-gold-light stroke-gold" />
      <path d="M64.5 21h7M69.5 18.8l2.2 2.2-2.2 2.2M88.5 21h7M93.5 18.8l2.2 2.2-2.2 2.2" className="stroke-noir-soft/50" />
      <circle cx="80" cy="60" r="17" className="fill-paper-card stroke-noir-soft/50" />
      <circle cx="80" cy="60" r="12" className="stroke-paper-divider" />
      <circle cx="80" cy="60" r="5" className="fill-rose-light stroke-rose-500/70" />
      <Leaf x={82} y={56} angle={-40} className="fill-sage-500/45 stroke-sage-500" />
      <Leaf x={78} y={56} angle={-140} className="fill-sage-500/45 stroke-sage-500" />
      <path d="M54 52v24M52 44v8M54 44v8M56 44v8M52 52q2 3 4 0" className="stroke-noir-soft/70" />
      <path d="M106 76V52" className="stroke-noir-soft/70" />
      <path d="M106 52v-9q3.4 2 3.4 9z" className="fill-paper-card stroke-noir-soft/70" />
      <circle cx="116" cy="42" r="4.6" className="fill-rose-light/40 stroke-noir-soft/50" />
    </Scene>
  );
}

/** 한 상을 함께 나누는 식사 — 위에서 본 둥근 상. 가운데 냄비와 반찬, 둘레에 여러 사람의 밥그릇과 수저. */
function SharedTableScene() {
  const dishes: [number, number, string][] = [[106, 63.5, "fill-sage-500/60"], [80, 71, "fill-rose-light"], [54, 63.5, "fill-gold"], [54, 48.5, "fill-rose-500/70"], [106, 48.5, "fill-sage-500/60"]];
  const settings: [number, number][] = [[128, 56], [104, 76.8], [56, 76.8], [32, 56], [56, 35.2], [104, 35.2]];
  return (
    <Scene ground="fill-ivory-100">
      <path d="M20 56a60 30 0 0 0 120 0v3a60 30 0 0 1-120 0z" className="fill-paper-stem/50 stroke-paper-stem" />
      <ellipse cx="80" cy="56" rx="60" ry="30" className="fill-paper-stem/20 stroke-paper-stem" />
      {dishes.map(([dx, dy, tone]) => (
        <g key={`${dx}-${dy}`}>
          <ellipse cx={dx} cy={dy} rx="5" ry="3" className="fill-paper-card stroke-noir-soft/40" />
          <ellipse cx={dx} cy={dy - 0.4} rx="3.2" ry="1.7" className={`${tone} stroke-none`} />
        </g>
      ))}
      {settings.map(([sx, sy]) => (
        <g key={`${sx}-${sy}`}>
          <circle cx={sx} cy={sy} r="3.4" className="fill-paper-card stroke-noir-soft/60" />
          <circle cx={sx} cy={sy} r="1.8" className="fill-ivory-50 stroke-paper-divider" />
          <path d={`M${sx + 5.2} ${sy - 4}v8M${sx + 6.8} ${sy - 4}v8`} className="stroke-noir-soft/60" />
        </g>
      ))}
      <ellipse cx="80" cy="56" rx="13" ry="7" className="fill-noir-soft/70 stroke-noir-soft" />
      <ellipse cx="80" cy="54.6" rx="10" ry="4.6" className="fill-rose-light stroke-none" />
      <circle cx="77" cy="54" r="1.2" className="fill-sage-500/70 stroke-none" />
      <circle cx="83" cy="55.4" r="1.2" className="fill-paper-card stroke-none" />
      <path d="M66 55h-2M94 55h2" className="stroke-noir-soft" />
      <path d="M76 47q-2-3 0-5.5t0-5.5M84 47q-2-3 0-5.5t0-5.5" className="stroke-paper-outline/60" />
    </Scene>
  );
}

/** 초시계. 원점은 문자판 가운데, 반지름 14. 채운 부채꼴이 짧은 시간이다. */
function Stopwatch({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M-2.5-18h5v3h-5zM0-15v1" className="fill-noir-soft/70 stroke-noir-soft/70" />
      <path d="M9.6-11.4l2.2-2.2" className="stroke-noir-soft/70" />
      <circle r="14" className="fill-paper-card stroke-noir-soft/70" />
      <path d="M0 0V-11A11 11 0 0 1 9.5-5.5z" className="fill-gold-light stroke-none" />
      <path d="M0-11v2M11 0H9M0 11V9M-11 0h2" className="stroke-noir-soft/50" />
      <path d="M0 0 9.5-5.5M0 0V-11" className="stroke-noir-soft" />
      <circle r="1.2" className="fill-noir-soft stroke-none" />
    </g>
  );
}

/** 핵심 순서로 짧게 — 가는 아치 하나, 짧은 통로, 작은 부채꼴만 채운 초시계. */
function ShortCeremonyScene() {
  return (
    <Scene ground="fill-paper-sheet">
      <path d="M0 80H160" className="stroke-paper-divider" />
      <path d="M52 80h24l6 12H46z" className="fill-rose-pale stroke-none" />
      <path d="M50 80V46a14 14 0 0 1 28 0v34z" className="fill-paper-tint stroke-none" />
      <path d="M50 80V46a14 14 0 0 1 28 0v34" className="stroke-gold" />
      <Leaf x={46} y={40} angle={-60} className="fill-sage-500/40 stroke-sage-500" />
      <Leaf x={49} y={36} angle={-150} className="fill-sage-500/40 stroke-sage-500" />
      <circle cx="51" cy="38" r="2.6" className="fill-rose-light stroke-rose-500" />
      <Stopwatch x={114} y={50} />
    </Scene>
  );
}

/** 말풍선 — 타원 하나에 꼬리를 이은 한 획. 꼬리 끝은 `tail` 좌표다. `children` 이 안의 표시를 그린다. */
function Bubble({ x, y, rx, ry, tail, children }: { x: number; y: number; rx: number; ry: number; tail: [number, number]; children: ReactNode }) {
  const [tx, ty] = tail;
  const side = tx < x ? -1 : 1;
  const start = `${round(x + side * rx * 0.5)} ${round(y + ry * 0.866)}`;
  const end = `${round(x + side * rx * 0.906)} ${round(y + ry * 0.423)}`;
  return (
    <g>
      <path d={`M${start}A${rx} ${ry} 0 1 ${side > 0 ? 1 : 0} ${end}L${tx} ${ty}z`} className="fill-paper-card stroke-noir-soft/60" />
      {children}
    </g>
  );
}

/** 하트 하나. 원점은 가운데. */
function Heart({ x, y, s = 1, className }: { x: number; y: number; s?: number; className: string }) {
  return <path d="M0 3C-4 .4-4.8-1.6-3.8-3.2-2.8-4.8-.8-4.4 0-2.8.8-4.4 2.8-4.8 3.8-3.2 4.8-1.6 4 .4 0 3z" transform={`translate(${x} ${y}) scale(${s})`} className={className} />;
}

/** 둘의 이야기와 인사 중심 — 추억 사진을 매단 줄, 앞에 선 두 사람, 두 사람이 건네는 말풍선. */
function OurStoryScene() {
  const frames: [number, number, string][] = [[30, 23.9, "fill-sage-pale"], [58, 27.2, "fill-rose-pale"], [102, 27.2, "fill-gold-light"], [130, 23.9, "fill-sage-pale"]];
  return (
    <Scene ground="fill-paper-tint">
      <path d="M0 80H160V100H0z" className="fill-ivory-200 stroke-none" />
      <path d="M10 20Q80 36 150 20" className="stroke-paper-stem" />
      {frames.map(([fx, fy, tone]) => (
        <g key={fx} transform={`translate(${fx} ${fy})`}>
          <path d="M-6 1h12v11H-6z" className="fill-paper-card stroke-paper-outline/70" />
          <path d="M-4.5 2.5h9v8h-9z" className={`${tone} stroke-none`} />
          {tone === "fill-sage-pale" ? <path d="M-4.5 10.5l3-3.4 2 2 2.4-3 2.6 4.4z" className="fill-sage-500/50 stroke-none" /> : null}
          <path d="M-1 -1h2v3h-2z" className="fill-paper-tape stroke-none" />
        </g>
      ))}
      <Heart x={58} y={33} s={0.6} className="fill-rose-500/80 stroke-none" />
      <Couple x={80} y={84} s={1.35} />
      <Bubble x={46} y={54} rx={10} ry={7} tail={[61, 63]}>
        <circle cx="42" cy="54" r="1.1" className="fill-noir-soft/60 stroke-none" />
        <circle cx="46" cy="54" r="1.1" className="fill-noir-soft/60 stroke-none" />
        <circle cx="50" cy="54" r="1.1" className="fill-noir-soft/60 stroke-none" />
      </Bubble>
      <Bubble x={116} y={52} rx={11} ry={8} tail={[100, 62]}>
        <Heart x={116} y={52.6} s={1.1} className="fill-rose-500/80 stroke-rose-500" />
      </Bubble>
    </Scene>
  );
}

/** 음표 하나. 원점은 머리 가운데. */
function Note({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse rx="2.4" ry="1.7" transform="rotate(-20)" className="fill-noir-soft/70 stroke-noir-soft/70" />
      <path d="M2.2-.6V-10q3 1.4 3.6 4.8" className="stroke-noir-soft/70" />
    </g>
  );
}

/** 참여·공연이 있는 진행 — 조명 아래 마이크, 떠오르는 음표, 손을 든 하객들의 뒷모습. */
function ParticipatoryScene() {
  const confetti: [number, number, string][] = [[22, 22, "stroke-rose-500"], [34, 36, "stroke-gold"], [128, 20, "stroke-sage-500"], [140, 34, "stroke-rose-500"], [112, 40, "stroke-gold"], [50, 18, "stroke-sage-500"]];
  const crowd: [number, string][] = [[24, "fill-rose-light"], [48, "fill-sage-pale"], [72, "fill-gold-light"], [96, "fill-rose-pale"], [120, "fill-sage-pale"], [144, "fill-rose-light"]];
  return (
    <Scene ground="fill-ivory-100">
      <path d="M0 64H160V100H0z" className="fill-ivory-200 stroke-none" />
      <path d="M44 12 30 64h36zM116 12l-14 52h36z" className="fill-paper-tape/50 stroke-none" />
      <path d="M40 12h8M112 12h8" className="stroke-noir-soft/60" />
      {confetti.map(([cx, cy, tone]) => <path key={cx} d={`M${cx} ${cy}l2.4 1.6`} className={tone} />)}
      <path d="M48 64h12M54 64V38" className="stroke-noir-soft" />
      <rect x="52" y="30" width="4" height="8" rx="2" className="fill-noir-soft/80 stroke-noir-soft" />
      <Note x={70} y={40} />
      <Note x={84} y={30} />
      <Note x={98} y={42} />
      <rect x="118" y="44" width="12" height="20" rx="1" className="fill-noir-soft/70 stroke-noir-soft" />
      <circle cx="124" cy="49.6" r="2" className="fill-ivory-200 stroke-none" />
      <circle cx="124" cy="57.6" r="3.2" className="fill-ivory-200 stroke-none" />
      {crowd.map(([gx, tone], index) => (
        <g key={gx} transform={`translate(${gx} 76)`}>
          <path d="M-7 12q0-8 7-8t7 8z" className={`${tone} stroke-noir-soft/40`} />
          <circle r="4" className="fill-noir-soft/70 stroke-none" />
          {index % 2 === 0 ? <path d="M5 7l3-12" className="stroke-noir-soft/60" /> : <path d="M-5 7l-3-12" className="stroke-noir-soft/60" />}
          <circle cx={index % 2 === 0 ? 8.4 : -8.4} cy="-6" r="1.4" className="fill-ivory-200 stroke-noir-soft/60" />
        </g>
      ))}
    </Scene>
  );
}

/** 나무 기러기 한 마리. 원점은 발 가운데, `flip` 이면 왼쪽을 본다. */
function WoodenDuck({ x, y, flip = false }: { x: number; y: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -0.9 : 0.9} 0.9)`}>
      <path d="M-5.6-.2Q-6.4-5-1-5.4-.2-7.2.8-8.4 2.2-10 4-9.2 5.6-8.4 4.6-6.6L6.8-6 4.4-5.4Q3.6-3.4 5.2-2 4.2 0-5.6-.2z" className="fill-paper-stem/60 stroke-paper-stem" />
      <circle cx="2.8" cy="-8" r=".5" className="fill-noir-soft stroke-none" />
      <path d="M-4-2.4q3-1.4 6 0" className="stroke-paper-stem" />
    </g>
  );
}

/** 촛대 한 쌍 중 하나. 원점은 상 위 바닥. */
function TallCandle({ x, candle }: { x: number; candle: string }) {
  return (
    <g transform={`translate(${x} 62)`}>
      <path d="M-4 0h8M0 0v-16M-3-16h6" className="stroke-gold" />
      <path d="M-1.5-27h3v11h-3z" className={`${candle} stroke-none`} />
      <path d="M0-28.4c-1.2-1.4-1-3 0-4.6 1 1.6 1.2 3.2 0 4.6z" className="fill-gold stroke-none" />
    </g>
  );
}

/** 솔가지·대나무를 꽂은 화병. 원점은 상 위 바닥. */
function BranchVase({ x }: { x: number }) {
  return (
    <g transform={`translate(${x} 62)`}>
      <path d="M0-7q-2-7-6-11M0-7q1-8 4-12M0-7v-9" className="stroke-sage-500" />
      <Leaf x={-6} y={-18} angle={-150} className="fill-sage-500/45 stroke-sage-500" />
      <Leaf x={4} y={-19} angle={-40} className="fill-sage-500/45 stroke-sage-500" />
      <Leaf x={0} y={-16} angle={-90} className="fill-sage-500/45 stroke-sage-500" />
      <path d="M-3 0q-1.4-4 .6-7h4.8q2 3 .6 7z" className="fill-paper-card stroke-noir-soft/60" />
    </g>
  );
}

/** 전통 절차를 포함한 진행 — 병풍 앞 초례상. 청홍 보자기, 붉고 푸른 초, 솔가지 화병, 마주 본 나무 기러기. */
function TraditionalCeremonyScene() {
  const panels = [22, 41.5, 61, 80.5, 100, 119.5];
  return (
    <Scene ground="fill-ivory-100">
      <path d="M0 76H160V100H0z" className="fill-ivory-200 stroke-none" />
      {panels.map((px, index) => <path key={px} d={`M${px} 16h18.5v56H${px}z`} className={`${index % 2 ? "fill-ivory-50" : "fill-paper-card"} stroke-paper-stem`} />)}
      <path d="M24 52l8-8 6 5 8-10 9 9 7-5 10 9 8-8 9 7 8-6 9 8 9-10 8 8 6-4 8 6" className="stroke-sage-500/40" />
      <circle cx="129" cy="28" r="4" className="fill-rose-light/70 stroke-none" />
      <path d="M36 62h88l-2 4H38z" className="fill-paper-stem/60 stroke-paper-stem" />
      <path d="M40 66v14M120 66v14" className="stroke-paper-stem" />
      <path d="M42 66h38v12H45z" className="fill-rose-light stroke-rose-500/70" />
      <path d="M80 66h38l-3 12H80z" className="fill-noir-soft/30 stroke-noir-soft/60" />
      <TallCandle x={48} candle="fill-rose-500" />
      <TallCandle x={112} candle="fill-noir-soft" />
      <BranchVase x={64} />
      <BranchVase x={96} />
      <WoodenDuck x={73} y={62} />
      <WoodenDuck x={87} y={62} flip />
    </Scene>
  );
}

/** 하객 한 줄(뒷모습). `row` 가 클수록 앞줄이라 머리가 크고 간격이 넓다. 가운데 통로는 비운다. 맨 앞줄은 칸 밖까지 이어진다. */
function GuestRow({ row }: { row: number }) {
  const y = 54 + row * 7.5;
  const r = 2.1 + row * 0.35;
  const gap = 7 + row * 1.1;
  const aisle = 8 + row * 2;
  const tones = ["fill-rose-light", "fill-sage-pale", "fill-gold-light", "fill-ivory-50"];
  const seats: { x: number; tone: string }[] = [];
  for (const side of [-1, 1]) {
    for (let index = 0; index < 3 + row; index++) {
      seats.push({ x: round(80 + side * (aisle + index * gap)), tone: tones[(index + row + (side > 0 ? 2 : 0)) % tones.length] });
    }
  }
  const w = round(r * 1.7);
  const h = round(r * 2.2);
  return (
    <g>
      {seats.map(({ x, tone }) => (
        <g key={x}>
          <path d={`M${round(x - w)} ${round(y + r * 2.4)}q0-${h} ${w}-${h}q${w} 0 ${w} ${h}z`} className={`${tone} stroke-noir-soft/40`} />
          <circle cx={x} cy={y} r={round(r)} className="fill-noir-soft/70 stroke-none" />
        </g>
      ))}
    </g>
  );
}

/** 하객 규모 그림의 공통 틀 — 안쪽 아치 아래 두 사람, 앞으로 뻗은 통로, `rows` 줄의 하객. */
function GuestScene({ rows }: { rows: number }) {
  const petals: [number, number, number][] = [[74, 62, 30], [86, 68, -30], [76, 76, 150], [85, 82, 60]];
  return (
    <Scene ground="fill-ivory-100">
      <path d="M0 51H160V100H0z" className="fill-ivory-200 stroke-none" />
      <path d="M77 51h6l8 49H69z" className="fill-rose-pale stroke-none" />
      <path d="M69 51V36a11 11 0 0 1 22 0v15" className="fill-paper-card/70 stroke-gold" />
      <circle cx="70" cy="30" r="2" className="fill-rose-light stroke-rose-500" />
      <Leaf x={72} y={27} angle={-40} className="fill-sage-500/40 stroke-sage-500" />
      <Couple x={80} y={51} s={0.62} />
      {rows === 0 ? <>
        <Heart x={80} y={17} s={0.9} className="fill-rose-500/80 stroke-rose-500" />
        {petals.map(([px, py, angle]) => <Leaf key={px} x={px} y={py} angle={angle} className="fill-rose-light stroke-rose-500/60" />)}
      </> : Array.from({ length: rows }, (_, row) => <GuestRow key={row} row={row} />)}
    </Scene>
  );
}

const NoGuestsScene = () => <GuestScene rows={0} />;
const Under50Scene = () => <GuestScene rows={1} />;
const From50Scene = () => <GuestScene rows={2} />;
const From100Scene = () => <GuestScene rows={3} />;
const From200Scene = () => <GuestScene rows={4} />;
const Over300Scene = () => <GuestScene rows={5} />;

/** 주제: 장소 — 낮은 박공의 넓은 건물(아치형 문·창), 그 위의 장소 표시 핀, 양옆의 나무. */
function VenueTopicScene() {
  return (
    <Scene ground="fill-paper-tint">
      <path d="M0 78c40-5 110-5 160 0v22H0z" className="fill-sage-pale stroke-none" />
      <path d="M73 78h14l10 22H63z" className="fill-ivory-200 stroke-none" />
      <path d="M42 78V46h76v32z" className="fill-ivory-50 stroke-noir-soft/60" />
      <path d="M40 46 80 32l40 14z" className="fill-rose-pale stroke-rose-500/70" />
      <path d="M40 49.5h80" className="stroke-noir-soft/40" />
      <path d="M73 78V67a7 7 0 0 1 14 0v11z" className="fill-paper-card stroke-noir-soft/60" />
      <path d="M80 60v18" className="stroke-noir-soft/40" />
      <path d="M48 66V58a3 3 0 0 1 6 0v8zM59 66V58a3 3 0 0 1 6 0v8zM95 66V58a3 3 0 0 1 6 0v8zM106 66V58a3 3 0 0 1 6 0v8z" className="fill-paper-tape/60 stroke-noir-soft/60" />
      <path d="M80 31c-4-5-6-8-6-11a6 6 0 0 1 12 0c0 3-2 6-6 11z" className="fill-rose-500/80 stroke-rose-500" />
      <circle cx="80" cy="20" r="2.2" className="fill-paper-card stroke-none" />
      <path d="M22 78V64M138 78V64" className="stroke-paper-stem" />
      <path d="M13 58c-3-8 3-15 10-12 5-4 12 2 10 8 3 6-4 11-10 8-5 3-11 1-10-4zM129 58c-3-8 3-15 10-12 5-4 12 2 10 8 3 6-4 11-10 8-5 3-11 1-10-4z" className="fill-sage-500/30 stroke-sage-500" />
    </Scene>
  );
}

/** 주제: 사진 — 렌즈가 큰 카메라 한 대와 뒤에 기댄 인화 사진. */
function PhotoTopicScene() {
  return (
    <Scene ground="fill-ivory-100">
      <g transform="translate(34 50) rotate(-10)">
        <path d="M-12-14h24v30h-24z" className="fill-paper-card stroke-paper-outline/70" />
        <path d="M-9.5-11.5h19v18h-19z" className="fill-sage-pale stroke-none" />
        <circle cx="4" cy="-6" r="2.4" className="fill-paper-tape stroke-none" />
      </g>
      <path d="M58 38v-4h14v4" className="fill-noir-soft stroke-noir-soft" />
      <rect x="50" y="38" width="60" height="38" rx="5" className="fill-noir-soft/80 stroke-noir-soft" />
      <path d="M50 46h60M50 68h60" className="stroke-ivory-50/30" />
      <rect x="95" y="34.5" width="8" height="3.5" rx="1" className="fill-gold stroke-none" />
      <rect x="98" y="41" width="7" height="3" className="fill-paper-tape stroke-none" />
      <circle cx="80" cy="57" r="14" className="fill-ivory-50 stroke-noir-soft" />
      <circle cx="80" cy="57" r="9.5" className="fill-noir-soft stroke-none" />
      <circle cx="80" cy="57" r="4.6" className="fill-sage-500/60 stroke-none" />
      <path d="M75 52.6q2-2 4.4-2.4" className="stroke-ivory-50" />
      <path d="M116 30l4-4M118 36h6M116 42l4 3" className="stroke-gold" />
    </Scene>
  );
}

/** 옷걸이에 건 드레스·재킷. 원점은 봉 위 고리. */
function HangerHook() {
  return <path d="M0 6V3.2a2.6 2.6 0 1 1 2.6-2.6M0 6-11 11H11z" className="stroke-paper-stem" />;
}

/** 주제: 입을 옷 — 봉에 나란히 건 드레스와 재킷, 아래 구두 한 켤레. */
function AttireTopicScene() {
  return (
    <Scene ground="fill-paper-sheet">
      <path d="M0 86H160" className="stroke-paper-divider" />
      <path d="M22 22h116M24 22v64M136 22v64M17 86h14M129 86h14" className="stroke-paper-stem" />
      <g transform="translate(62 22)">
        <HangerHook />
        <path d="M-7 10Q0 13 7 10l-1.5 14L8 30l4.4 28h-24.8L-8 30l2.5-6z" className="fill-paper-card stroke-noir-soft/70" />
        <path d="M-5.5 24h11M-2 30q-3 14-5 27M2 30q3 14 5 27" className="stroke-paper-divider" />
      </g>
      <g transform="translate(100 22)">
        <HangerHook />
        <path d="M-2.6 7Q-8 7.6-10.8 10.6L-11.4 42H11.4L10.8 10.6Q8 7.6 2.6 7L0 18z" className="fill-noir-soft/85 stroke-noir-soft" />
        <path d="M-2.6 7 0 18l2.6-11z" className="fill-paper-card stroke-noir-soft/50" />
        <path d="M0 18v24M-2.6 7l-2 10 3.4 2M2.6 7l2 10-3.4 2M-9.6 14l-.4 26M9.6 14l.4 26" className="stroke-ivory-50/70" />
        <circle cx="0" cy="28" r=".9" className="fill-ivory-50 stroke-none" />
      </g>
      <path d="M90 86v-3.6q0-1.6 1.6-1.6h3.6q3.2 0 5.2 2.6l2 2.6zM104 86v-3.6q0-1.6 1.6-1.6h3.6q3.2 0 5.2 2.6l2 2.6z" className="fill-noir-soft/80 stroke-noir-soft" />
    </Scene>
  );
}

/** 주제: 식사 — 둥근 덮개를 씌운 접시, 양옆의 포크와 나이프, 와인잔. */
function MealTopicScene() {
  return (
    <Scene ground="fill-ivory-blush">
      <path d="M0 72H160V100H0z" className="fill-paper-card stroke-none" />
      <path d="M0 72H160" className="stroke-paper-divider" />
      <path d="M58 70a22 20 0 0 1 44 0z" className="fill-gold-light stroke-gold" />
      <circle cx="80" cy="47.6" r="2.4" className="fill-gold stroke-gold" />
      <path d="M65 63q2-8 9-12" className="stroke-paper-card" />
      <ellipse cx="80" cy="71" rx="27" ry="4.6" className="fill-paper-card stroke-noir-soft/50" />
      <path d="M42 84V62M40 54v8M42 54v8M44 54v8M40 62q2 2.6 4 0" className="stroke-noir-soft/70" />
      <path d="M118 84V64" className="stroke-noir-soft/70" />
      <path d="M118 64V51q3.6 2 3.6 10l-3.6 3z" className="fill-paper-card stroke-noir-soft/70" />
      <path d="M131 42h10q0 11-5 13-5-2-5-13z" className="fill-rose-light/60 stroke-noir-soft/50" />
      <path d="M136 55v14M132 69h8" className="stroke-noir-soft/50" />
      <Sparkle x={62} y={36} s={0.8} />
      <Sparkle x={100} y={30} s={0.6} />
    </Scene>
  );
}

/** 앞에서 본 사람 상반신. 원점은 어깨 아래 가운데. 얼굴은 그리지 않는다. */
function Bust({ x, y, s, tone }: { x: number; y: number; s: number; tone: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-9 0q0-10 9-10t9 10z" className={`${tone} stroke-noir-soft/50`} />
      <circle cy="-15" r="5" className="fill-ivory-200 stroke-noir-soft/60" />
      <path d="M-5-15a5 5 0 0 1 10 0q-5-2.6-10 0z" className="fill-noir-soft/70 stroke-none" />
    </g>
  );
}

/** 주제: 하객 규모 — 삼각 깃발 줄 아래 두 줄로 모인 사람들. */
function GuestsTopicScene() {
  const flags = [18, 36, 54, 72, 90, 108, 126, 144];
  const tones = ["fill-rose-light", "fill-sage-pale", "fill-gold-light"];
  return (
    <Scene ground="fill-paper-tint">
      <path d="M8 16Q80 34 152 16" className="stroke-paper-stem" />
      {flags.map((fx, index) => {
        const fy = round(16 + 18 * (1 - ((fx - 80) / 72) ** 2) * 0.5);
        return <path key={fx} d={`M${fx - 4} ${fy}h8l-4 7z`} className={`${tones[index % tones.length]} stroke-none`} />;
      })}
      <path d="M0 84H160V100H0z" className="fill-ivory-200 stroke-none" />
      <Bust x={44} y={62} s={1} tone="fill-sage-pale" />
      <Bust x={68} y={62} s={1} tone="fill-gold-light" />
      <Bust x={92} y={62} s={1} tone="fill-rose-pale" />
      <Bust x={116} y={62} s={1} tone="fill-sage-pale" />
      <Bust x={56} y={84} s={1.25} tone="fill-rose-light" />
      <Bust x={80} y={84} s={1.25} tone="fill-ivory-50" />
      <Bust x={104} y={84} s={1.25} tone="fill-gold-light" />
    </Scene>
  );
}

/** 옆에서 본 의자 하나. 원점은 바닥, `flip` 이면 등받이가 오른쪽. */
function Chair({ x, flip = false }: { x: number; flip?: boolean }) {
  return <path d="M0 0V-12M0-5H7V0" transform={`translate(${x} 88) scale(${flip ? -1 : 1} 1)`} className="stroke-paper-stem" />;
}

/** 주제: 식순과 연출 — 꽃을 얹은 아치, 앞으로 뻗은 통로, 양옆의 촛대와 의자. */
function CeremonyTopicScene() {
  return (
    <Scene ground="fill-ivory-100">
      <path d="M0 72H160V100H0z" className="fill-ivory-200 stroke-none" />
      <path d="M72 72h16l18 28H54z" className="fill-rose-pale stroke-none" />
      <path d="M60 72V40a20 20 0 0 1 40 0v32" className="fill-paper-card/70 stroke-gold" />
      <Bouquet x={68} y={28} />
      <Bouquet x={98} y={52} flip />
      <Candle x={36} />
      <Candle x={124} />
      <Chair x={30} />
      <Chair x={46} />
      <Chair x={114} flip />
      <Chair x={130} flip />
    </Scene>
  );
}

type MoodValue = (typeof TASTE_MOOD_OPTIONS)[number]["value"];
type DetailValue<D extends TasteDomain> = (typeof TASTE_DOMAIN_QUESTIONS)[D]["options"][number]["value"];
type VenueValue = DetailValue<"venue">;

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

export const PHOTO_SCENES: Record<DetailValue<"photo">, () => ReactNode> = {
  candid: CandidScene,
  directed: DirectedScene,
  both_styles: BothStylesScene,
};

export const ATTIRE_SCENES: Record<DetailValue<"attire">, () => ReactNode> = {
  simple: SimpleAttireScene,
  flowing: FlowingAttireScene,
  decorative: DecorativeAttireScene,
  traditional: TraditionalAttireScene,
};

export const MEAL_SCENES: Record<DetailValue<"meal">, () => ReactNode> = {
  buffet: BuffetScene,
  course: CourseScene,
  shared_table: SharedTableScene,
};

export const CEREMONY_SCENES: Record<DetailValue<"ceremony">, () => ReactNode> = {
  short: ShortCeremonyScene,
  our_story: OurStoryScene,
  participatory: ParticipatoryScene,
  traditional: TraditionalCeremonyScene,
};

/** 하객 규모 — 줄 수가 규모를 말한다(없음 0줄, 50명 미만 1줄 … 300명 이상 5줄). 숫자는 라벨이 맡는다. */
export const GUEST_SCENES: Record<DetailValue<"guests">, () => ReactNode> = {
  no_guests: NoGuestsScene,
  under50: Under50Scene,
  "50to100": From50Scene,
  "100to200": From100Scene,
  "200to300": From200Scene,
  over300: Over300Scene,
};

/**
 * 세부 질문마다 그림을 고른다. 주제가 늘면 그림 묶음이 빠진 채로는 컴파일되지 않는다.
 * 값의 목록은 공유 상수(`TASTE_DOMAIN_QUESTIONS`)가 정본이다.
 */
export const DETAIL_SCENES: { [D in TasteDomain]: Record<DetailValue<D>, () => ReactNode> } = {
  venue: VENUE_SCENES,
  photo: PHOTO_SCENES,
  attire: ATTIRE_SCENES,
  meal: MEAL_SCENES,
  guests: GUEST_SCENES,
  ceremony: CEREMONY_SCENES,
};

/** 첫 질문(먼저 이야기할 주제)의 그림. 세부 질문의 그림과 겹치지 않게 주제를 대표하는 사물을 그린다. */
export const PRIORITY_SCENES: Record<TasteDomain, () => ReactNode> = {
  venue: VenueTopicScene,
  photo: PhotoTopicScene,
  attire: AttireTopicScene,
  meal: MealTopicScene,
  guests: GuestsTopicScene,
  ceremony: CeremonyTopicScene,
};
