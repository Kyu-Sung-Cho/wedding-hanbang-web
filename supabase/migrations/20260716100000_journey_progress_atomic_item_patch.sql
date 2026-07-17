-- Merge fields into one wedding progress item without replacing sibling fields.
--
-- A top-level JSONB merge replaces the complete category object. Status-only
-- changes could therefore erase budget, spent, checklist, or memo fields. This
-- RPC locks the journey row and merges the item patch with the latest database
-- value in one UPDATE statement.

create or replace function public.apply_journey_progress_item_patch(
  p_couple_id uuid,
  p_item_key text,
  p_item_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_item jsonb;
begin
  if p_item_key is null or btrim(p_item_key) = '' then
    raise exception 'progress item key is required'
      using errcode = '22023';
  end if;

  if p_item_patch is null or jsonb_typeof(p_item_patch) <> 'object' then
    raise exception 'progress item patch must be a JSON object'
      using errcode = '22023';
  end if;

  update public.wedding_journeys
     set progress = jsonb_set(
       coalesce(progress, '{}'::jsonb),
       array[p_item_key],
       (
         case
           when jsonb_typeof(coalesce(progress, '{}'::jsonb) -> p_item_key) = 'object'
             then coalesce(progress, '{}'::jsonb) -> p_item_key
           else '{}'::jsonb
         end
       ) || p_item_patch,
       true
     ),
         updated_at = now()
   where couple_id = p_couple_id
   returning progress -> p_item_key into v_item;

  if v_item is null then
    raise exception 'wedding_journeys row not found for couple_id=%', p_couple_id
      using errcode = 'P0002';
  end if;

  return v_item;
end;
$$;

revoke all on function public.apply_journey_progress_item_patch(uuid, text, jsonb) from public;
revoke all on function public.apply_journey_progress_item_patch(uuid, text, jsonb) from anon;
revoke all on function public.apply_journey_progress_item_patch(uuid, text, jsonb) from authenticated;
grant execute on function public.apply_journey_progress_item_patch(uuid, text, jsonb) to service_role;
