BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- The TypeScript operation builder has canonicalized omitted hrefs for the
-- MC/gift categories to /wedding/chat since the retired etiquette route was
-- removed. The private atomic dispatcher still expected the retired route,
-- so an already-issued proposal could retain a valid digest and operation key
-- yet fail at approval time.
-- The same dispatcher also trimmed only plain spaces before collapsing SQL's
-- whitespace class. Leading/trailing tabs and newlines therefore became a
-- synthetic edge space after the trim, unlike the TypeScript canonicalizer.
--
-- PostgreSQL requires a complete function definition for CREATE OR REPLACE.
-- Patch the one audited route literal and four audited normalization
-- expressions in place so the request/execution/journey lock graph,
-- shared-action wrapper, input payload, and durable identity remain
-- byte-for-byte unchanged. Exact occurrence checks and reverse reconstruction
-- make schema drift fail closed instead of applying a partial rewrite.
DO $amora_atomic_action_href_parity_patch$
DECLARE
  private_dispatcher regprocedure := pg_catalog.to_regprocedure(
    'public.apply_amora_atomic_tool_execution_pre_shared_revision(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'
  );
  public_dispatcher regprocedure := pg_catalog.to_regprocedure(
    'public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'
  );
  private_definition text;
  public_definition_before text;
  public_definition_after text;
  patched_definition text;
  reconstructed_definition text;
  old_href_fragment constant text :=
    $old_href$WHEN v_value ->> 'categoryKey' IN ('mc', 'gift') THEN '/wedding/etiquette'$old_href$;
  new_href_fragment constant text :=
    $new_href$WHEN v_value ->> 'categoryKey' IN ('mc', 'gift') THEN '/wedding/chat'$new_href$;
  old_title_length_template constant text := $old_title_length$char_length(regexp_replace(
         btrim(p_tool_input ->> 'title'), '[[:space:]]+', ' ', 'g'
       )) NOT BETWEEN 1 AND 120$old_title_length$;
  new_title_length_template constant text := $new_title_length$char_length(btrim(regexp_replace(
         p_tool_input ->> 'title', '[[:space:]]+', ' ', 'g'
       ))) NOT BETWEEN 1 AND 120$new_title_length$;
  old_title_value_template constant text := $old_title_value$left(regexp_replace(
         btrim(p_tool_input ->> 'title'), '[[:space:]]+', ' ', 'g'
       ), 120) <> v_value ->> 'title'$old_title_value$;
  new_title_value_template constant text := $new_title_value$left(btrim(regexp_replace(
         p_tool_input ->> 'title', '[[:space:]]+', ' ', 'g'
       )), 120) <> v_value ->> 'title'$new_title_value$;
  old_description_length_template constant text := $old_description_length$char_length(regexp_replace(
             btrim(p_tool_input ->> 'description'), '[[:space:]]+', ' ', 'g'
           )) > 500$old_description_length$;
  new_description_length_template constant text := $new_description_length$char_length(btrim(regexp_replace(
             p_tool_input ->> 'description', '[[:space:]]+', ' ', 'g'
           ))) > 500$new_description_length$;
  old_description_value_template constant text := $old_description_value$NULLIF(left(regexp_replace(
             btrim(p_tool_input ->> 'description'), '[[:space:]]+', ' ', 'g'
           ), 500), '') IS DISTINCT FROM v_value ->> 'description'$old_description_value$;
  new_description_value_template constant text := $new_description_value$NULLIF(left(btrim(regexp_replace(
             p_tool_input ->> 'description', '[[:space:]]+', ' ', 'g'
           )), 500), '') IS DISTINCT FROM v_value ->> 'description'$new_description_value$;
  old_title_length text;
  new_title_length text;
  old_title_value text;
  new_title_value text;
  old_description_length text;
  new_description_length text;
  old_description_value text;
  new_description_value text;
  definition_line_break text;
  old_href_count integer;
  old_title_length_count integer;
  old_title_value_count integer;
  old_description_length_count integer;
  old_description_value_count integer;
BEGIN
  IF private_dispatcher IS NULL OR public_dispatcher IS NULL THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_HREF_PARITY_PREDECESSOR_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(private_dispatcher),
         pg_catalog.pg_get_functiondef(public_dispatcher)
    INTO private_definition, public_definition_before;

  definition_line_break := CASE
    WHEN position(E'\r\n' IN private_definition) > 0 THEN E'\r\n'
    ELSE E'\n'
  END;
  old_title_length := replace(
    old_title_length_template,
    E'\n',
    definition_line_break
  );
  new_title_length := replace(
    new_title_length_template,
    E'\n',
    definition_line_break
  );
  old_title_value := replace(
    old_title_value_template,
    E'\n',
    definition_line_break
  );
  new_title_value := replace(
    new_title_value_template,
    E'\n',
    definition_line_break
  );
  old_description_length := replace(
    old_description_length_template,
    E'\n',
    definition_line_break
  );
  new_description_length := replace(
    new_description_length_template,
    E'\n',
    definition_line_break
  );
  old_description_value := replace(
    old_description_value_template,
    E'\n',
    definition_line_break
  );
  new_description_value := replace(
    new_description_value_template,
    E'\n',
    definition_line_break
  );

  old_href_count := (
    length(private_definition)
      - length(replace(private_definition, old_href_fragment, ''))
  ) / length(old_href_fragment);
  old_title_length_count := (
    length(private_definition)
      - length(replace(private_definition, old_title_length, ''))
  ) / length(old_title_length);
  old_title_value_count := (
    length(private_definition)
      - length(replace(private_definition, old_title_value, ''))
  ) / length(old_title_value);
  old_description_length_count := (
    length(private_definition)
      - length(replace(private_definition, old_description_length, ''))
  ) / length(old_description_length);
  old_description_value_count := (
    length(private_definition)
      - length(replace(private_definition, old_description_value, ''))
  ) / length(old_description_value);

  IF old_href_count IS DISTINCT FROM 1
     OR old_title_length_count IS DISTINCT FROM 1
     OR old_title_value_count IS DISTINCT FROM 1
     OR old_description_length_count IS DISTINCT FROM 1
     OR old_description_value_count IS DISTINCT FROM 1
     OR position(new_href_fragment IN private_definition) <> 0
     OR position(new_title_length IN private_definition) <> 0
     OR position(new_title_value IN private_definition) <> 0
     OR position(new_description_length IN private_definition) <> 0
     OR position(new_description_value IN private_definition) <> 0 THEN
    RAISE EXCEPTION
      'AMORA_ATOMIC_ACTION_HREF_PARITY_PREDECESSOR_DRIFT href=% title_length=% title_value=% description_length=% description_value=%',
      old_href_count,
      old_title_length_count,
      old_title_value_count,
      old_description_length_count,
      old_description_value_count
      USING ERRCODE = '55000';
  END IF;

  patched_definition := replace(
    private_definition,
    old_href_fragment,
    new_href_fragment
  );
  patched_definition := replace(
    patched_definition,
    old_title_length,
    new_title_length
  );
  patched_definition := replace(
    patched_definition,
    old_title_value,
    new_title_value
  );
  patched_definition := replace(
    patched_definition,
    old_description_length,
    new_description_length
  );
  patched_definition := replace(
    patched_definition,
    old_description_value,
    new_description_value
  );
  reconstructed_definition := patched_definition;
  reconstructed_definition := replace(
    reconstructed_definition,
    new_description_value,
    old_description_value
  );
  reconstructed_definition := replace(
    reconstructed_definition,
    new_description_length,
    old_description_length
  );
  reconstructed_definition := replace(
    reconstructed_definition,
    new_title_value,
    old_title_value
  );
  reconstructed_definition := replace(
    reconstructed_definition,
    new_title_length,
    old_title_length
  );
  reconstructed_definition := replace(
    reconstructed_definition,
    new_href_fragment,
    old_href_fragment
  );
  IF patched_definition = private_definition
     OR reconstructed_definition IS DISTINCT FROM private_definition THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_HREF_PARITY_PATCH_INVALID'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE patched_definition;

  SELECT pg_catalog.pg_get_functiondef(public_dispatcher)
    INTO public_definition_after;
  IF public_definition_after IS DISTINCT FROM public_definition_before THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_HREF_PARITY_PUBLIC_WRAPPER_CHANGED'
      USING ERRCODE = '55000';
  END IF;
END
$amora_atomic_action_href_parity_patch$;

ALTER FUNCTION public.apply_amora_atomic_tool_execution_pre_shared_revision(
  uuid, text, text, integer, text, jsonb, jsonb, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.apply_amora_atomic_tool_execution_pre_shared_revision(
    uuid, text, text, integer, text, jsonb, jsonb, jsonb
  )
  FROM PUBLIC, anon, authenticated, service_role;

DO $amora_atomic_action_href_parity_postconditions$
DECLARE
  private_dispatcher regprocedure := pg_catalog.to_regprocedure(
    'public.apply_amora_atomic_tool_execution_pre_shared_revision(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'
  );
  public_dispatcher regprocedure := pg_catalog.to_regprocedure(
    'public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)'
  );
  private_definition text;
  private_owner name;
  private_security_definer boolean;
  private_config text[];
  public_definition text;
  public_owner name;
  public_security_definer boolean;
  public_config text[];
  old_href_fragment constant text :=
    $old_href$WHEN v_value ->> 'categoryKey' IN ('mc', 'gift') THEN '/wedding/etiquette'$old_href$;
  new_href_fragment constant text :=
    $new_href$WHEN v_value ->> 'categoryKey' IN ('mc', 'gift') THEN '/wedding/chat'$new_href$;
  old_title_length_template constant text := $old_title_length$char_length(regexp_replace(
         btrim(p_tool_input ->> 'title'), '[[:space:]]+', ' ', 'g'
       )) NOT BETWEEN 1 AND 120$old_title_length$;
  new_title_length_template constant text := $new_title_length$char_length(btrim(regexp_replace(
         p_tool_input ->> 'title', '[[:space:]]+', ' ', 'g'
       ))) NOT BETWEEN 1 AND 120$new_title_length$;
  old_title_value_template constant text := $old_title_value$left(regexp_replace(
         btrim(p_tool_input ->> 'title'), '[[:space:]]+', ' ', 'g'
       ), 120) <> v_value ->> 'title'$old_title_value$;
  new_title_value_template constant text := $new_title_value$left(btrim(regexp_replace(
         p_tool_input ->> 'title', '[[:space:]]+', ' ', 'g'
       )), 120) <> v_value ->> 'title'$new_title_value$;
  old_description_length_template constant text := $old_description_length$char_length(regexp_replace(
             btrim(p_tool_input ->> 'description'), '[[:space:]]+', ' ', 'g'
           )) > 500$old_description_length$;
  new_description_length_template constant text := $new_description_length$char_length(btrim(regexp_replace(
             p_tool_input ->> 'description', '[[:space:]]+', ' ', 'g'
           ))) > 500$new_description_length$;
  old_description_value_template constant text := $old_description_value$NULLIF(left(regexp_replace(
             btrim(p_tool_input ->> 'description'), '[[:space:]]+', ' ', 'g'
           ), 500), '') IS DISTINCT FROM v_value ->> 'description'$old_description_value$;
  new_description_value_template constant text := $new_description_value$NULLIF(left(btrim(regexp_replace(
             p_tool_input ->> 'description', '[[:space:]]+', ' ', 'g'
           )), 500), '') IS DISTINCT FROM v_value ->> 'description'$new_description_value$;
  old_title_length text;
  new_title_length text;
  old_title_value text;
  new_title_value text;
  old_description_length text;
  new_description_length text;
  old_description_value text;
  new_description_value text;
  definition_line_break text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(proc.oid),
         pg_catalog.pg_get_userbyid(proc.proowner),
         proc.prosecdef,
         proc.proconfig
    INTO private_definition,
         private_owner,
         private_security_definer,
         private_config
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = private_dispatcher;

  SELECT pg_catalog.pg_get_functiondef(proc.oid),
         pg_catalog.pg_get_userbyid(proc.proowner),
         proc.prosecdef,
         proc.proconfig
    INTO public_definition,
         public_owner,
         public_security_definer,
         public_config
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = public_dispatcher;

  definition_line_break := CASE
    WHEN position(E'\r\n' IN private_definition) > 0 THEN E'\r\n'
    ELSE E'\n'
  END;
  old_title_length := replace(
    old_title_length_template,
    E'\n',
    definition_line_break
  );
  new_title_length := replace(
    new_title_length_template,
    E'\n',
    definition_line_break
  );
  old_title_value := replace(
    old_title_value_template,
    E'\n',
    definition_line_break
  );
  new_title_value := replace(
    new_title_value_template,
    E'\n',
    definition_line_break
  );
  old_description_length := replace(
    old_description_length_template,
    E'\n',
    definition_line_break
  );
  new_description_length := replace(
    new_description_length_template,
    E'\n',
    definition_line_break
  );
  old_description_value := replace(
    old_description_value_template,
    E'\n',
    definition_line_break
  );
  new_description_value := replace(
    new_description_value_template,
    E'\n',
    definition_line_break
  );

  IF private_dispatcher IS NULL
     OR public_dispatcher IS NULL
     OR private_owner IS DISTINCT FROM 'postgres'::name
     OR public_owner IS DISTINCT FROM 'postgres'::name
     OR NOT private_security_definer
     OR NOT public_security_definer
     OR NOT COALESCE(
       private_config @> ARRAY[
         'search_path=pg_catalog, public',
         'lock_timeout=5s',
         'statement_timeout=15s'
       ]::text[],
       false
     )
     OR NOT COALESCE(
       public_config @> ARRAY[
         'search_path=pg_catalog, public',
         'lock_timeout=5s',
         'statement_timeout=15s'
       ]::text[],
       false
     )
     OR position(old_href_fragment IN private_definition) <> 0
     OR position(old_title_length IN private_definition) <> 0
     OR position(old_title_value IN private_definition) <> 0
     OR position(old_description_length IN private_definition) <> 0
     OR position(old_description_value IN private_definition) <> 0
     OR length(private_definition)
          - length(replace(private_definition, new_href_fragment, ''))
          IS DISTINCT FROM length(new_href_fragment)
     OR length(private_definition)
          - length(replace(private_definition, new_title_length, ''))
          IS DISTINCT FROM length(new_title_length)
     OR length(private_definition)
          - length(replace(private_definition, new_title_value, ''))
          IS DISTINCT FROM length(new_title_value)
     OR length(private_definition)
          - length(replace(private_definition, new_description_length, ''))
          IS DISTINCT FROM length(new_description_length)
     OR length(private_definition)
          - length(replace(private_definition, new_description_value, ''))
          IS DISTINCT FROM length(new_description_value)
     OR position(
       'apply_amora_atomic_tool_execution_pre_shared_revision'
       IN public_definition
     ) = 0
     OR pg_catalog.has_function_privilege(
       'anon', private_dispatcher, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', private_dispatcher, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', private_dispatcher, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', public_dispatcher, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', public_dispatcher, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', public_dispatcher, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'AMORA_ATOMIC_ACTION_HREF_PARITY_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;
END
$amora_atomic_action_href_parity_postconditions$;

COMMIT;
