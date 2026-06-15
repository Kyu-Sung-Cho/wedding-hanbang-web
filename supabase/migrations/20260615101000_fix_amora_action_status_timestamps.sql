-- Ensure Amora action status timestamps are mutually exclusive.
--
-- If the initial amora_actions migration has already run in an environment,
-- this follow-up keeps analytics and audit trails unambiguous:
-- done actions should not retain dismissed_at, and dismissed actions should
-- not retain completed_at.

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
