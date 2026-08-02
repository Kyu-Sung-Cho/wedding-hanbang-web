BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- A shared schedule edit can silently override a partner's plan. Only adding
-- an already-confirmed fact stays one-person; ambiguous/new commitments and
-- every edit require both current members. Unknown scopes fail toward safety.
CREATE OR REPLACE FUNCTION public.amora_shared_action_policy(
  p_tool_name text,
  p_tool_input jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN p_tool_name IN (
      'create_booking',
      'cancel_booking',
      'delete_category',
      'reset_category',
      'delete_schedule_event',
      'update_amora_action'
    ) THEN 'blocked'
    WHEN jsonb_typeof(p_tool_input) IS DISTINCT FROM 'object' THEN 'blocked'
    WHEN p_tool_name IN (
      'update_budget',
      'update_wedding_date',
      'update_venue',
      'apply_budget_plan'
    ) THEN 'couple'
    WHEN p_tool_name IN ('update_category_budget', 'add_custom_category')
      AND p_tool_input ? 'budget'
      THEN 'couple'
    WHEN p_tool_name = 'add_schedule_event'
      AND p_tool_input ->> 'schedule_scope' = 'confirmed_fact'
      THEN 'single'
    WHEN p_tool_name IN ('add_schedule_event', 'update_schedule_event')
      THEN 'couple'
    WHEN p_tool_name IN (
      'update_task_status',
      'update_category_budget',
      'add_custom_category',
      'toggle_checklist_item',
      'add_amora_action',
      'log_wedding_event'
    ) THEN 'single'
    ELSE 'blocked'
  END;
$function$;

REVOKE ALL ON FUNCTION public.amora_shared_action_policy(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.amora_shared_action_policy(text, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.amora_shared_action_policy(text, jsonb) IS
  'Classifies Amora shared mutations. Schedule facts may be recorded by one member; new/ambiguous commitments and all edits require the couple.';

COMMIT;
