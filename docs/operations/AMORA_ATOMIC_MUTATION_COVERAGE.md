# Amora atomic mutation coverage

Status: implementation complete locally; production migration not applied.

## Invariant

An Amora write is successful only when the domain mutation and the matching
`amora_tool_executions` completion row commit in the same PostgreSQL
transaction. The database revalidates the tool name, bounded input, expected
current state, proposed state, and durable result before writing.

`wedding_journeys` mutations use compare-and-set expectations. A partner or
another request changing the same field or progress entry first produces a
durable `domain_state_changed` failure; unrelated progress keys are preserved.
Known assignments that would not change state produce `no_change`, never a
successful result.

## Covered beta mutations

| Domain | Tools | Canonical write |
| --- | --- | --- |
| Wedding settings | `update_wedding_date`, `update_venue` | field CAS on `wedding_journeys` |
| Budget and progress | `update_budget`, `update_task_status`, `update_category_budget`, `apply_budget_plan`, `add_custom_category`, `toggle_checklist_item` | field/entry CAS on `wedding_journeys`; a budget plan updates total and selected entries together |
| Schedule | `add_schedule_event`, `update_schedule_event`, `log_wedding_event` | `wedding_journeys.progress.__events` array CAS |
| Action cards | `add_amora_action`, `update_amora_action` | `amora_actions` row write |

`delete_schedule_event` is also implemented by the dispatcher but remains
beta-disabled with the other destructive tools. `create_booking`,
`cancel_booking`, `delete_category`, and `reset_category` remain intentionally
disabled until their separate server-issued confirmation flows are released.

## Action-card single source of truth

`amora_actions` is the durable canonical store. Atomic action writes do not
write `wedding_journeys.progress.__amora_actions`. The latter is retained only
as a legacy read fallback and an in-process projection for the current model
turn. This prevents a table write and a JSON mirror from diverging.

New action IDs are deterministic for one request and operation:

`act_<request UUID without hyphens>_<first 24 chars of operation key>`

Retries therefore converge on the same action without `Date.now()` or random
IDs. Legacy bounded action IDs can still be updated, scoped by `couple_id`.

## Privacy and bounds

- `apply_budget_plan.intake_summary` is validated but excluded from both the
  domain mutation and durable tool result.
- Amounts are integer won values between 0 and KRW 1 trillion.
- Dates are real `YYYY-MM-DD` dates; a wedding date cannot be in the past in
  Korea Standard Time.
- Venue, category, checklist, schedule, action, and JSON sizes are bounded in
  both TypeScript and PostgreSQL.
- The dispatcher is executable only by `service_role`. Its v1 implementation
  is private to the security-definer wrapper and is not executable by runtime
  roles directly.

## Database objects

Migration: `20260716112000_amora_atomic_mutation_coverage.sql`

- Public runtime RPC (signature unchanged):
  `public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)`
- Private delegated v1 function:
  `public.apply_amora_atomic_tool_execution_v1(uuid,text,text,integer,text,jsonb,jsonb,jsonb)`
- Existing tables written:
  `public.wedding_journeys`, `public.amora_actions`,
  `public.amora_tool_executions`
- No new table or column is added by this migration.

Backup and preflight inventories must include both function definitions and the
three existing tables before this migration is promoted. Production remains
blocked until the repository-level backup/restore and release gates pass.
