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

- **Brand font:** Paperlogy. Use across web and mobile for display, body, UI, and numeric moments.
- **Hierarchy:** Use Paperlogy weight, size, color, and spacing for emphasis instead of mixing serif/sans/display families.
- **Numbers/display:** Paperlogy with tabular number styling where available. D-day and money totals may use larger size and heavier weight, not a separate font family.
- **Data/tables:** Paperlogy with tabular number styling where available.
- **Scale:** xs 12, sm 14, base 16, lg 18, xl 20, 2xl 24, 3xl 30, 4xl 36, 5xl 48.
- **Rule:** Text inside compact mobile UI must be scan-first. Keep the font family consistent and vary only weight/size for hierarchy.

## Color

- **Approach:** Restrained warm luxury with a quieter web/app brand match.
- **Primary eucalyptus ink:** `#36534E` and `#243832` for high-trust surfaces, main text, AI identity, and premium contrast.
- **Dusty mauve:** `#A77B74` and `#8F6662` for key actions, selected states, and human warmth. `#7D5753` is the darker step of `#8F6662`: use it for hover/pressed fills, and for small mauve text (12–14px) where `#8F6662` misses 4.5:1 on warm ivory surfaces. Never a resting fill for large surfaces.
- **Pearl ivory surfaces:** `#FBF8F2`, `#F7F1E8`, `#EFE4D7`, `#F3E9DD`, and `#F6EFE5` for backgrounds and layered panels.
- **Sage:** `#6D806E` and `#C7D1C2` for calm success, verified, and operational states.
- **Champagne taupe:** `#B89785` and `#E2D3C8` for rare highlights, not primary buttons everywhere.
- **Semantic:** success `#6D806E`, warning `#B89785`, danger `#D95F5F`, info `#36534E`.
- **Rule:** Do not turn the app into a pink app. Dusty mauve should guide attention, not paint every object.

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
| 2026-08-05 | `#7D5753`(rose-700)과 `#F3E9DD`(ivory-blush)를 정식 토큰으로 승격한다 | 랜딩이 이 두 값을 각각 9곳·7곳에서 쓰고 있었는데 `globals.css` 토큰에도 이 문서에도 없었다. 상호작용 상태 색이 시스템에 아예 없던 것이 원인이라, 지우는 대신 이름을 준다. 실측: 랜딩이 쓰는 색 11종 중 이 2종만 어느 출처에도 없었다. |
| 2026-08-05 | 그림자는 `--shadow-raised`·`--shadow-overlay` 두 단계만 쓴다 | 랜딩에 일회성 그림자 5종이 있었고, 그중 둘은 기하는 거의 같고 알파만 75% 달랐다(20/48/0.2 vs 20/50/0.35). elevation 어휘가 없으면 "얼마나 떠 있나"를 컴포넌트마다 새로 정한다. |
| 2026-08-05 | 랜딩 헤드라인은 `landingType.ts`의 3단계(hero/section/muted)만 쓴다 | 8개 섹션이 각자 clamp 곡선을 발명해 1280px에서 H1(68px)이 신뢰 h2(72px)·마무리 h2(73.6px)보다 작아지는 위계 역전이 있었다. |
| 2026-08-05 | 왼쪽 2px 규칙선은 "인용된 출처"에만 쓴다. 반영 결과는 sage로 표시한다 | 같은 `border-l-2 border-[#A77B74]`가 히어로에서는 출처(커플이 한 말), PreparationResult에서는 목적지(반영된 기록)를 뜻해 의미가 정반대였다. sage는 이 문서가 이미 "operational states"에 배정한 색이다. |
