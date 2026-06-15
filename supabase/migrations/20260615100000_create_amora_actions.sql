-- Amora Actions
--
-- First-class action memory for Amora.
--
-- Why this exists:
--   wedding_journeys.progress.__amora_actions was useful for a fast prototype,
--   but it stores all action cards inside one JSON blob. That leaves narrow
--   lost-update windows and makes lounge, reminders, community handoff, and
--   audit trails depend on one large mutable document.
--
-- Design:
--   - couple scoped, not global model memory
--   - readable by the couple through RLS
--   - writes go through service role APIs/tool execution
--   - legacy progress actions are backfilled once, then the app reads table
--     actions first and keeps progress as a temporary compatibility fallback

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.amora_actions (
  id text primary key,
  couple_id uuid not null references public.couples(id) on delete cascade,

  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text,
  due_date text,
  category_key text,

  priority text not null default 'medium'
    check (priority in ('high', 'medium', 'low')),
  status text not null default 'open'
    check (status in ('open', 'done', 'dismissed')),
  source text not null default 'chat'
    check (source in ('chat', 'quote', 'schedule', 'budget', 'guardrail', 'manual')),

  href text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  dismissed_at timestamptz
);

create index if not exists idx_amora_actions_couple_status_due
  on public.amora_actions(couple_id, status, due_date, created_at desc);

create index if not exists idx_amora_actions_couple_category
  on public.amora_actions(couple_id, category_key)
  where category_key is not null;

alter table public.amora_actions enable row level security;

revoke all privileges on table public.amora_actions from anon;
revoke all privileges on table public.amora_actions from authenticated;
grant select on table public.amora_actions to authenticated;
grant all privileges on table public.amora_actions to service_role;

drop policy if exists amora_actions_service_role_all on public.amora_actions;
create policy amora_actions_service_role_all
  on public.amora_actions
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists amora_actions_select_couple on public.amora_actions;
create policy amora_actions_select_couple
  on public.amora_actions
  for select
  to authenticated
  using (public.is_couple_member(couple_id));

create or replace function public.set_amora_action_status_timestamps()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_at = coalesce(new.completed_at, now());
    new.dismissed_at = null;
  end if;

  if new.status = 'dismissed' and (tg_op = 'INSERT' or old.status is distinct from 'dismissed') then
    new.dismissed_at = coalesce(new.dismissed_at, now());
    new.completed_at = null;
  end if;

  if new.status = 'open' then
    new.completed_at = null;
    new.dismissed_at = null;
  end if;

  return new;
end;
$$;

drop trigger if exists set_amora_actions_updated_at on public.amora_actions;
create trigger set_amora_actions_updated_at
  before update on public.amora_actions
  for each row execute function public.update_updated_at_column();

drop trigger if exists set_amora_actions_status_timestamps on public.amora_actions;
create trigger set_amora_actions_status_timestamps
  before insert or update on public.amora_actions
  for each row execute function public.set_amora_action_status_timestamps();

insert into public.amora_actions (
  id,
  couple_id,
  title,
  description,
  due_date,
  category_key,
  priority,
  status,
  source,
  href,
  created_at,
  updated_at,
  completed_at
)
select
  coalesce(nullif(action ->> 'id', ''), 'legacy_' || journey.id::text || '_' || item.ordinality::text),
  journey.couple_id,
  left(btrim(action ->> 'title'), 120),
  nullif(left(btrim(coalesce(action ->> 'description', '')), 500), ''),
  nullif(left(btrim(coalesce(action ->> 'dueDate', '')), 40), ''),
  nullif(left(btrim(coalesce(action ->> 'categoryKey', '')), 80), ''),
  case
    when action ->> 'priority' in ('high', 'medium', 'low') then action ->> 'priority'
    else 'medium'
  end,
  case
    when action ->> 'status' in ('open', 'done', 'dismissed') then action ->> 'status'
    else 'open'
  end,
  case
    when action ->> 'source' in ('chat', 'quote', 'schedule', 'budget', 'guardrail', 'manual') then action ->> 'source'
    else 'chat'
  end,
  case
    when coalesce(action ->> 'href', '') like '/%' then left(action ->> 'href', 180)
    else null
  end,
  case
    when coalesce(action ->> 'createdAt', '') ~ '^\d{4}-\d{2}-\d{2}T' then (action ->> 'createdAt')::timestamptz
    else now()
  end,
  case
    when coalesce(action ->> 'updatedAt', '') ~ '^\d{4}-\d{2}-\d{2}T' then (action ->> 'updatedAt')::timestamptz
    else now()
  end,
  case
    when coalesce(action ->> 'completedAt', '') ~ '^\d{4}-\d{2}-\d{2}T' then (action ->> 'completedAt')::timestamptz
    else null
  end
from public.wedding_journeys journey
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(journey.progress -> '__amora_actions') = 'array'
      then journey.progress -> '__amora_actions'
    else '[]'::jsonb
  end
) with ordinality as item(action, ordinality)
where btrim(coalesce(action ->> 'title', '')) <> ''
on conflict (id) do nothing;

comment on table public.amora_actions is
  'Amora action cards per couple. These are operational memories, not global model training data.';
comment on column public.amora_actions.source is
  'Where the action came from: chat, quote, schedule, budget, guardrail, or manual.';
