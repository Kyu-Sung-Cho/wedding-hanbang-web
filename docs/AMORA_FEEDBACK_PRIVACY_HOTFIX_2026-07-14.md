# Amora feedback privacy hotfix — 2026-07-14

## Why this shipped

`chat_feedback.correction` was being read with the service role and injected into
Amora prompts across couples. The table does not record conversation visibility,
consent, or safe learning provenance, so raw feedback was not safe to reuse.

## Containment

- Raw feedback learning now fails closed and contributes no prompt content.
- `GET /api/chat/feedback` returns an authenticated, non-cacheable disabled state
  without reading `chat_feedback`.
- Explicit feedback is accepted only for an AI message that the authenticated
  request-scoped Supabase client can read, belongs to the caller's couple, and has
  `visibility = shared`.
- Feedback controls are hidden for private AI messages.
- Automatic dissatisfaction tracking stores only an allowlisted signal for shared
  conversations. It stores no user text, AI text, correction, or client-supplied
  message ID. Private conversations create no automatic feedback row.

Existing database rows are not deleted by this hotfix. They remain service-role
only. Deletion or retention changes require an explicit privacy/legal decision and
a verified backup.

## Verification

- Focused privacy and API tests: 33 passed.
- Complete web test suite: 67 files, 475 tests passed.
- TypeScript: passed.
- ESLint: passed with no warnings.
- Next.js production build: passed; 100 routes generated.
- Independent security re-review after private-message containment: clean.

## Follow-up gate before feedback learning can return

Add a database model with explicit `visibility`, `source` (manual/automatic),
consent, retention, and anonymized structured learning artifacts. Any aggregation
must enforce minimum cohort size and must never expose or prompt-inject raw
corrections or message content. Until then, learning remains disabled.

## Rollback

Revert this hotfix commit and redeploy only if a replacement implementation has
equivalent tenant and private-conversation isolation. Re-enabling the former raw
feedback loaders is not an acceptable rollback.
