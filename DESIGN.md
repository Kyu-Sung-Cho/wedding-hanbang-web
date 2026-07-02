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

- **Brand font:** Paperlogy. Use across web and mobile for display, body, UI, and numeric moments.
- **Hierarchy:** Use Paperlogy weight, size, color, and spacing for emphasis instead of mixing serif/sans/display families.
- **Numbers/display:** Paperlogy with tabular number styling where available. D-day and money totals may use larger size and heavier weight, not a separate font family.
- **Data/tables:** Paperlogy with tabular number styling where available.
- **Scale:** xs 12, sm 14, base 16, lg 18, xl 20, 2xl 24, 3xl 30, 4xl 36, 5xl 48.
- **Rule:** Text inside compact mobile UI must be scan-first. Keep the font family consistent and vary only weight/size for hierarchy.

## Color

- **Approach:** Restrained warm luxury with a quieter web/app brand match.
- **Primary eucalyptus ink:** `#36534E` and `#243832` for high-trust surfaces, main text, AI identity, and premium contrast.
- **Dusty mauve:** `#A77B74` and `#8F6662` for key actions, selected states, and human warmth.
- **Pearl ivory surfaces:** `#FBF8F2`, `#F7F1E8`, `#EFE4D7`, and `#F6EFE5` for backgrounds and layered panels.
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
