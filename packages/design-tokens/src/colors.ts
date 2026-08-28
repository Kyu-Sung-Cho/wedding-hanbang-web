// 웨딩한방 브랜드 팔레트 — 웹/앱 단일 소스
// 웹: tailwind theme / 앱: NativeWind theme 양쪽에서 import

export const colors = {
  // Primary — Eucalyptus Ink
  // 기존 코드 호환을 위해 noir 키 이름은 유지한다.
  noir: {
    900: "#243832",
    800: "#36534E",
    soft: "#4E6A62",
    charcoal: "#5E665F",
    // noir-800의 눌림·hover 단계. globals.css의 테마 블록에만 --hb-navy-soft 로
    // 있던 값을 2026-08-20에 여기로 올렸다. hover 값이 코드 안에서 4종으로
    // 갈려 있는데(#2B423E·#243832·#2d4642·#29423E) 그중 가장 많이 쓰인 것이다.
    pressed: "#2B423E",
  },

  // Accent — Dusty Mauve
  // 기존 코드 호환을 위해 rose 키 이름은 유지한다.
  rose: {
    500: "#A77B74",
    600: "#8F6662",
    // rose-600의 눌림·hover 단계. 상호작용 상태 색이 없어 랜딩이 이 값을 직접 써 왔다.
    // 웹 globals.css에만 있던 값을 2026-08-20에 여기로 올렸다.
    700: "#7D5753",
    light: "#D2B4AA",
    pale: "#EADDD8",
    glow: "rgba(167, 123, 116, 0.16)",
  },

  // Background — Pearl Ivory
  ivory: {
    50: "#FBF8F2",
    100: "#F7F1E8",
    200: "#EFE4D7",
    warm: "#F6EFE5",
    // ivory-200과 rose-pale 사이의 따뜻한 표면. 섹션 배경·칩 배경으로 쓰인다.
    // 웹 globals.css에만 있던 값을 2026-08-20에 여기로 올렸다.
    blush: "#F3E9DD",
    deep: "#E8DCCB",
  },

  // Taupe (중간톤)
  taupe: {
    400: "#B7AA9A",
    500: "#635B51",
  },

  // Sage
  sage: {
    500: "#6D806E",
    pale: "#C7D1C2",
  },

  // Champagne Taupe
  gold: {
    DEFAULT: "#B89785",
    light: "#E2D3C8",
  },

  // Platinum
  platinum: "#E6DDD2",
  surfaceLow: "#F1E8DA",
  stone: {
    900: "#263832",
  },

  // Semantic
  bg: "#FBF8F2",
  surface: "#FFFFFF",
  border: "#E5D8CA",
  textPrimary: "#263832",
  textSecondary: "#5F5B52",
  textTertiary: "#7D7166",

  // Status
  success: "#6D806E",
  warning: "#B89785",
  danger: "#D95F5F",
  // danger의 진한 단계(웹 --danger-700). `danger`를 객체로 바꾸면 모바일 59곳이
  // 한 번에 깨지므로 형제 키로 둔다.
  dangerDeep: "#9F3535",
  info: "#36534E",

  // Ad disclosure badges
  adGeneral: "#22C55E",
  adSponsored: "#EAB308",
  adAd: "#EF4444",

  // Paper — 랜딩의 "결혼 준비 노트" 표면.
  //
  // 2026-08-27에 올렸다. 랜딩을 손으로 적는 노트의 문법(줄 그은 카드·테이프·
  // 손글씨·펜 밑줄)으로 다시 짜면서, 그 문법이 요구하는 색을 브랜드 팔레트가
  // 갖고 있지 않았다. 유칼립투스-로즈 팔레트는 화면 전체의 분위기를 만들고,
  // 이 paper 그룹은 그 위에 놓이는 종이와 필기구를 만든다.
  //
  // 랜딩 밖에서 쓰지 말 것. 제품 화면은 계속 위의 브랜드 팔레트를 쓴다.
  paper: {
    // 종이
    sheet: "#FDFCF7",      // 페이지 바탕 (노트 종이)
    // 한 단계 깊은 종이. 섹션을 번갈아 칠해 경계를 만든다.
    // 처음엔 `tinted` 섹션도 sheet 를 써서 **아무 일도 안 했다** — 페이지 배경과
    // 같은 색이라 섹션 구분이 0이었고, 섹션 사이 여백이 구멍으로 읽혔다.
    tint: "#F8F4EA",
    card: "#FFFFFF",       // 줄 그은 카드
    rule: "#EDEAE0",       // 카드 안의 줄
    edge: "#E2DED2",       // 카드 테두리·구분선
    divider: "#DDD8C9",    // 목록 사이 가는 선
    // 잉크
    ink: "#26251F",        // 본문 잉크 · 어두운 버튼 바탕
    inkSoft: "#4A483F",    // 본문 보조
    inkFaint: "#605E54",   // 작은 글씨
    // 필기구
    pen: "#35638A",        // 링크 · 손글씨 강조 (파란 펜)
    penDeep: "#24465F",    // 링크 hover
    mark: "#B8452F",       // 동그라미 표시 (빨간 펜)
    tape: "#F6E7A8",       // 형광 테이프
    tapeInk: "#6C5410",    // 테이프 위 글자
    outline: "#CFCABA",    // 선 버튼 테두리
    // 여백에 그린 꽃 (라인아트)
    stem: "#A2937F",       // 줄기
    gyp: "#8FA08D",        // 안개꽃
  },
} as const;

export type BrandColor = typeof colors;
