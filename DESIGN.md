# Design System - Wedding Hanbang

## Product Context

- **What this is:** Wedding Hanbang is an AI wedding operating room for Korean couples preparing a wedding together.
- **Who it is for:** Couples 6-12 months before the wedding who need one place for decisions, budget, schedule, vendors, and partner coordination.
- **Product type:** Consumer mobile app plus web app, community, vendor marketplace, and marketing site.
- **Core memory:** The first impression should be "this app tells us what to do next, without making wedding planning feel cheap or chaotic."

## Aesthetic Direction

- **Direction:** Quiet editorial utility.
- **Mood:** Refined, warm, and practical. The app should feel like a calm planner that knows wedding details, not a generic productivity app with wedding colors.
- **Decoration level:** Intentional. Use typography, spacing, shadow, and a few premium accents. Avoid decorative noise.
- **Mobile posture:** Daily-use cockpit. The first screen should answer "What matters today?" before showing everything else.
- **Web posture:** More editorial and explanatory. Web can carry longer copy, richer sections, and admin workflows.

## Typography

- **Korean display:** Noto Serif KR. Use for brand moments, D-day, calm hero titles, and emotional emphasis.
- **Korean body/UI:** Noto Sans KR. Use for all controls, labels, lists, forms, and dense app surfaces.
- **Numbers/display:** Cormorant Garamond. Use for D-day, money totals, and large numeric moments only.
- **Data/tables:** Noto Sans KR with tabular number styling where available.
- **Scale:** xs 12, sm 14, base 16, lg 18, xl 20, 2xl 24, 3xl 30, 4xl 36, 5xl 48.
- **Rule:** Text inside compact mobile UI must be scan-first. Serif is seasoning, not the meal.

## Color

- **Approach:** Restrained warm luxury.
- **Primary noir:** `#1A1A1F` for high-trust surfaces, main text, AI identity, and premium contrast.
- **Rose champagne:** `#C4967E` and `#9A6B62` for key actions, selected states, and human warmth.
- **Ivory surfaces:** `#FDFCFA`, `#FAF8F5`, `#F5F2ED` for backgrounds and layered panels.
- **Gold:** `#C9A96E` for rare highlights, not primary buttons everywhere.
- **Semantic:** success `#22C55E`, warning `#C9A96E`, danger `#EF4444`, info `#1A1A1F`.
- **Rule:** Do not turn the app into a pink app. Rose should guide attention, not paint every object.

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

- Warm ivory background with white surfaces.
- Noir high-contrast hero moments for trust.
- Rose accent for selection and primary action.
- Bottom tabs for mobile navigation.
- Noto Sans KR for app readability.

## Product Risks Worth Taking

- Make the app quieter than typical wedding apps. This may feel less flashy, but it builds trust for budget and vendor decisions.
- Treat AI as an operator, not a mascot. This costs some playful charm, but it makes Amora feel capable.
- Keep the dashboard task-first. This gives up a pure brand hero, but users get immediate relief.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-30 | Initial design system created | Consolidated existing Wedding Hanbang documents, design tokens, and mobile app direction into one source of truth. |
