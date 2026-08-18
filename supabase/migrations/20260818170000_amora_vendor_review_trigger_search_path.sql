BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preconditions$
DECLARE
  v_function_oid oid := to_regprocedure('public.update_vendor_rating()');
  v_definition text;
BEGIN
  IF v_function_oid IS NULL
     OR to_regclass('public.vendors') IS NULL
     OR to_regclass('public.vendor_reviews') IS NULL THEN
    RAISE EXCEPTION 'AMORA_VENDOR_REVIEW_TRIGGER_PREREQUISITE_MISSING';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(procedure.oid)
    INTO v_definition
  FROM pg_catalog.pg_proc AS procedure
  WHERE procedure.oid = v_function_oid
    AND procedure.proowner = 'postgres'::regrole
    AND NOT procedure.prosecdef
    AND procedure.proconfig IS NULL
    AND procedure.pronargs = 0
    AND procedure.prorettype = 'trigger'::regtype;

  IF v_definition IS NULL
     OR v_definition NOT LIKE '%UPDATE vendors SET%'
     OR v_definition NOT LIKE '%FROM vendor_reviews%'
     OR v_definition NOT LIKE '%COALESCE(NEW.vendor_id, OLD.vendor_id)%'
     OR v_definition NOT LIKE '%is_visible = true%'
     OR v_definition LIKE '%public.vendors%'
     OR v_definition LIKE '%public.vendor_reviews%'
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS trigger
       WHERE trigger.tgrelid = 'public.vendor_reviews'::regclass
         AND trigger.tgname = 'update_vendor_rating_on_review'
         AND trigger.tgfoid = v_function_oid
         AND trigger.tgenabled = 'O'
         AND NOT trigger.tgisinternal
     ) THEN
    RAISE EXCEPTION 'AMORA_VENDOR_REVIEW_TRIGGER_PREREQUISITE_DRIFT';
  END IF;
END
$preconditions$;

CREATE OR REPLACE FUNCTION public.update_vendor_rating()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  UPDATE public.vendors AS vendor
     SET rating = (
       SELECT COALESCE(AVG(review.rating)::numeric(2,1), 0)
       FROM public.vendor_reviews AS review
       WHERE review.vendor_id = COALESCE(NEW.vendor_id, OLD.vendor_id)
         AND review.is_visible = true
     ),
         review_count = (
       SELECT COUNT(*)::integer
       FROM public.vendor_reviews AS review
       WHERE review.vendor_id = COALESCE(NEW.vendor_id, OLD.vendor_id)
         AND review.is_visible = true
     )
   WHERE vendor.id = COALESCE(NEW.vendor_id, OLD.vendor_id);
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.update_vendor_rating() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_vendor_rating()
  FROM PUBLIC, anon, authenticated, service_role;

DO $postchecks$
DECLARE
  v_function_oid oid := to_regprocedure('public.update_vendor_rating()');
  v_definition text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(procedure.oid)
    INTO v_definition
  FROM pg_catalog.pg_proc AS procedure
  WHERE procedure.oid = v_function_oid
    AND procedure.proowner = 'postgres'::regrole
    AND NOT procedure.prosecdef
    AND procedure.proconfig = ARRAY['search_path=pg_catalog, public']
    AND procedure.pronargs = 0
    AND procedure.prorettype = 'trigger'::regtype;

  IF v_definition IS NULL
     OR v_definition NOT LIKE '%UPDATE public.vendors AS vendor%'
     OR v_definition NOT LIKE '%FROM public.vendor_reviews AS review%'
     OR v_definition NOT LIKE '%COALESCE(NEW.vendor_id, OLD.vendor_id)%'
     OR v_definition NOT LIKE '%review.is_visible = true%'
     OR has_function_privilege(
       'anon', 'public.update_vendor_rating()', 'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated', 'public.update_vendor_rating()', 'EXECUTE'
     )
     OR has_function_privilege(
       'service_role', 'public.update_vendor_rating()', 'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS trigger
       WHERE trigger.tgrelid = 'public.vendor_reviews'::regclass
         AND trigger.tgname = 'update_vendor_rating_on_review'
         AND trigger.tgfoid = v_function_oid
         AND trigger.tgenabled = 'O'
         AND NOT trigger.tgisinternal
     ) THEN
    RAISE EXCEPTION 'AMORA_VENDOR_REVIEW_TRIGGER_POSTCHECK_FAILED';
  END IF;
END
$postchecks$;

COMMIT;
