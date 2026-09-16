# Design System - Wedding Hanbang

## Product Context

- **What this is:** Wedding Hanbang is a web service where couples tell Amora about their wedding preparation and Amora connects the result to their budget, checklist, and schedule.
- **Who it is for:** Couples who do not know what to do next or are tired of keeping wedding decisions across chat, notes, calendars, and spreadsheets.
- **Product type:** Amora-led web MVP with budget, checklist, schedule, and community support.
- **Core memory:** The first impression should be "tell Amora, and our wedding preparation gets organized."

## Aesthetic Direction

- **Feature summary hierarchy (2026-09-12):** Budget, checklist, schedule,
  lounge, guide introductions and the existing board overview use a grouped
  champagne surface with a restrained top rule, shared from `summaryPalette`
  and `featureSummaryStyles.ts`. Detail cards remain white. This was chosen
  over a separate saturated fill for each metric or a shadow-only change so
  the first summary is easier to find without making the screen busier.
  Labels use Korean and at least 12px text; major values use Pretendard 600
  and tabular numbers. Narrow screens wrap units and long amounts without
  rounding stored won amounts. Recorded spend, allocation and payment status
  remain distinct; schedule progress means checklist progress. Missing values
  and edit actions retain their meaning. Guides gain no invented progress.
  This supersedes the earlier white summaries and black lounge date tile.

- **Chat color release boundary (2026-09-13):** Amora uses a light sage
  bubble, visible sage border and dark sage text for both streamed and saved
  replies. The approved next step is groom sky / bride pink based on an
  explicitly selected role. Existing signup-order slots cannot determine
  that role. Human bubble colors remain unchanged in this UI release until
  the separate role-storage release passes its database gates.

- **누를 수 있는 면은 더스티 모브, 읽는 글자는 잉크 (2026-09-16):** 파운더가 먹빛 교체를
  물렸다. 원문: "검정처럼 어두운 색 말고 말하는거야". 잉크를 `#26251F` 에서 `#3A2A27` 로
  따뜻하게 옮긴 것만으로는 부족했다 — 새 잉크도 밝기 19% 라 큰 면에서는 여전히 검정으로
  읽혔다.

  원인은 색이 아니라 **한 토큰이 두 일을 하고 있었던 것**이다. `--hb-primary` 는 바탕으로
  300곳, 글자로 7곳에 쓰였다. 그래서 "검정을 밝게" 가 곧 "본문을 안 읽히게" 였다. 둘을 가른다.

  - **채움**(`--hb-primary` · `--hb-primary-hover` · 브리지 `--hb-navy` · 워크스페이스
    `--hb-primary`)은 `rose[600]` `#8F6662`, 눌림 `rose[700]` `#7D5753` 이다.
    색을 새로 정한 것이 아니라 아래 2026-09-11 항목의 "primary actions use rose[600],
    hover rose[700] — 이것이 예전 검정 채움을 대신한다" 를 **끝까지 적용한 것**이다.
    공용 `Button` 은 이미 `--hb-action`(=rose[600])을 써 왔고 `--hb-primary` 만
    먹색으로 남아 그 결정을 안 따르고 있었다.
  - **글자**(`--hb-text-strong` · `--amora-ink` 등)는 어두운 잉크로 남는다. 밝히면 읽히지
    않는다 — 실측 13.27:1 을 포기할 수 없다.
  - 글자로 쓰이던 7곳(ai-policy 링크 4 · VendorToolCard 2 · CommunityAmoraLauncher 1)은
    `--hb-text-strong` 으로 옮겼다. 원래 먹색 글자였으므로 **화면은 그대로**다.

  **왜 rose[600] 을 글자에 쓰지 않는가.** 실측했다 — 모브를 글자로 쓰면 따뜻한 지면에서
  무너진다: card 4.95 · sheet 4.82 · ivory 4.67 · tint 4.50 · **warm 4.33 (미달)** ·
  **blush 4.13 (미달)**. 채움으로 쓸 때 흰 글자는 4.95:1 로 통과한다. 즉 이 색은
  **채움에는 되고 글자에는 안 되는 색**이고, 그래서 역할을 갈라야 했다. `rose[700]` 은
  모든 지면에서 5.21~6.25:1 이라 글자로도 되지만, 채움 기준색은 문서가 정한 `rose[600]` 을 지켰다.

  **핑크 앱이 되지 않는가.** 바뀌는 104개 파일은 어드민 5개를 빼면 전부 버튼·칩·주요
  행동면이다. 카드·지면은 그대로 아이보리다. "모브는 주의를 이끌되 모든 물건을 칠하지
  않는다" 는 아래 규칙과 어긋나지 않는다 — 누를 수 있는 것만 칠한다.

  스크림과 실선(`--color-black` `#251A18`)은 어두운 채로 둔다. 뒤를 가리는 것이 일이라
  밝히면 기능을 잃는다. 랜딩 끝의 다크 밴드도 의도된 한 번의 어두운 마침표로 남긴다.

- **Amora mark and quiet question controls (2026-09-16):** 파운더가 리본 매듭을 물렸다.
  원문: "리본 모양인데 이상해 다른 걸로 해줘 ai 웨딩 파트너 같은 걸로". 표식은
  **맞물린 두 반지와 오른쪽 위의 작은 반짝임**이다 — 반지는 결혼을, 반짝임은 곁에서
  거드는 지능을 뜻한다. 경로는 계속 `packages/design-tokens/src/amora.ts` 한 곳에서
  웹·네이티브가 함께 쓴다. 배치 기준은 **14px 에서 읽히는가**다: 반지(r 5.3)가 박스
  대부분을 쓰고 반짝임(r 2.6)은 모서리로 물러나, 작은 크기에서 반지가 뭉치지 않는다.
  반짝임을 키우거나 가운데 얹은 시안은 14px 에서 두 고리가 한 덩어리로 읽혔다.

  같은 결정으로 **체크리스트와 예절 가이드의 아모라 버튼에서 테두리를 뺐다.**
  원문: "테두리 라인은 빼고 … 옆에 아이콘이랑 크기 다 맞추고 아모라만 커 이상해".
  그 두 화면의 형제 컨트롤(가이드 아이콘·번호 배지)은 선 없는 연한 칩이라, 테두리를
  두른 44px 아모라만 한 단계 큰 물건으로 읽혔다. 새 규칙:
  - 체크리스트 카드 — 형제 가이드 아이콘과 **같은 32px·7px 라운드·선 없는 칩**, 글리프 14px.
    이 자리는 `md` 이상에서만 보이는 마우스 대상이라 WCAG 2.5.8 의 AA 최소(24px) 위다.
  - 예절 가이드 목록 — 형제가 없으므로 손대상 44px 을 유지하고 테두리만 뺀다.
  - 예절 가이드 절 제목 — **누르는 영역은 44px 을 지키고 보이는 칩만** 옆 번호 배지와
    같은 30/34px 로 맞춘다. 크기를 맞추려고 손대상을 줄이지 않는다.
  테두리 있는 `AMORA_ACTION_CLASS`·`AMORA_ICON_ACTION_CLASS` 는 형제가 없는 자리(대화
  제안·플로팅 등)에 그대로 남는다 — 그곳에서는 테두리가 "누를 수 있는 것"의 유일한
  경계다. 아래 2026-09-12 항목의 리본·44px 일괄 규칙은 이 항목이 대신한다.

- **Amora identity and question controls (2026-09-12, 표식과 크기는 위 항목이 대신함):** The user requested a
  distinctive, memorable mark and consistent visible borders across features.
  Amora uses an original ribbon-knot outline, shared from
  `packages/design-tokens/src/amora.ts` by web and native. This replaces generic
  sparkles for Amora identity; preparation categories and other semantic icons
  retain their own symbols. Keep partner hearts and private locks distinct.
  Avatars use one ivory surface and rose outline/ink at every size. Standalone
  question controls use the same visible rose border at rest and on hover, with
  an ivory background, pale-rose hover, 12px radius, and a visible keyboard focus
  ring. Icon-only web questions are 44px square; text actions are at least 44px
  high. Navigation retains its selected-state treatment and uses the common mark
  without an extra frame; floating launchers remain circular. Do not turn inline
  prose links into large buttons or alter sending, audience, approval, or routing
  behavior for a visual change. These identity rules supersede earlier sparkle
  and hover-only question-control treatments.

- **Undecided lounge arrival (2026-09-12):** When no wedding date, preparation
  stage or wedding style has been entered, omit the first-arrival recap and
  generic next-step panels without replacement copy. The existing lounge summary,
  Amora action, setup links and partner invitation provide the starting points.
  Do not create a recap row from the absence of a date. Actual input summaries and
  stage-specific guidance remain; native retains its invitation anchor separately.

- **Preparation-to-Amora handoff (2026-09-12):** The user approved retaining only
  the editable prefilled question when entering Amora from a checklist or manners
  guide. Successful handoffs show no separate arrival or reference-information
  panels. Public source context remains attached to that unsent shared-AI draft;
  clearing the question also clears its source context. A short recovery notice
  appears only when the question cannot be inserted or its source cannot be read.
  Existing drafts, attachments, audience boundaries, explicit sending and change
  approval remain. The source catalog supplies a short question using the actual
  category, item or guide title without duplicating guide instructions.

- **Direction:** Quiet editorial utility.
- **Mood:** Refined, warm, and practical. The app should feel like a calm planner that knows wedding details, not a generic productivity app with wedding colors.
- **Decoration level:** Intentional. Use typography, spacing, shadow, and a few premium accents. Avoid decorative noise.
- **Mobile posture:** Daily-use cockpit. The first screen should answer "What matters today?" before showing everything else.
- **Web posture:** More editorial and explanatory. Web can carry longer copy, richer sections, and admin workflows.

## Typography

- **Current standard font (2026-09-12):** The user explicitly requested a standard,
  readable font throughout the web and native app. Pretendard v1.3.9 replaces
  Paperlogy, Gowun Dodum, IBM Plex Sans KR and Gaegu on every product and marketing
  surface, including landing, Amora, checklist, manners, budget, schedule and shared
  images. This supersedes the font-specific portions of all earlier HTML and
  handwriting exceptions recorded below; their layout and color decisions remain.
  Web uses the unmodified, self-hosted variable WOFF2 with an explicit 100–900
  weight range, swap display and Korean/system/emoji fallbacks. Native uses the
  bundled static faces for reliable weight selection. Keep source licenses with
  the assets. Do not load remote font stylesheets or invent a “most used” ranking.

- **Public flow consistency (2026-09-12):** Public manners reuses the five-item
  Lounge / Amora / Checklist / Schedule / Budget mobile navigation, with no false
  active item while reading a guide. Public links do not prefetch protected pages.
  The existing guide geometry and anonymous reading remain. Selected guide navigation
  follows the warm selection roles; primary landing, guide and price actions use the
  existing action tokens. Search ranks exact guide titles before title/body matches,
  retaining preparation order when no query is entered.

- **Warm interactions (2026-09-11):** The user requested warmer selected/clicked
  controls after reviewing the HTML-aligned screens. Selected navigation, filters,
  tabs and calendar dates use Dusty Mauve pale (`rose.pale`) with `rose[700]` text
  and `rose[600]` boundaries. Primary actions use `rose[600]`, darkening to
  `rose[700]` on hover. Ink remains the reading color; sage continues to indicate
  completion. This supersedes the earlier black interaction fills, while retaining
  the approved layout, fonts, mobile navigation and static ink accents. Shared
  action/selection roles are generated from `webCssVars.ts`; selection must remain
  distinct from keyboard focus and legible without relying on color alone.

- **Lounge hub and schedule HTML alignment (2026-09-11):** The user approved
  `WeddingLoungeHub.dc.html`, `WeddingLoungeHubMobile.dc.html`,
  `WeddingLoungeMobile.dc.html`, `ScheduleAlt.dc.html` and `ScheduleMobile.dc.html`
  with the same layout, color and typography scope as the checklist/budget work.
  Lounge and schedule now share the 216px planner sidebar and compact white header.
  Lounge keeps the scoped Amora fonts; schedule uses `.planning-workspace`.
  The user explicitly selected one consistent five-item mobile navigation:
  Lounge, Amora, Checklist, Schedule and Budget. Community remains reachable through
  the full menu and contextual lounge links. Contextual Amora actions and the bottom
  navigation replace the floating launcher on these screens. Small-screen headers
  retain notification access and a menu control for the remaining destinations.
  Hub-style summary cards and next actions use saved preparation, budget and schedule
  data. Reference activity logs, partner attribution and decision totals are not
  invented. Suggested preparation dates remain distinct from actual saved schedules.

- **Checklist overview and budget HTML alignment (2026-09-11):** The user approved
  `ChecklistOverview.dc.html`, `ChecklistOverviewMobile.dc.html`, `Budget.dc.html`
  and `BudgetMobile.dc.html`, including their layout, colors and font families.
  `/checklist` and `/budget` share the scoped `.planning-workspace` font assets and
  HTML palette. Their desktop sidebar is 216px, mobile gutters are 18px, and the
  compact white header includes a dark D-day pill. Both routes have mobile bottom
  navigation with the current page selected; contextual Amora links replace a
  competing floating launcher. Checklist overview groups the actual categories
  into five preparation stages. Budget uses three summary cards, recorded-spend
  distribution and responsive category rows. Counts, monetary precision, saved
  exclusions, custom items and save/error behavior continue to use live data.
  The reference's sample values and partner states are not seeded into accounts.
  Existing accessible small-text colors remain the darker steps of this palette.
  Other surfaces, including Amora and public manners, keep their existing geometry.

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
  The 2026-09-08 content alignment keeps every canonical item and guide section,
  including the rows clipped out of the mobile HTML examples. Each category,
  canonical checklist item, guide and section has a separate Amora question link;
  opening it prepares a question for review and never sends or checks an item.
  These links coexist with the checklist and related-guide controls. Saved custom
  items remain intact; they do not receive an invented public source identifier.
  Long checklist headings wrap, with the registration heading using the reference's
  16.5px mobile size. Role tabs replace the redundant audience badge in role-based
  guides. Source dates belong to individual references and their stated scope,
  rather than a single date claiming that the whole guide was verified.
  Per-item Amora links use a separate 44px icon beside the checklist control.
  Guide and category-question actions share a compact footer row. Guide source
  links use a sage badge, and previous/next guides stay in two columns on mobile.
  The subsequent 2026-09-08 simplification keeps checklist index rows focused on
  the category and saved progress, with separate, accessible guide/question actions.
  Long category tips scroll with the checklist instead of occupying its fixed footer.
  The guide index supports title/body search combined with a topic filter; compact
  entries still expose their audience and reading length. Articles retain the complete
  server-rendered content and add a collapsible contents list, section links and a
  return-to-top action. Role selection filters both contents and visible sections;
  direct links reveal the addressed section, including repeated links to the same hash.
  Section questions sit beside their headings instead of repeating a footer sentence.
  These navigation controls never send an Amora message or alter saved preparation.
  Checklist routes omit the global floating Amora launcher so it cannot cover the
  row actions; category/item questions and the bottom Amora navigation remain available.
  Clearing or resetting a search restores keyboard focus to its search input.

- **Amora HTML exception (2026-09-06):** The user also approved the supplied
  `AmoraMissions.dc.html`, `MissionsMobile.dc.html`, `AmoraDecisionBoard.dc.html`,
  `BoardMobile.dc.html` and `SaveSheetMobile.dc.html`, requesting the closest possible match.
  `/chat`, its board subpages, the lounge's missions and their save confirmation sheet use self-hosted
  Gowun Dodum display text and IBM Plex Sans KR body/controls within `.amora-workspace`.
  The modified fonts have renamed families, OFL notices and full modern Hangul coverage
  for user content. Other product routes retain Paperlogy except the lounge and separately approved
  checklist and manners surfaces above. The scoped HTML palette,
  intermediate type sizes and 8–24px radii are approved for these surfaces.
  Desktop sidebar is 220px; mobile gutters are 18px and navigation respects safe areas.
  Muted small text and rose labels retain sufficient contrast. Reference counts,
  partner acknowledgements and automatic-save claims must correspond to actual data.
  The 2026-09-08 alignment keeps the five-stage strip compact and reveals its
  category details on selection, so actionable mission cards come first. The board
  switches between decision records and shared to-dos in one location: saved decision
  states and to-do completion remain distinct. Desktop uses three columns; mobile
  uses a state selector, scrolling category chips and an expandable search field.
  Saving a shared answer to the saved collection remains separate from approving
  a budget, schedule or checklist change; the supplied sheet styling covers both.
  The 2026-09-10 navigation revision moves today's missions into Wedding Lounge;
  desktop and mobile Amora entries open the conversation. One common header holds
  Together, Private counseling and Decision board: to the right of the title on wide
  screens, on a full-width row below it on smaller screens. Controls are at least 44px.
  The conversation owns the actual scope, per-scope drafts and send locks even when
  its controls appear in the header. The embedded assistant retains its local controls.
  A hidden mobile scope picker was considered but rejected: the current privacy scope
  must remain visible and switching should not require an extra sheet.
  The lounge and Amora share the 220px sidebar, typography and mobile navigation;
  lounge recommendations are consolidated around missions rather than duplicated.
  Saved answers are a third board view, distinct from decisions and shared to-dos.
  They remain shared reference material with the existing memo and deletion boundaries.
  The separate global Saved menu is removed, and old saved/missions URLs still resolve.
  The 2026-09-10 detail review keeps the lounge date as a compact, clearly labelled
  settings link beside its heading. Embedded missions put actionable cards before
  the five-stage explanation in both visual and keyboard reading order. Budget
  summaries preserve recorded won amounts, mark rounded ratios, and do not infer
  budget safety from recorded spend alone. General events are called schedules,
  with their actual saved time or an explicit unset state. Missing setup values
  and resource-load failures each have a specific next action.
  Saved memo editing protects an unfinished draft when another note is selected.
  A concurrent change is read and displayed beside the retained draft before a
  user explicitly chooses to replace the current memo. Small-screen chat dialogs
  scroll within the viewport; dismissing a long-conversation notice stays effective
  for its current account, scope and conversation segment.
  Ordinary messages use the reference's sage
  and ink bubbles. Shared/private scope and approval controls remain functional.
  The subsequent Amora review labels mixed task/checklist suggestions as today's
  preparation and keeps the actual shared-task count separate. Task links select
  `?view=tasks`; board selection follows browser history while preserving drafts.
  Amora headers omit the unrelated community search shortcut. Mobile board state
  controls stack their dot, label and count; supporting labels are at least 12px.
  Long decisions retain their full fetched text for search and an explicit reveal.
  Save sheets keep their title and actions fixed while the explanation and content
  scroll. Actions sit side by side only below 500px viewport height. Expanding a memo
  focuses its 16px input; closing or deferring restores a meaningful control without
  overriding a newer focus choice. These presentation changes do not imply storage,
  partner approval or a completed budget/schedule/checklist update.
  Shared to-do cards also expose their existing optional description and planned-time
  fields inside the edit form. Planned time remains user text, such as a date or
  "next week"; it is not parsed into a confirmed date or a completed-work timestamp.
  Emptying a field clears it, while untouched fields stay unchanged. Failed saves
  retain the draft. The form identifies the record as visible to the other person.
  The shared to-do list also offers an inline creation form with title, optional
  description and planned time. Visibility to the other person does not mean
  joint agreement. While a save outcome is unknown, the form retains its draft
  and retries the same request without allowing edits to that attempt. Cancelling
  explains that the item may already have been saved and should be checked in the
  list. Creation and card edits stay locked until the save and subsequent list
  refresh finish; a confirmed save followed by a failed refresh offers a reload.

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
  The 2026-09-08 correction restores the supplied hero headline (two desktop lines,
  three mobile lines) and section sequence: preparation questions, Amora dialogue,
  different preferences, confirmed records, public tools, community, boundaries.
  Keep truthful AI, sample, saving and sharing disclosures even when they add height
  to the reference. Do not publish its placeholder user counts or photo instructions.
  A direct visit to `/` opens `/landing` regardless of sign-in state; explicit login
  return destinations and navigation into protected product pages remain separate.

- **Brand font:** Pretendard. Use across web and mobile for display, body, UI, and numeric moments.
- **Hierarchy:** Use weight, size, color, and spacing for emphasis instead of mixing serif/sans/display families.
- **Numbers/display:** Pretendard with tabular number styling where available. D-day and money totals may use larger size and heavier weight, not a separate font family.
- **Data/tables:** Pretendard with tabular number styling where available.
- **Scale:** xs 12, sm 14, base 16, lg 18, xl 20, 2xl 24, 3xl 30, 4xl 36, 5xl 48.
- **Rule:** Text inside compact mobile UI must be scan-first. Keep the font family consistent and vary only weight/size for hierarchy.
- **Retired landing handwriting exception (2026-08-27; superseded 2026-09-12):** The marketing landing (`/landing`, `/`) previously used
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
  - Ink: `#3A2A27`, soft `#5A4742`, faint `#6E5A54`, pressed `#251A18`
    - **2026-09-16 파운더 결정으로 먹빛을 따뜻하게 옮겼다.** 원문: "우리 검정을 많이 쓰는데
      웨딩에 안 어울리는 거 같아 … 주변 디자인 색들하고 맞추면서 이쁘게". 옛 잉크 `#26251F`
      는 h51°(올리브) 쪽 무채색이라 아이보리 지면 위에서 차갑게 읽혔다. 새 잉크는 h9° 의
      짙은 코코아-로즈로, 강조색 `#7D5753`(h6°)·샴페인 `#B89785`(h21°)와 같은 계열이다.
      큰 면(버튼·다크 밴드)에서는 따뜻한 밤색으로, 12px 본문에서는 먹으로 읽힌다.
      실측 대비 — ink sheet 13.27 / card 13.63 / tint 12.41, soft 8.47, faint 6.28:1.
    - 같은 결정으로 **Tailwind 의 `black` 자체**를 `#251A18` 로 돌렸다(`--color-black`).
      제품에 `border-black/[0.04]`·`bg-black/40` 같은 반투명 검정이 280곳쯤 있는데, 값마다
      옅어 따로는 안 보여도 아이보리 위에 겹겹이 깔리면 화면에 차가운 회색 막을 씌운다.
      불투명도와 두께는 그대로 두고 색온도만 옮기는 방법이다. **예외 하나** — 로그인의
      Sign in with Apple 버튼은 Apple 브랜드 규정이 검정·흰색·흰색+테두리만 허용하므로
      그 자리만 `#000000` 으로 못 박았다.
  - On ink (잉크 **위에** 얹는 것 — 랜딩 끝 다크 밴드): text `#FDFCF7`, soft `#DAD3CD`,
    faint `#A39A92`, rule `#5C4A45`. 2026-09-03 시안 픽셀 실측에서 출발했고, 2026-09-16
    잉크가 따뜻해지면서 셋을 다시 쟀다 — 실측 `#89897F` 도, 그때 올려 둔 `#96938B`(새 잉크
    위 4.44:1)도 AA 미달이라 `#A39A92`(4.93:1)로 한 칸 더 올렸다. soft 는 9.21:1.
    **잉크를 또 바꾸면 이 셋을 반드시 다시 재라.**
    rule 은 어두운 바탕의 구분선이라 대비 기준이 아니라 **보이되 튀지 않는** 값이다.
  - Pens: blue `#35638A` (links, handwritten emphasis), hover `#24465F`, red circle `#B8452F`,
    tape `#F6E7A8` on `#6C5410`, outline-button border `#8E8377`
    - ⚠️ outline-button border 는 **장식이 아니라 컨트롤의 경계**다. 테두리 버튼은 이 선
      하나로 "누를 수 있는 것"이 되므로 WCAG 1.4.11 의 3:1 이 적용된다. 2026-08-29 실측:
      옛 `#CFCABA` 는 sheet 1.60 / card 1.64 / tint 1.49:1 로 셋 다 미달이었다.
      2026-09-16 에 잉크를 따뜻하게 옮기면서 이 선도 같은 계열(h27°)로 데려왔고, 지금 값은
      3.61 / 3.71 / 3.38:1 이다(직전 `#8F8A7A` 는 3.36 / 3.45 / 3.13:1). 밝게 되돌리려면
      세 지면 모두에서 3:1 을 다시 재라.
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

### Profile initials (2026-09-13)

- User avatar initials use the first grapheme consistently across settings,
  sidebar, chat, public community and native surfaces. Latin letters are
  uppercase; an empty name uses `?`. The shared function handles composed
  Korean and emoji without cutting their code units.
- Web avatars use `ProfileAvatar` with the existing rose-pale background
  `#EADDD8` and rose-700 ink `#7D5753`; their calculated contrast is 4.71:1.
  Existing public community emoji and image choices remain separate from
  the private wedding profile. Failed images fall back to the same initial.
- Private photo/emoji editing and confirmed-role editing are preserved in
  the separate avatar work branch. Their controls and API/DB changes are
  excluded from this UI release until storage permissions and restore
  verification are complete.

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
