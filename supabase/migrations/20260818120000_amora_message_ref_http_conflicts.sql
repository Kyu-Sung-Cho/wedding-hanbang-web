BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- These conflicts are application-level optimistic-concurrency responses.
-- SQLSTATE 40001 is reserved for serialization failures and some PostgREST
-- versions retry it automatically, which can turn a deterministic stale
-- request into an unbounded HTTP request. PT409 preserves transaction rollback
-- while returning a finite HTTP 409 through PostgREST.
--
-- Patch only the four audited message-ref functions that can emit an
-- application conflict. Exact occurrence, reverse-reconstruction, ownership,
-- ACL, SECURITY DEFINER, and function-config checks make predecessor drift fail
-- closed instead of partially changing the privacy or locking contract.
DO $amora_message_ref_http_conflicts$
DECLARE
  signatures constant text[] := ARRAY[
    'public.amora_preparation_topic_message_ref_context_v1(uuid,uuid,bigint,boolean)',
    'public.set_amora_preparation_topic_message_ref_v1(uuid,uuid,text,uuid,text,bigint,uuid,bigint)',
    'public.get_amora_preparation_topic_message_ref_state_v1(uuid,uuid,text,uuid,bigint)',
    'public.resolve_amora_preparation_topic_message_ref_v1(uuid,uuid,uuid,bigint)'
  ];
  expected_counts constant integer[] := ARRAY[2, 6, 1, 1];
  service_executable constant boolean[] := ARRAY[false, true, true, true];
  old_fragment constant text := $old$ERRCODE = '40001'$old$;
  new_fragment constant text := $new$ERRCODE = 'PT409'$new$;
  index integer;
  target regprocedure;
  original_definition text;
  patched_definition text;
  reconstructed_definition text;
  installed_definition text;
  occurrence_count integer;
  function_owner name;
  security_definer boolean;
  function_config text[];
BEGIN
  FOR index IN array_lower(signatures, 1)..array_upper(signatures, 1) LOOP
    target := pg_catalog.to_regprocedure(signatures[index]);
    IF target IS NULL THEN
      RAISE EXCEPTION 'AMORA_MESSAGE_REF_HTTP_CONFLICT_PREDECESSOR_MISSING:%',
        signatures[index]
        USING ERRCODE = '55000';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(proc.oid),
           pg_catalog.pg_get_userbyid(proc.proowner),
           proc.prosecdef,
           proc.proconfig
      INTO original_definition,
           function_owner,
           security_definer,
           function_config
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = target;

    occurrence_count := (
      length(original_definition)
        - length(replace(original_definition, old_fragment, ''))
    ) / length(old_fragment);
    IF occurrence_count IS DISTINCT FROM expected_counts[index]
       OR position(new_fragment IN original_definition) <> 0
       OR function_owner IS DISTINCT FROM 'postgres'::name
       OR NOT security_definer
       OR NOT COALESCE(
         function_config @> ARRAY[
           'search_path=pg_catalog, public',
           'lock_timeout=5s',
           'statement_timeout=15s'
         ]::text[],
         false
       )
       OR pg_catalog.has_function_privilege('anon', target, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', target, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', target, 'EXECUTE')
          IS DISTINCT FROM service_executable[index] THEN
      RAISE EXCEPTION
        'AMORA_MESSAGE_REF_HTTP_CONFLICT_PREDECESSOR_DRIFT:%:%',
        signatures[index], occurrence_count
        USING ERRCODE = '55000';
    END IF;

    patched_definition := replace(
      original_definition,
      old_fragment,
      new_fragment
    );
    reconstructed_definition := replace(
      patched_definition,
      new_fragment,
      old_fragment
    );
    IF patched_definition = original_definition
       OR reconstructed_definition IS DISTINCT FROM original_definition THEN
      RAISE EXCEPTION 'AMORA_MESSAGE_REF_HTTP_CONFLICT_PATCH_INVALID:%',
        signatures[index]
        USING ERRCODE = '55000';
    END IF;

    EXECUTE patched_definition;

    target := pg_catalog.to_regprocedure(signatures[index]);
    SELECT pg_catalog.pg_get_functiondef(proc.oid),
           pg_catalog.pg_get_userbyid(proc.proowner),
           proc.prosecdef,
           proc.proconfig
      INTO installed_definition,
           function_owner,
           security_definer,
           function_config
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = target;

    occurrence_count := (
      length(installed_definition)
        - length(replace(installed_definition, new_fragment, ''))
    ) / length(new_fragment);
    IF position(old_fragment IN installed_definition) <> 0
       OR occurrence_count IS DISTINCT FROM expected_counts[index]
       OR function_owner IS DISTINCT FROM 'postgres'::name
       OR NOT security_definer
       OR NOT COALESCE(
         function_config @> ARRAY[
           'search_path=pg_catalog, public',
           'lock_timeout=5s',
           'statement_timeout=15s'
         ]::text[],
         false
       )
       OR pg_catalog.has_function_privilege('anon', target, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', target, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', target, 'EXECUTE')
          IS DISTINCT FROM service_executable[index] THEN
      RAISE EXCEPTION 'AMORA_MESSAGE_REF_HTTP_CONFLICT_POSTCONDITION_FAILED:%',
        signatures[index]
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$amora_message_ref_http_conflicts$;

COMMIT;
