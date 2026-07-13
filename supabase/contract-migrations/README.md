# Supabase expand/contract release gate

Files in this directory are deliberately outside `supabase/migrations` and use
the `.sql.disabled` suffix. `supabase db push` must never apply them during the
expand release.

## Expand release (current)

1. Take a database backup and run the normal pending migrations on a
   production-size restore first.
2. Apply the active migrations. They add the new columns, RPCs, lifecycle
   fences, and service-route upload quota while keeping published mobile
   contracts available.
3. Deploy the new web/API and mobile clients.
4. Verify both the latest client and the last published mobile binary against
   staging: partner profile read, direct chat insert, post vote, bookmark
   upsert/delete, and direct `community-images` upload must still work.

The expand release intentionally retains legacy direct-write surfaces. That is
a time-bounded compatibility risk, not permission to apply the contract early.

## Contract release (future, manual)

Do not copy or rename a disabled SQL file into `supabase/migrations` until all of
these gates have immutable evidence in the release ticket:

- A server-enforced minimum mobile version is live and every supported client
  uses the replacement API/RPC paths.
- Supabase API, RPC, and Storage logs show zero legacy mobile traffic for 14
  consecutive days.
- The last published legacy binary is rejected with a tested upgrade path; the
  latest binary passes the full authenticated journey suite.
- A fresh backup/restore drill succeeds, legacy Storage objects have an approved
  retention/export decision, and the role matrix is tested for anon,
  authenticated self, authenticated other-user, and service role.
- The exact SQL diff, production row counts, lock/statement timing, rollback
  plan, approver, and change-ticket id are recorded.

The disabled contract also requires these session-local settings and fails
closed without them:

```sql
BEGIN;
SET LOCAL hanbang.contract_min_mobile_version = '<released version>';
SET LOCAL hanbang.contract_legacy_mobile_traffic = 'zero-for-14-days';
SET LOCAL hanbang.contract_backup_approval = 'approved';
SET LOCAL hanbang.contract_change_ticket = '<ticket id>';
-- Execute the reviewed contract SQL in this same session.
COMMIT;
```

## Legacy one-slot couples

An automatic migration must never infer that a missing bride/groom slot means a
partner departed. Before marking any historical couple, export and classify
every candidate returned by:

```sql
SELECT id, bride_id, groom_id, invite_code, created_at, updated_at
FROM public.couples
WHERE (bride_id IS NULL) <> (groom_id IS NULL)
ORDER BY created_at, id;
```

Classification must distinguish `legitimate_solo`, `verified_departure`, and
`unknown`, with evidence and an approver per couple. Only `verified_departure`
ids may appear in a separately reviewed, forward-only data migration. That
migration must enumerate ids explicitly, assert the exact affected-row count,
and preserve an export. It must not use the broad one-slot predicate in an
`UPDATE`, clear every invite, call `restart_blocked_amora_couple_safely`, or
create replacement couples. Unknown and legitimate-solo rows remain untouched.

For departures observed after the expand migration, lifecycle RPCs have direct
event provenance. A replacement couple is created only after the remaining user
explicitly confirms the restart in product UI; it is never a migration side
effect.
