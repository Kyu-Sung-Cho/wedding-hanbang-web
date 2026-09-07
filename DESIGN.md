# Design System - Wedding Hanbang

## Product Context

- **What this is:** Wedding Hanbang is a web service where couples tell Amora about their wedding preparation and Amora connects the result to their budget, checklist, and schedule.
- **Who it is for:** Couples who do not know what to do next or are tired of keeping wedding decisions across chat, notes, calendars, and spreadsheets.
- **Product type:** Amora-led web MVP with budget, checklist, schedule, and community support.
- **Core memory:** The first impression should be "tell Amora, and our wedding preparation gets organized."

## Aesthetic Direction

- **Direction:** Quiet editorial utility.
- **Mood:** Refined, warm, and practical. The app should feel like a calm planner that knows wedding details, not a generic productivity app with wedding colors.
- **Decoration level:** Intentional. Use typography, spacing, shadow, and a few premium accents. Avoid decorative noise.
- **Mobile posture:** Daily-use cockpit. The first screen should answer "What matters today?" before showing everything else.
- **Web posture:** More editorial and explanatory. Web can carry longer copy, richer sections, and admin workflows.

## Typography

- **Checklist and manners HTML exception (2026-09-06):** The user approved the
  supplied design-pattern document, two desktop/mobile PDFs and sixteen checklist
  and manners HTML examples. `/checklist`, its category sheets, and public `/manners`
  index/detail pages use `.planning-workspace` with the same self-hosted Gowun Dodum
  and IBM Plex Sans KR families as the Amora HTML surfaces. `.planning-display`
  identifies display text; body and controls use IBM. No duplicate font assets are needed.
  The shared 220px desktop sidebar and 18px mobile gutters apply to these routes.
  Checklist detail follows the supplied desktop dialog/mobile bottom-sheet pattern.
  Its existing category IDs, item order, groups, source links and save behavior remain
  authoritative. The guide remains publicly readable and preserves every section,
  source, table alternative and caveat. Example prices, statistics, partner statuses
  and legal assertions in the mockups are not implementation facts. Other routes
  retain their existing typography. Small text and interactive boundaries keep
  readable contrast even where the reference uses paler colors.
  The HTML workspace palette and its shared component role aliases are generated
  from `packages/design-tokens/src/webCssVars.ts` and `colors.ts`; `tokens:sync`
  maintains their scoped regions in `globals.css` without changing other routes.

- **Amora HTML exception (2026-09-06):** The user also approved the supplied
  `AmoraMissions.dc.html`, `MissionsMobile.dc.html`, `AmoraDecisionBoard.dc.html`,
  `BoardMobile.dc.html` and `SaveSheetMobile.dc.html`, requesting the closest possible match.
  `/chat`, its missions/board subpages and their save confirmation sheet use self-hosted
  Gowun Dodum display text and IBM Plex Sans KR body/controls within `.amora-workspace`.
  The modified fonts have renamed families, OFL notices and full modern Hangul coverage
  for user content. Other product routes retain Paperlogy except the separately approved
  checklist and manners surfaces above. The scoped HTML palette,
  intermediate type sizes and 8–24px radii are approved for these surfaces.
  Desktop sidebar is 220px; mobile gutters are 18px and navigation respects safe areas.
  Muted small text and rose labels retain sufficient contrast. Reference counts,
  partner acknowledgements and automatic-save claims must correspond to actual data.

- **Landing HTML exception (2026-09-06):** The user supplied `Main.dc.html` and
  `LandingMobile.dc.html` as the approved replacement design. Only `/landing`
  uses Gowun Dodum 400 for display text, IBM Plex Sans KR 400–700 for body and
  controls, and the existing Gaegu 700 for the hero tape. The modified font subsets
  are self-hosted under `public/fonts/landing/`, with OFL notices and renamed font
  families. Product screens retain Paperlogy except the separately approved HTML
  surfaces above. No third-party font request is needed.
  The landing uses a 1200px desktop content width and 18px mobile gutters, with
  50px/30px hero headings, 36px/24px section headings, and 31px desktop split headings.
  The attached design's intermediate sizes (12.5, 13.5, 14.5, 16.5, 17.5, 19, 31px)
  and radii (9, 10, 11, 13, 14, 15, 18px; 4/5px for bubble tails) are allowed
  within this landing only.
  Mobile sections use 44px vertical padding; desktop sections use 92px.
  Landing surfaces use existing ivory-50 and ivory-warm; small-print contrast,
  sample disclosures, working links and privacy boundaries remain required.

- **Brand font:** Paperlogy. Use across web and mobile for display, body, UI, and numeric moments.
- **Hierarchy:** Use Paperlogy weight, size, color, and spacing for emphasis instead of mixing serif/sans/display families.
- **Numbers/display:** Paperlogy with tabular number styling where available. D-day and money totals may use larger size and heavier weight, not a separate font family.
- **Data/tables:** Paperlogy with tabular number styling where available.
- **Scale:** xs 12, sm 14, base 16, lg 18, xl 20, 2xl 24, 3xl 30, 4xl 36, 5xl 48.
- **Rule:** Text inside compact mobile UI must be scan-first. Keep the font family consistent and vary only weight/size for hierarchy.
- **Landing handwriting exception (2026-08-27):** The marketing landing (`/landing`, `/`) may use
  **Gaegu** for short handwritten accents only — section eyebrows, the wordmark, and the large
  count figures. Body text, headings, buttons, and all fine print stay Paperlogy.
  This is a deliberate exception to the "one family" rule above, scoped to the landing:
  the page is built as a wedding-preparation *notebook* (ruled cards, tape tags, pen underlines),
  and the handwriting is what makes that reading legible rather than decorative.
  Gaegu is SIL OFL and is **self-hosted** at `apps/web/public/fonts/gaegu/`
  (the site CSP is `font-src 'self' data:` — verified 2026-08-27 from the live response
  header on `/landing`; the block that does allow Google Fonts is `/sai` only —
  so a linked webfont would silently
  fall back and erase the design). Subset to the characters actually used.
  **Do not use Gaegu anywhere inside the product surfaces.**

## Color

- **Approach:** Restrained warm luxury with a quieter web/app brand match.
- **Primary eucalyptus ink:** `#36534E` and `#243832` for high-trust surfaces, main text, AI identity, and premium contrast.
- **Dusty mauve:** `#A77B74` and `#8F6662` for key actions, selected states, and human warmth. `#7D5753` is the darker step of `#8F6662`: use it for hover/pressed fills, and for small mauve text (12–14px) where `#8F6662` misses 4.5:1 on warm ivory surfaces. Never a resting fill for large surfaces.
- **Pearl ivory surfaces:** `#FBF8F2`, `#F7F1E8`, `#EFE4D7`, `#F3E9DD`, and `#F6EFE5` for backgrounds and layered panels.
- **Sage:** `#6D806E` and `#C7D1C2` for calm success, verified, and operational states.
- **Champagne taupe:** `#B89785` and `#E2D3C8` for rare highlights, not primary buttons everywhere.
- **Semantic:** success `#6D806E`, warning `#B89785`, danger `#D95F5F`, info `#36534E`.
- **Rule:** Do not turn the app into a pink app. Dusty mauve should guide attention, not paint every object.
- **Paper — 제품 전체의 표면 언어 (2026-08-27 랜딩 도입 · 2026-08-28 제품으로 확장):**
  The landing is built as a wedding-preparation notebook, and
  that needs paper and pens the brand palette does not have. Source of truth is the `paper` group in
  `packages/design-tokens/src/colors.ts`; mirrored into `globals.css` as `--color-paper-*`.
  - Paper: sheet `#FDFCF7`, tint `#F8F4EA`, card `#FFFFFF`, rule `#EDEAE0`, edge `#E2DED2`,
    divider `#DDD8C9`. `tint` is one step deeper than `sheet` and alternates section grounds —
    without it the "tinted" sections repaint the page colour and the section boundary vanishes.
  - Ink: `#26251F`, soft `#4A483F`, faint `#605E54`
  - On ink (잉크 **위에** 얹는 것 — 랜딩 끝 다크 밴드): text `#FDFCF7`, soft `#D7D4CD`,
    faint `#96938B`, rule `#4A483F`. 2026-09-03 시안 픽셀 실측값이고, faint 만 한 칸
    올렸다 — 실측 `#89897F` 는 `ink` 바탕에서 4.4:1 로 AA 미달, `#96938B` 는 5.2:1.
    rule 은 어두운 바탕의 구분선이라 대비 기준이 아니라 **보이되 튀지 않는** 값이다.
  - Pens: blue `#35638A` (links, handwritten emphasis), hover `#24465F`, red circle `#B8452F`,
    tape `#F6E7A8` on `#6C5410`, outline-button border `#8F8A7A`
    - ⚠️ outline-button border 는 **장식이 아니라 컨트롤의 경계**다. 테두리 버튼은 이 선
      하나로 "누를 수 있는 것"이 되므로 WCAG 1.4.11 의 3:1 이 적용된다. 2026-08-29 실측:
      옛 `#CFCABA` 는 sheet 1.60 / card 1.64 / tint 1.49:1 로 셋 다 미달이었고, 지금 값은
      3.36 / 3.45 / 3.13:1 이다. 밝게 되돌리려면 세 지면 모두에서 3:1 을 다시 재라.
      카드 테두리는 `edge` 다 — 둘을 바꿔 쓰지 마라.
  - Margin florals (line art): stem `#A2937F`, gypsophila `#8FA08D`
  - **Rule (2026-08-28에 바뀜):** ~~Landing surfaces only~~ → **제품 화면도 이 표면 언어를 쓴다.**
    파운더 결정으로 종이 문법이 제품 전체로 넓어졌다. 바탕·카드·선·잉크는 `paper` 에서
    나온다. 화면마다 색을 새로 정하지 말고 **역할 변수**(`--hb-*`)를 써라 — 값은
    `packages/design-tokens/src/webCssVars.ts` 한 곳이 정하고, `:root`·`service-theme`·
    `community-theme` 세 블록이 거기서 생성된다.
  - **브랜드 팔레트는 뜻을 진다.** 유칼립투스·로즈·세이지가 사라진 게 아니라 역할이
    갈렸다 — 종이가 **바탕**을, 브랜드가 **뜻**(성공·경고·위험, 여백 꽃의 온도)을 맡는다.
    둘 다 종이로 칠하면 화면에서 "성공"과 "본문"을 구분할 수 없다. 실제로 그랬다:
    `--hb-success` 가 본문과 같은 `#36534E` 였다.
  - **Rule:** 손글씨(Gaegu)는 이 확장에 포함되지 않는다. 위 Typography 절의 금지가
    그대로 살아 있다 — 예산표·일정·체크리스트처럼 훑어 읽는 화면에서 읽히지 않는다.

## Spacing

- **Base unit:** 4px, composed mostly in 8px steps.
- **Mobile density:** Comfortable but not sparse. Wedding planning is information-heavy; avoid oversized marketing spacing inside the app.
- **Common mobile spacing:** screen padding 20, card padding 16-24, section gap 16-24, row gap 8-12.
- **Rule:** Dense lists need rhythm, not more borders.

## Layout

- **Approach:** Hybrid.
- **Marketing:** Editorial composition, emotional first viewport, richer imagery.
- **App:** Grid-disciplined, bottom-tab-first, clear task hierarchy.
- **Dashboard:** Priority stack: today, D-day, progress, urgent work, shortcuts.
- **Chat:** Conversation is primary; controls stay quiet and one-handed.
- **Community:** Scan-first feed with strong trust, tags, counts, and clear write actions.
- **Border radius:** sm 6, md 8, lg 12, xl 16, 2xl 20, 3xl 28, full 9999.
- **Rule:** Cards can exist, but do not put cards inside cards. Use full sections and rows where possible.

## Motion

- **Approach:** Intentional.
- **Duration:** micro 80ms, short 160-220ms, medium 300-450ms.
- **Use motion for:** press feedback, progress reveal, step transitions, loading state clarity.
- **Avoid motion for:** decorative scroll choreography inside core app workflows.

## Mobile UI Rules

- First screen must tell the couple what needs attention today.
- Buttons use icons when the command is familiar, text when the action needs confidence.
- Empty states should suggest the next useful action.
- Error states should preserve trust and offer retry.
- Forms should reduce wedding anxiety: one decision per visible block.
- Any AI-generated recommendation must separate "AI recommendation" from verified vendor qualification.
- Any couple decision produced through AI or onboarding must be recorded in `decision_nodes`.
- Any AI call must be logged in `ai_interactions_log`.

## Safe Choices

- Pearl ivory background with white surfaces.
- Eucalyptus ink high-contrast hero moments for trust.
- Dusty mauve accent for selection and primary action.
- Bottom tabs for mobile navigation.
- Paperlogy for app readability and web/mobile brand consistency.

## Product Risks Worth Taking

- Make the app quieter than typical wedding apps. This may feel less flashy, but it builds trust for budget and vendor decisions.
- Treat AI as an operator, not a mascot. This costs some playful charm, but it makes Amora feel capable.
- Keep the dashboard task-first. This gives up a pure brand hero, but users get immediate relief.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-30 | Initial design system created | Consolidated existing Wedding Hanbang documents, design tokens, and mobile app direction into one source of truth. |
| 2026-07-02 | Aligned mobile tokens with the web eucalyptus palette | The web app had moved to Eucalyptus Ink, Dusty Mauve, and Pearl Ivory; shared mobile tokens now match that production visual direction. |
| 2026-07-02 | Standardized web and mobile typography on Paperlogy | User selected Paperlogy from Noonnu; self-hosted web WOFF2 and mobile TTF assets now provide one consistent brand font. |
| 2026-07-28 | WeddingCode 로컬 연구 프로토타입은 화면 이름·화법에서 이 문서의 마케팅 화법 예외를 받는다 | 측정 도구라 문구가 응답에 영향을 준다. 운영자 어조(해요체)는 유지하되 마스코트 화법은 계속 금지한다. 대상은 `apps/web/src/lib/weddingCode/research/**` 뿐이고 운영 표면에는 적용되지 않는다. |
| 2026-07-28 | 같은 프로토타입의 off-scale 타입 값(13·15·17·28)과 `rounded-[24px]`·`rounded-[14px]`를 잠정 유지한다 | 문항 화면의 세로 배분이 §5 가설2("다섯 답 동시 비교")에 직접 걸려 있어, 스케일 정렬이 접힘선을 움직인다. R1-UX 실기기 관찰 뒤 일괄 정렬한다. 근거·실측: `docs/wedding-code/63_today_one_line_design_plan_2026-07-28.md` §13-2·13-3. |
| 2026-07-29 | `/today`(오늘 한 마디)는 목록이 아니라 **세 장 뽑기**로 하고, 세 장은 항상 마음 2 + 돈 1로 고정한다 | 28행 목록으로 띄워보니 첫 화면 10장 중 9장이 돈·계약이라 첫인상이 청구서였다. 구성을 seed 운에 맡기면 돈만 세 장인 날이 반드시 생긴다. 실측·근거: `docs/wedding-code/63_today_one_line_design_plan_2026-07-28.md` §14. |
| 2026-07-29 | 공유 링크 원문(URL)은 결과 화면에 텍스트로 노출하지 않는다 | 주소에 카드 id가 들어 있어, 캡처를 보내는 순간 상대가 열기 전에 어느 장인지 들킨다. 주소는 복사 버튼이 들고 있는다. |
| 2026-07-30 | 웹 MVP를 아모라·예산·체크리스트·일정·커뮤니티로 제한하고 아모라를 단일 제품 중심으로 둔다 | 첫 방문자가 공시가격·업체·커뮤니티·도구를 별도 제품으로 해석하지 않도록, "아모라에게 말하면 준비가 정리된다"는 한 가지 약속 아래 실행 도구와 커뮤니티를 배치한다. |
| 2026-08-11 | 예절 가이드(읽기)와 웨딩 체크리스트(실행)를 독립 표면으로 분리한다 | 긴 예절 원고 안에 체크 상태를 섞으면 출처 정보와 실제 커플 상태가 혼동된다. 가이드는 목차·근거·모바일 표 카드에 집중하고, 체크리스트는 132개 안정 항목·검색·상태 필터·접근 가능한 체크 조작에 집중한다. 연결은 명시적 CTA로만 한다. |
| 2026-08-05 | `#7D5753`(rose-700)과 `#F3E9DD`(ivory-blush)를 정식 토큰으로 승격한다 | 랜딩이 이 두 값을 각각 9곳·7곳에서 쓰고 있었는데 `globals.css` 토큰에도 이 문서에도 없었다. 상호작용 상태 색이 시스템에 아예 없던 것이 원인이라, 지우는 대신 이름을 준다. 실측: 랜딩이 쓰는 색 11종 중 이 2종만 어느 출처에도 없었다. |
| 2026-08-05 | 그림자는 `--shadow-raised`·`--shadow-overlay` 두 단계만 쓴다 | 랜딩에 일회성 그림자 5종이 있었고, 그중 둘은 기하는 거의 같고 알파만 75% 달랐다(20/48/0.2 vs 20/50/0.35). elevation 어휘가 없으면 "얼마나 떠 있나"를 컴포넌트마다 새로 정한다. |
| 2026-08-05 | 랜딩 헤드라인은 `landingType.ts`의 3단계(hero/section/muted)만 쓴다 | 8개 섹션이 각자 clamp 곡선을 발명해 1280px에서 H1(68px)이 신뢰 h2(72px)·마무리 h2(73.6px)보다 작아지는 위계 역전이 있었다. |
| 2026-08-05 | 왼쪽 2px 규칙선은 "인용된 출처"에만 쓴다. 반영 결과는 sage로 표시한다 | 같은 `border-l-2 border-[#A77B74]`가 히어로에서는 출처(커플이 한 말), PreparationResult에서는 목적지(반영된 기록)를 뜻해 의미가 정반대였다. sage는 이 문서가 이미 "operational states"에 배정한 색이다. |
| 2026-08-05 | eyebrow 장식은 뜻을 바꿀 때만 붙이고, 붙일 때는 16px 글리프 하나로 통일한다 | eyebrow 8개에 장식이 5종(6px 점, 14px Sparkles, 32px 규칙선 ×2, 16px 체크, 48px 원형 메달리언) 섞이고 3개는 맨몸이라, 같은 층위의 라벨이 섹션마다 다른 격식으로 읽혔다. 히어로 하나에만 점과 Sparkles가 같이 붙어 있었다. 뜻을 지는 것은 둘뿐이다 — 기본이 아닌 행위자(아모라 = AI)와 릴리스 경계(운영 공개 전). 나머지는 이 문서의 "Decoration level: Intentional… Avoid decorative noise"에 어긋나므로 없앤다. 적용 후 실측: 글리프 2개 · 맨몸 6개. |
| 2026-08-05 | `inline-flex` 레시피(`primaryAction*`·`secondaryLink*`)는 `mx-auto`로 가운데 정렬하지 않는다 | inline 요소에 auto margin은 아무 일도 하지 않는다. 마무리 섹션의 CTA와 로그인 링크가 각자 `mx-auto`를 걸고 같은 line box에 앉아, 1280 실측에서 로그인 링크가 버튼 위로 겹쳤다. 가운데 정렬과 세로 쌓기는 부모 컨테이너가 맡는다. |
| 2026-08-27 | 랜딩 헤드라인 스케일의 출처가 `landingType.ts` 에서 `components/landing/redesign/notebook.tsx` 로 옮겨간다 | 랜딩을 "결혼 준비 노트" 문법으로 다시 지으면서 섹션 구성이 통째로 바뀌었다(옛 섹션 7개 삭제). 규칙 자체는 그대로다 — 단계는 셋이고 H1 이 항상 가장 크다. 위 2026-08-05 줄의 위계 역전 사고를 막는 것이 목적이고, `notebook.tsx` 의 `sectionTitle` 최대값(2.9rem)이 히어로 최대값(3.6rem)보다 작은 것이 그 장치다. |
| 2026-08-27 | 랜딩 카드의 글줄은 줄 간격(32px)에 맞춘다 | 노트 카드의 줄무늬는 32px 간격인데 본문이 `leading-[1.7]`(25.5px)이라 글이 줄 위에 안 앉고 어긋나, 줄무늬가 종이가 아니라 그냥 배경 무늬로 읽혔다. `notebook.tsx` 의 `ruled` 가 16px/32px 를 들고 있고 카드 안쪽 여백도 32의 배수다. |
| 2026-08-27 | 크기를 정하는 CSS 클래스에는 유틸리티 크기를 얹지 않는다 | `.landing-tape` 가 `font-size` 를 갖고 있는데 쓰는 쪽에서 `text-[15px]` 를 걸었더니 클래스가 이겨서 인라인 크기가 조용히 죽었다(화면은 12px 로 나왔다). 크기는 한쪽만 소유한다. |
| 2026-08-28 | 랜딩의 종이 표면 언어를 제품 전체로 넓힌다. 손글씨는 넓히지 않는다 | 파운더 지시: "모든 디자인을 이렇게 바꾸라고 일관되게 레이아웃은 다 다르겠지만 스타일은 비슷하게 이쁘게해줘". 실측된 원인은 취향이 아니라 구조였다 — 화면에 직접 박힌 색이 **514종**이고(`#243832` 534회 옆에 거의 같은 `#263832` 182회가 따로 논다), 공유 프리미티브는 `Button` 하나뿐인데 그마저 77개 화면 중 **4개**만 쓴다. 그래서 화면을 하나씩 칠하는 대신 **역할 변수의 값을 옮겼다** — `webCssVars.ts` 가 `:root`·`service-theme`·`community-theme` 세 블록을 같은 토큰에서 생성하므로, 브리지 규칙 65개가 참조하는 색이 한 번에 따라온다. 손글씨를 제외한 이유는 데이터가 빽빽한 화면에서 읽히지 않기 때문이다. |
| 2026-08-28 | `--hb-success` 를 유칼립투스에서 `sage.deep`(#637465)으로 옮기고 `sage.deep` 을 새 토큰으로 만든다 | success 가 본문과 같은 색(#36534E)이라 화면에서 "성공"과 "본문"이 구별되지 않았다. DESIGN.md 가 배정한 sage 로 되돌리되, `sage[500]`(#6D806E)은 흰 카드에서 **4.23:1** 이라 본문 크기 글자에 못 쓴다(계산으로 확인). 로즈가 `600`(4.95) 옆에 `700`(6.25)을 둔 것과 같은 구조로 어두운 단계를 만들었고, 4.98:1 로 rose-600 과 같은 대비 등급에 앉는다. |
| 2026-08-28 | 초점 링을 파란 펜(#35638A)으로 둔다 | 잉크(#26251F)와 같은 색이면 어두운 버튼 위에서 링이 사라진다. 링은 `ring-offset-2` 로 버튼에서 떨어져 **바탕 위**에 그려지므로 판정 기준은 바탕과의 대비다(6.19:1). 처음에 버튼 색과 재서 2.42 로 "미달"을 냈는데, 그 짝은 화면에 존재하지 않는다. |
