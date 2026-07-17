# Mobile wedding settings atomicity contract

> **Status: implemented and locally tested; production migrations, current
> deployment, signed EAS and physical-device verification NOT RUN.** This
> document describes the candidate contract, not current production behavior.
> See `CURRENT_WORKSPACE_HANDOFF_2026-07-17.md` for release status.

## Scope

The mobile settings identity and wedding form reads through one authenticated
`GET /api/settings/wedding-profile` request and writes through one authenticated
`PATCH /api/settings/wedding-profile` request. The API is the only client-facing
write boundary; the mobile client must not update `wedding_journeys` directly.

The API calls service-role-only database functions:

- `get_wedding_settings_snapshot(uuid)`
- `patch_wedding_settings_atomic(uuid,uuid,boolean,text,boolean,text,text,boolean,text,date,boolean,date,text,boolean,text,bigint,boolean,bigint)`

Migration order is `20260716104000_profile_patch_atomic.sql` followed by
`20260716107000_wedding_settings_atomic.sql`.

## Field semantics

`profiles.name` and `community_profiles.nickname` are independent settings.
Changing only the profile name never changes the community nickname, including
when the existing nickname happens to equal the old profile name or otherwise
looks like a generated default. A missing community row is returned as
`community_nickname: null`; a name-only patch keeps it missing, and only an
explicit `community_nickname` change creates it.

The client sends only fields whose displayed values changed. Every sent field
has an exact old value in `expected`, and every request includes the loaded
`expected_couple_id` (including explicit `null`). The database locks the profile,
community profile, and journey rows in that order and rejects a changed couple
or stale same-field value. Unsent fields are not compared or rewritten, so a
concurrent update to a different field is preserved.

`wedding_date` accepts an actual `YYYY-MM-DD` date or explicit `null`. Venue is
trimmed, limited to 120 characters, and may be explicitly cleared with `null`.
The UI displays budget in 만원, while the API and database use integer 원:

- empty input becomes `null`;
- `0` becomes integer `0`, never `null`;
- an input such as `12abc` is rejected rather than prefix-parsed;
- a changed value must be between 0 and 1,000,000,000 won;
- an unchanged legacy value above that cap may be read and left untouched so
  another field can still be corrected.

## Failure behavior

The outer RPC reuses `patch_profile_atomic` inside the same transaction and then
updates only provided journey columns. A nickname uniqueness failure, stale
expected value, changed couple, missing journey, or later journey write failure
rolls back the profile, nickname, and journey together. The mobile client
advances `initialData` and its exact snapshot only after a validated successful
response. A `409 SETTINGS_CHANGED` fails closed and requires a fresh read.
Every load attempt also owns a generation token. Care availability, masked
delivery email, consent state, partner name, connection state, form data, and
the exact snapshot commit together only while that token is current. Retrying
or unmounting invalidates the older token, so a slow first request cannot
overwrite a faster retry.

PGlite coverage includes profile-only, nickname-only, journey-only, all-fields,
explicit null clears, zero budget, missing community rows, independent default
nicknames, stale-value conflicts, couple changes, row-lock order, role grants,
and forced late-write rollback. Mobile tests cover 만원-to-원 conversion, empty
versus zero, impossible dates, changed-field-only payloads, and legacy values.

## Remaining boundary

This contract protects callers of the new mobile settings API. Other product
write paths that still mutate the same profile or journey fields must retain
their own authorization and concurrency guarantees; migrating every editor to
this expected-value contract is a separate cross-surface hardening step.
