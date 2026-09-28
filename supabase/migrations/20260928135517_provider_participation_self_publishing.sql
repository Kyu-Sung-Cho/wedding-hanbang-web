-- Independent provider participation. Does not alter or write legacy vendors.
-- Apply only through the repository release controller after the separate
-- provider_portfolio_service_only Storage owner operation has been verified.
BEGIN;

CREATE SCHEMA IF NOT EXISTS provider_private;
REVOKE ALL ON SCHEMA provider_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA provider_private TO authenticated;

DO $fence$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
      AND policyname='provider_portfolio_service_only' AND permissive='RESTRICTIVE'
      AND cmd='ALL' AND roles @> ARRAY['anon','authenticated']::name[]
      AND qual = '(bucket_id <> ''provider-portfolio''::text)'
      AND with_check = '(bucket_id <> ''provider-portfolio''::text)'
  ) THEN RAISE EXCEPTION 'PROVIDER_STORAGE_FENCE_REQUIRED'; END IF;
END $fence$;

INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('provider-portfolio','provider-portfolio',false,5242880,
  ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;
DO $bucket$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='provider-portfolio'
    AND public=false AND file_size_limit=5242880
    AND allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp'])
  THEN RAISE EXCEPTION 'PROVIDER_STORAGE_BUCKET_CONFLICT'; END IF;
END $bucket$;

CREATE TABLE public.provider_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('individual','team','company')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  categories text[] NOT NULL CHECK (cardinality(categories) BETWEEN 1 AND 10),
  regions text[] NOT NULL CHECK (cardinality(regions) BETWEEN 1 AND 20),
  introduction text NOT NULL DEFAULT '' CHECK (length(introduction)<=5000),
  website text, instagram text,
  contact_name text NOT NULL CHECK (length(btrim(contact_name)) BETWEEN 1 AND 100),
  contact_email text NOT NULL,
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected','suspended')),
  publication_status text NOT NULL DEFAULT 'draft' CHECK (publication_status IN ('draft','published','paused')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_reason text, approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (publication_status <> 'published' OR approval_status='approved')
);
CREATE INDEX provider_profiles_owner_idx ON public.provider_profiles(owner_id);
CREATE INDEX provider_profiles_public_idx ON public.provider_profiles(updated_at DESC,id)
  WHERE approval_status='approved' AND publication_status='published';

CREATE TABLE public.provider_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL UNIQUE REFERENCES public.provider_profiles(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL, name text NOT NULL, categories text[] NOT NULL, regions text[] NOT NULL,
  contact_name text NOT NULL, contact_email text NOT NULL,
  request_id uuid NOT NULL,
  submission_payload jsonb NOT NULL,
  application_note text NOT NULL DEFAULT '', consents jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','changes_requested','approved','rejected')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  review_reason text, reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,request_id)
);
CREATE TABLE public.provider_offerings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.provider_profiles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  category text NOT NULL,
  description text NOT NULL DEFAULT '' CHECK (length(description)<=5000),
  base_price_krw integer NOT NULL CHECK (base_price_krw BETWEEN 0 AND 1000000000),
  price_unit text NOT NULL CHECK (length(btrim(price_unit)) BETWEEN 1 AND 80),
  includes text[] NOT NULL DEFAULT '{}',
  extra_charges text NOT NULL CHECK (length(btrim(extra_charges)) BETWEEN 1 AND 3000),
  conditions text NOT NULL CHECK (length(btrim(conditions)) BETWEEN 1 AND 5000),
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
  recommendation_status text NOT NULL DEFAULT 'unreviewed' CHECK (recommendation_status IN ('unreviewed','eligible','needs_review','blocked')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  review_reason text, reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (recommendation_status <> 'eligible' OR review_status='approved')
);
CREATE INDEX provider_offerings_profile_idx ON public.provider_offerings(provider_id);
CREATE TABLE public.provider_media (
  id uuid PRIMARY KEY,
  provider_id uuid NOT NULL REFERENCES public.provider_profiles(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','ready','removed')),
  caption text NOT NULL DEFAULT '' CHECK (length(caption)<=500),
  alt_text text NOT NULL DEFAULT '' CHECK (length(alt_text)<=300),
  sort_order integer NOT NULL DEFAULT 0,
  rights_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'ready' OR rights_confirmed_at IS NOT NULL)
);
CREATE INDEX provider_media_profile_idx ON public.provider_media(provider_id,status);
CREATE TABLE public.business_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL, submission_payload jsonb NOT NULL,
  kind text NOT NULL CHECK (kind IN ('collaboration','media','data','other')),
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 1 AND 200),
  message text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 5000),
  contact_name text NOT NULL CHECK (length(btrim(contact_name)) BETWEEN 1 AND 100),
  contact_email text NOT NULL, privacy_consented_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','reviewing','responded','closed')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0), reply text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,request_id)
);
CREATE TABLE public.provider_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid REFERENCES public.provider_profiles(id) ON DELETE CASCADE,
  inquiry_id uuid REFERENCES public.business_inquiries(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL, subject_id uuid, detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_audit_events_provider_idx ON public.provider_audit_events(provider_id);
CREATE INDEX provider_audit_events_inquiry_idx ON public.provider_audit_events(inquiry_id);

CREATE FUNCTION provider_private.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_admin=true);
$$;
CREATE FUNCTION provider_private.owns(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.provider_profiles WHERE id=p_id AND owner_id=auth.uid());
$$;
CREATE FUNCTION provider_private.has_signup_consent(p_user_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e jsonb; r jsonb; t text;
BEGIN
  SELECT raw_app_meta_data->'signup_consent' INTO e FROM auth.users WHERE id=p_user_id;
  r:=e->'record'; t:=r->>'consent_agreed_at';
  IF e->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR e->>'source' IS DISTINCT FROM 'hanbang_auth_server'
    OR jsonb_typeof(r) IS DISTINCT FROM 'object'
    OR r->'terms_agreed' IS DISTINCT FROM 'true'::jsonb OR r->'privacy_agreed' IS DISTINCT FROM 'true'::jsonb
    OR r->'age_over_14_confirmed' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(r->'marketing_agreed') IS DISTINCT FROM 'boolean'
    OR coalesce(r->>'consent_policy_version','') !~ '^\d{4}-\d{2}-\d{2}$'
    OR coalesce(t,'') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  THEN RETURN false; END IF;
  RETURN to_char(t::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=t;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;
CREATE FUNCTION provider_private.require_actor() RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid := auth.uid();
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'PROVIDER_AUTH_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_id::text,0));
  IF EXISTS(SELECT 1 FROM public.account_deletion_jobs WHERE user_id=v_id AND status<>'completed')
  THEN RAISE EXCEPTION 'PROVIDER_ACCOUNT_DELETION_PENDING'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=v_id AND email_confirmed_at IS NOT NULL
    AND nullif(btrim(email),'') IS NOT NULL AND (banned_until IS NULL OR banned_until<=now()))
  THEN RAISE EXCEPTION 'PROVIDER_EMAIL_REQUIRED'; END IF;
  IF NOT provider_private.has_signup_consent(v_id) THEN RAISE EXCEPTION 'PROVIDER_CONSENT_REQUIRED'; END IF;
  RETURN v_id;
END $$;
CREATE FUNCTION provider_private.require_admin() RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid := provider_private.require_actor();
BEGIN
  IF NOT provider_private.is_admin() THEN RAISE EXCEPTION 'PROVIDER_FORBIDDEN'; END IF;
  RETURN v_actor;
END $$;
CREATE FUNCTION provider_private.keys(p_input jsonb,p_keys text[]) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
  IF p_input IS NULL OR jsonb_typeof(p_input)<>'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_input) k WHERE NOT k=ANY(p_keys))
  THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
END $$;
CREATE FUNCTION provider_private.text_value(p_input jsonb,p_key text,p_min int,p_max int) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v_text text;
BEGIN
  IF jsonb_typeof(p_input->p_key) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  v_text := btrim(p_input->>p_key);
  IF length(v_text)<p_min OR length(v_text)>p_max THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  RETURN v_text;
END $$;
CREATE FUNCTION provider_private.text_array(p_value jsonb,p_min int,p_max int,p_item_max int DEFAULT 100) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v_result text[];
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_value) x WHERE jsonb_typeof(x)<>'string'
    OR length(btrim(x#>>'{}')) NOT BETWEEN 1 AND p_item_max)
  THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  SELECT coalesce(array_agg(DISTINCT btrim(x)), '{}'::text[]) INTO v_result FROM jsonb_array_elements_text(p_value) x;
  IF cardinality(v_result)<p_min OR cardinality(v_result)>p_max THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  RETURN v_result;
END $$;
CREATE FUNCTION provider_private.validate_application(p_input jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
  PERFORM provider_private.keys(p_input,ARRAY['kind','name','categories','regions','contact_name','application_note','consents']);
  IF (p_input->>'kind') IS NULL OR (p_input->>'kind') NOT IN ('individual','team','company')
  THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  PERFORM provider_private.text_value(p_input,'name',1,120);
  PERFORM provider_private.text_value(p_input,'contact_name',1,100);
  PERFORM provider_private.text_value(p_input,'application_note',0,3000);
  PERFORM provider_private.text_array(p_input->'categories',1,10);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_input->'categories') c WHERE c NOT IN
    ('photography','videography','hair_makeup','hair_styling','floral','mc','directing','venue','catering','other'))
  THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  PERFORM provider_private.text_array(p_input->'regions',1,20);
  PERFORM provider_private.keys(p_input->'consents',ARRAY['privacy','price_transparency','extra_charges','standard_terms','version']);
  IF p_input->'consents'->'privacy' IS DISTINCT FROM 'true'::jsonb
    OR p_input->'consents'->'price_transparency' IS DISTINCT FROM 'true'::jsonb
    OR p_input->'consents'->'extra_charges' IS DISTINCT FROM 'true'::jsonb
    OR p_input->'consents'->'standard_terms' IS DISTINCT FROM 'true'::jsonb
    OR p_input->'consents'->'version' IS DISTINCT FROM '"2026-09-28"'::jsonb
  THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
END $$;
CREATE FUNCTION provider_private.audit(p_provider uuid,p_actor uuid,p_event text,p_subject uuid,p_detail jsonb DEFAULT '{}') RETURNS void
LANGUAGE sql SET search_path='' AS $$
  INSERT INTO public.provider_audit_events(provider_id,inquiry_id,actor_id,event_type,subject_id,detail)
  VALUES(p_provider,CASE WHEN p_event IN ('business_inquiry_submitted','business_inquiry_reviewed') THEN p_subject ELSE NULL END,p_actor,p_event,p_subject,p_detail);
$$;

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['provider_profiles','provider_applications','provider_offerings','provider_media','business_inquiries','provider_audit_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role',t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated,service_role',t);
  END LOOP;
END $rls$;
CREATE POLICY provider_profile_private_read ON public.provider_profiles FOR SELECT TO authenticated
  USING(owner_id=auth.uid() OR provider_private.is_admin());
CREATE POLICY provider_application_private_read ON public.provider_applications FOR SELECT TO authenticated
  USING(owner_id=auth.uid() OR provider_private.is_admin());
CREATE POLICY provider_offering_private_read ON public.provider_offerings FOR SELECT TO authenticated
  USING(provider_private.owns(provider_id) OR provider_private.is_admin());
CREATE POLICY provider_media_private_read ON public.provider_media FOR SELECT TO authenticated
  USING(provider_private.owns(provider_id) OR provider_private.is_admin());
CREATE POLICY business_inquiry_private_read ON public.business_inquiries FOR SELECT TO authenticated
  USING(owner_id=auth.uid() OR provider_private.is_admin());
CREATE POLICY provider_audit_admin_read ON public.provider_audit_events FOR SELECT TO authenticated
  USING(provider_private.is_admin());

CREATE FUNCTION public.provider_submit_application(p_input jsonb,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=provider_private.require_actor(); v_profile uuid; v_app public.provider_applications;
BEGIN
  PERFORM provider_private.validate_application(p_input);
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('provider-application:'||v_actor::text,0));
  SELECT * INTO v_app FROM public.provider_applications WHERE owner_id=v_actor AND request_id=p_request_id;
  IF FOUND THEN
    IF v_app.submission_payload<>p_input THEN RAISE EXCEPTION 'PROVIDER_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN jsonb_build_object('provider_id',v_app.provider_id,'application_id',v_app.id,'status',v_app.status);
  END IF;
  IF (SELECT count(*) FROM public.provider_profiles WHERE owner_id=v_actor)>=10 THEN RAISE EXCEPTION 'PROVIDER_INVALID_STATE'; END IF;
  INSERT INTO public.provider_profiles(owner_id,kind,name,categories,regions,contact_name,contact_email)
  SELECT v_actor,p_input->>'kind',btrim(p_input->>'name'),provider_private.text_array(p_input->'categories',1,10),
    provider_private.text_array(p_input->'regions',1,20),btrim(p_input->>'contact_name'),u.email FROM auth.users u WHERE u.id=v_actor
  RETURNING id INTO v_profile;
  INSERT INTO public.provider_applications(provider_id,owner_id,request_id,submission_payload,application_note,consents,
    kind,name,categories,regions,contact_name,contact_email)
  SELECT v_profile,v_actor,p_request_id,p_input,p_input->>'application_note',p_input->'consents',
    p.kind,p.name,p.categories,p.regions,p.contact_name,p.contact_email FROM public.provider_profiles p WHERE p.id=v_profile RETURNING * INTO v_app;
  PERFORM provider_private.audit(v_profile,v_actor,'application_submitted',v_app.id);
  RETURN jsonb_build_object('provider_id',v_profile,'application_id',v_app.id,'status',v_app.status);
END $$;

CREATE FUNCTION public.provider_resubmit_application(p_application_id uuid,p_expected_version int,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=provider_private.require_actor(); a public.provider_applications; p public.provider_profiles;
BEGIN
  PERFORM provider_private.validate_application(p_input);
  SELECT * INTO a FROM public.provider_applications WHERE id=p_application_id AND owner_id=v_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND'; END IF;
  SELECT * INTO p FROM public.provider_profiles WHERE id=a.provider_id FOR UPDATE;
  SELECT * INTO a FROM public.provider_applications WHERE id=p_application_id FOR UPDATE;
  IF a.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'PROVIDER_VERSION_CONFLICT'; END IF;
  IF a.status NOT IN ('changes_requested','rejected') OR p.approval_status='suspended' THEN RAISE EXCEPTION 'PROVIDER_INVALID_STATE'; END IF;
  UPDATE public.provider_profiles SET kind=p_input->>'kind',name=btrim(p_input->>'name'),
    categories=provider_private.text_array(p_input->'categories',1,10),regions=provider_private.text_array(p_input->'regions',1,20),
    contact_name=btrim(p_input->>'contact_name'),contact_email=(SELECT email FROM auth.users WHERE id=v_actor),
    approval_status='pending',publication_status='draft',version=version+1,updated_at=now() WHERE id=p.id;
  UPDATE public.provider_applications SET submission_payload=p_input,application_note=p_input->>'application_note',
    kind=p_input->>'kind',name=btrim(p_input->>'name'),categories=provider_private.text_array(p_input->'categories',1,10),
    regions=provider_private.text_array(p_input->'regions',1,20),contact_name=btrim(p_input->>'contact_name'),
    contact_email=(SELECT email FROM auth.users WHERE id=v_actor),
    consents=p_input->'consents',status='pending',review_reason=NULL,reviewed_by=NULL,reviewed_at=NULL,
    version=version+1,updated_at=now() WHERE id=a.id RETURNING * INTO a;
  PERFORM provider_private.audit(p.id,v_actor,'application_resubmitted',a.id);
  RETURN to_jsonb(a);
END $$;

CREATE FUNCTION public.provider_get_workspace() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=provider_private.require_actor();
BEGIN
  RETURN jsonb_build_object(
    'profiles',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC) FROM public.provider_profiles p WHERE owner_id=v_actor),'[]'::jsonb),
    'applications',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM public.provider_applications a WHERE owner_id=v_actor),'[]'::jsonb),
    'offerings',coalesce((SELECT jsonb_agg(to_jsonb(o)) FROM (SELECT o.* FROM public.provider_offerings o JOIN public.provider_profiles p ON p.id=o.provider_id WHERE p.owner_id=v_actor ORDER BY o.updated_at DESC LIMIT 100) o),'[]'::jsonb),
    'media',coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM (SELECT m.* FROM public.provider_media m JOIN public.provider_profiles p ON p.id=m.provider_id WHERE p.owner_id=v_actor AND m.status='ready' ORDER BY m.sort_order,m.created_at LIMIT 100) m),'[]'::jsonb),
    'business_inquiries',coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM (SELECT * FROM public.business_inquiries WHERE owner_id=v_actor ORDER BY created_at DESC LIMIT 100) b),'[]'::jsonb));
END $$;
CREATE FUNCTION public.provider_admin_workspace() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM provider_private.require_admin();
  RETURN jsonb_build_object(
    'profiles',coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM (SELECT * FROM public.provider_profiles ORDER BY updated_at DESC LIMIT 100) p),'[]'::jsonb),
    'applications',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM (SELECT * FROM public.provider_applications ORDER BY updated_at DESC LIMIT 100) a),'[]'::jsonb),
    'offerings',coalesce((SELECT jsonb_agg(to_jsonb(o)) FROM (SELECT * FROM public.provider_offerings ORDER BY updated_at DESC LIMIT 100) o),'[]'::jsonb),
    'media',coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM (SELECT * FROM public.provider_media WHERE status='ready' ORDER BY updated_at DESC LIMIT 100) m),'[]'::jsonb),
    'business_inquiries',coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM (SELECT * FROM public.business_inquiries ORDER BY updated_at DESC LIMIT 100) b),'[]'::jsonb));
END $$;

CREATE FUNCTION public.provider_update_profile(p_provider_id uuid,p_expected_version int,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=provider_private.require_actor(); p public.provider_profiles; v_intro text; v_web text; v_inst text;
BEGIN
  PERFORM provider_private.keys(p_input,ARRAY['introduction','website','instagram']);
  v_intro:=provider_private.text_value(p_input,'introduction',0,5000);
  v_web:=nullif(provider_private.text_value(p_input,'website',0,500),'');
  v_inst:=nullif(provider_private.text_value(p_input,'instagram',0,500),'');
  IF (v_web IS NOT NULL AND v_web !~ '^https://[^[:space:]@]+$')
    OR (v_inst IS NOT NULL AND v_inst !~ '^https://(www\.)?instagram\.com/[^[:space:]@]*$')
  THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  SELECT * INTO p FROM public.provider_profiles WHERE id=p_provider_id AND owner_id=v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND'; END IF;
  IF p.approval_status<>'approved' THEN RAISE EXCEPTION 'PROVIDER_NOT_APPROVED'; END IF;
  IF p.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'PROVIDER_VERSION_CONFLICT'; END IF;
  UPDATE public.provider_profiles SET introduction=v_intro,website=v_web,instagram=v_inst,version=version+1,updated_at=now()
    WHERE id=p.id RETURNING * INTO p;
  PERFORM provider_private.audit(p.id,v_actor,'profile_updated',p.id,jsonb_build_object('version',p.version));
  RETURN to_jsonb(p);
END $$;
CREATE FUNCTION public.provider_set_publication(p_provider_id uuid,p_expected_version int,p_status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=provider_private.require_actor(); p public.provider_profiles;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('draft','published','paused') THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  SELECT * INTO p FROM public.provider_profiles WHERE id=p_provider_id AND owner_id=v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND'; END IF;
  IF p.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'PROVIDER_VERSION_CONFLICT'; END IF;
  IF p_status='published' AND p.approval_status<>'approved' THEN RAISE EXCEPTION 'PROVIDER_NOT_APPROVED'; END IF;
  UPDATE public.provider_profiles SET publication_status=p_status,version=version+1,updated_at=now() WHERE id=p.id RETURNING * INTO p;
  PERFORM provider_private.audit(p.id,v_actor,'publication_changed',p.id,jsonb_build_object('status',p_status));
  RETURN to_jsonb(p);
END $$;

CREATE FUNCTION public.provider_review_application(p_application_id uuid,p_expected_version int,p_action text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=provider_private.require_admin(); a public.provider_applications; p public.provider_profiles;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('approve','reject','request_changes') OR length(p_reason)>2000
    OR (p_action<>'approve' AND nullif(btrim(p_reason),'') IS NULL)
  THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  SELECT * INTO a FROM public.provider_applications WHERE id=p_application_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND'; END IF;
  SELECT * INTO p FROM public.provider_profiles WHERE id=a.provider_id FOR UPDATE;
  SELECT * INTO a FROM public.provider_applications WHERE id=p_application_id FOR UPDATE;
  IF a.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'PROVIDER_VERSION_CONFLICT'; END IF;
  IF a.status<>'pending' OR p.approval_status='suspended' THEN RAISE EXCEPTION 'PROVIDER_INVALID_STATE'; END IF;
  UPDATE public.provider_applications SET status=CASE p_action WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'changes_requested' END,
    review_reason=nullif(btrim(p_reason),''),reviewed_by=v_actor,reviewed_at=now(),version=version+1,updated_at=now() WHERE id=a.id RETURNING * INTO a;
  UPDATE public.provider_profiles SET approval_status=CASE p_action WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'pending' END,
    publication_status='draft',reviewed_by=v_actor,review_reason=nullif(btrim(p_reason),''),approved_at=CASE WHEN p_action='approve' THEN now() ELSE NULL END,
    version=version+1,updated_at=now() WHERE id=p.id;
  PERFORM provider_private.audit(p.id,v_actor,'application_'||p_action,a.id,jsonb_build_object('version',a.version));
  RETURN to_jsonb(a);
END $$;
CREATE FUNCTION public.provider_suspend_profile(p_provider_id uuid,p_expected_version int,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=provider_private.require_admin(); p public.provider_profiles;
BEGIN
  IF nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  SELECT * INTO p FROM public.provider_profiles WHERE id=p_provider_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND'; END IF;
  IF p.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'PROVIDER_VERSION_CONFLICT'; END IF;
  UPDATE public.provider_profiles SET approval_status='suspended',publication_status='paused',review_reason=btrim(p_reason),
    reviewed_by=v_actor,version=version+1,updated_at=now() WHERE id=p.id RETURNING * INTO p;
  UPDATE public.provider_offerings SET recommendation_status='blocked',version=version+1,updated_at=now() WHERE provider_id=p.id;
  PERFORM provider_private.audit(p.id,v_actor,'profile_suspended',p.id);
  RETURN to_jsonb(p);
END $$;
CREATE FUNCTION public.provider_restore_profile(p_provider_id uuid,p_expected_version int,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=provider_private.require_admin(); p public.provider_profiles;
BEGIN
  IF nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>2000 THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  SELECT * INTO p FROM public.provider_profiles WHERE id=p_provider_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND'; END IF;
  IF p.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'PROVIDER_VERSION_CONFLICT'; END IF;
  IF p.approval_status<>'suspended' OR p.approved_at IS NULL THEN RAISE EXCEPTION 'PROVIDER_INVALID_STATE'; END IF;
  UPDATE public.provider_profiles SET approval_status='approved',publication_status='paused',review_reason=btrim(p_reason),
    reviewed_by=v_actor,version=version+1,updated_at=now() WHERE id=p.id RETURNING * INTO p;
  PERFORM provider_private.audit(p.id,v_actor,'profile_restored',p.id);
  RETURN to_jsonb(p);
END $$;

CREATE FUNCTION public.provider_save_offering(p_provider_id uuid,p_offering_id uuid,p_expected_version int,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=provider_private.require_actor(); p public.provider_profiles; o public.provider_offerings; v_price numeric;
BEGIN
  PERFORM provider_private.keys(p_input,ARRAY['name','category','description','base_price_krw','price_unit','includes','extra_charges','conditions']);
  PERFORM provider_private.text_value(p_input,'name',1,120); PERFORM provider_private.text_value(p_input,'category',1,100);
  PERFORM provider_private.text_value(p_input,'description',0,5000); PERFORM provider_private.text_value(p_input,'price_unit',1,80);
  PERFORM provider_private.text_value(p_input,'extra_charges',1,3000); PERFORM provider_private.text_value(p_input,'conditions',1,5000);
  PERFORM provider_private.text_array(p_input->'includes',0,30,200);
  IF jsonb_typeof(p_input->'base_price_krw') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  v_price:=(p_input->>'base_price_krw')::numeric;
  IF v_price<>trunc(v_price) OR v_price<0 OR v_price>1000000000 THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  SELECT * INTO p FROM public.provider_profiles WHERE id=p_provider_id AND owner_id=v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND'; END IF;
  IF p.approval_status<>'approved' THEN RAISE EXCEPTION 'PROVIDER_NOT_APPROVED'; END IF;
  IF NOT (p_input->>'category')=ANY(p.categories) THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  IF p_offering_id IS NULL THEN
    IF p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
    IF (SELECT count(*) FROM public.provider_offerings WHERE provider_id=p.id)>=30 THEN RAISE EXCEPTION 'PROVIDER_INVALID_STATE'; END IF;
    INSERT INTO public.provider_offerings(provider_id,name,category,description,base_price_krw,price_unit,includes,extra_charges,conditions)
    VALUES(p.id,btrim(p_input->>'name'),p_input->>'category',p_input->>'description',v_price::int,btrim(p_input->>'price_unit'),
      provider_private.text_array(p_input->'includes',0,30,200),btrim(p_input->>'extra_charges'),btrim(p_input->>'conditions')) RETURNING * INTO o;
  ELSE
    SELECT * INTO o FROM public.provider_offerings WHERE id=p_offering_id AND provider_id=p.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND'; END IF;
    IF o.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'PROVIDER_VERSION_CONFLICT'; END IF;
    UPDATE public.provider_offerings SET name=btrim(p_input->>'name'),category=p_input->>'category',description=p_input->>'description',
      base_price_krw=v_price::int,price_unit=btrim(p_input->>'price_unit'),includes=provider_private.text_array(p_input->'includes',0,30,200),
      extra_charges=btrim(p_input->>'extra_charges'),conditions=btrim(p_input->>'conditions'),review_status='pending',
      recommendation_status='needs_review',reviewed_by=NULL,reviewed_at=NULL,review_reason=NULL,version=version+1,updated_at=now()
      WHERE id=o.id RETURNING * INTO o;
  END IF;
  PERFORM provider_private.audit(p.id,v_actor,'offering_submitted',o.id,jsonb_build_object('version',o.version));
  RETURN to_jsonb(o);
END $$;
CREATE FUNCTION public.provider_review_offering(p_offering_id uuid,p_expected_version int,p_action text,p_recommendation_status text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=provider_private.require_admin(); p public.provider_profiles; o public.provider_offerings;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('approve','reject') OR p_recommendation_status IS NULL
    OR p_recommendation_status NOT IN ('unreviewed','eligible','blocked') OR (p_action='reject' AND p_recommendation_status='eligible')
    OR (p_action='reject' AND nullif(btrim(p_reason),'') IS NULL) OR length(p_reason)>2000 THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  SELECT * INTO o FROM public.provider_offerings WHERE id=p_offering_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND'; END IF;
  SELECT * INTO p FROM public.provider_profiles WHERE id=o.provider_id FOR UPDATE;
  SELECT * INTO o FROM public.provider_offerings WHERE id=p_offering_id FOR UPDATE;
  IF p.approval_status<>'approved' THEN RAISE EXCEPTION 'PROVIDER_NOT_APPROVED'; END IF;
  IF o.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'PROVIDER_VERSION_CONFLICT'; END IF;
  UPDATE public.provider_offerings SET review_status=CASE WHEN p_action='approve' THEN 'approved' ELSE 'rejected' END,
    recommendation_status=p_recommendation_status,review_reason=nullif(btrim(p_reason),''),reviewed_by=v_actor,reviewed_at=now(),
    version=version+1,updated_at=now() WHERE id=o.id RETURNING * INTO o;
  PERFORM provider_private.audit(p.id,v_actor,'offering_reviewed',o.id,jsonb_build_object('version',o.version,'recommendation_status',o.recommendation_status));
  RETURN to_jsonb(o);
END $$;

CREATE FUNCTION public.provider_register_media_upload(p_provider_id uuid,p_owner_id uuid,p_mime_type text,p_byte_size int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.provider_profiles; m public.provider_media; v_id uuid:=gen_random_uuid(); v_suffix text;
BEGIN
  -- Only service_role receives EXECUTE; no browser can attest bytes or choose paths.
  IF p_mime_type IS NULL OR p_mime_type NOT IN ('image/jpeg','image/png','image/webp')
    OR p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 5242880 THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  IF p_owner_id IS NULL THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text,0));
  IF EXISTS(SELECT 1 FROM public.account_deletion_jobs WHERE user_id=p_owner_id AND status<>'completed')
  THEN RAISE EXCEPTION 'PROVIDER_ACCOUNT_DELETION_PENDING'; END IF;
  SELECT * INTO p FROM public.provider_profiles WHERE id=p_provider_id AND owner_id=p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND'; END IF;
  IF p.approval_status<>'approved' THEN RAISE EXCEPTION 'PROVIDER_NOT_APPROVED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_owner_id AND email_confirmed_at IS NOT NULL
    AND (banned_until IS NULL OR banned_until<=now())) THEN RAISE EXCEPTION 'PROVIDER_EMAIL_REQUIRED'; END IF;
  IF NOT provider_private.has_signup_consent(p_owner_id) THEN RAISE EXCEPTION 'PROVIDER_CONSENT_REQUIRED'; END IF;
  UPDATE public.provider_media SET status='removed',updated_at=now()
    WHERE provider_id=p.id AND status='uploading' AND created_at<now()-interval '30 minutes';
  IF (SELECT count(*) FROM public.provider_media WHERE provider_id=p.id AND status<>'removed')>=12 THEN RAISE EXCEPTION 'PROVIDER_MEDIA_LIMIT'; END IF;
  v_suffix:=CASE p_mime_type WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' ELSE 'webp' END;
  INSERT INTO public.provider_media(id,provider_id,storage_path,mime_type,byte_size,sort_order)
  VALUES(v_id,p.id,p_owner_id::text||'/'||p.id::text||'/'||v_id::text||'.'||v_suffix,p_mime_type,p_byte_size,
    coalesce((SELECT max(sort_order)+1 FROM public.provider_media WHERE provider_id=p.id),0)) RETURNING * INTO m;
  PERFORM provider_private.audit(p.id,p_owner_id,'media_upload_registered',m.id);
  RETURN to_jsonb(m);
END $$;
CREATE FUNCTION public.provider_abort_media_upload(p_media_id uuid,p_owner_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.provider_profiles; m public.provider_media;
BEGIN
  SELECT * INTO m FROM public.provider_media WHERE id=p_media_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND'; END IF;
  SELECT * INTO p FROM public.provider_profiles WHERE id=m.provider_id AND owner_id=p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND'; END IF;
  SELECT * INTO m FROM public.provider_media WHERE id=p_media_id FOR UPDATE;
  IF m.status='ready' THEN RETURN jsonb_build_object('aborted',false,'storage_path',NULL); END IF;
  IF m.status='uploading' THEN
    UPDATE public.provider_media SET status='removed',updated_at=now() WHERE id=m.id;
    PERFORM provider_private.audit(p.id,p_owner_id,'media_upload_aborted',m.id);
  END IF;
  RETURN jsonb_build_object('aborted',true,'storage_path',m.storage_path);
END $$;
CREATE FUNCTION public.provider_finalize_media(p_media_id uuid,p_caption text,p_alt_text text,p_rights_confirmed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=provider_private.require_actor(); p public.provider_profiles; m public.provider_media;
BEGIN
  IF p_rights_confirmed IS DISTINCT FROM true OR p_caption IS NULL OR length(p_caption)>500 OR p_alt_text IS NULL OR length(p_alt_text)>300
  THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  SELECT * INTO m FROM public.provider_media WHERE id=p_media_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND'; END IF;
  SELECT * INTO p FROM public.provider_profiles WHERE id=m.provider_id AND owner_id=v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND'; END IF;
  SELECT * INTO m FROM public.provider_media WHERE id=p_media_id FOR UPDATE;
  IF p.approval_status<>'approved' THEN RAISE EXCEPTION 'PROVIDER_NOT_APPROVED'; END IF;
  IF m.status NOT IN ('uploading','ready') THEN RAISE EXCEPTION 'PROVIDER_INVALID_STATE'; END IF;
  IF m.status='uploading' AND m.created_at<now()-interval '30 minutes' THEN RAISE EXCEPTION 'PROVIDER_INVALID_STATE'; END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='provider-portfolio' AND name=m.storage_path)
  THEN RAISE EXCEPTION 'PROVIDER_MEDIA_NOT_UPLOADED'; END IF;
  UPDATE public.provider_media SET status='ready',caption=btrim(p_caption),alt_text=btrim(p_alt_text),rights_confirmed_at=now(),updated_at=now()
    WHERE id=m.id RETURNING * INTO m;
  PERFORM provider_private.audit(p.id,v_actor,'media_published',m.id);
  RETURN to_jsonb(m);
END $$;
CREATE FUNCTION public.provider_remove_media(p_media_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=provider_private.require_actor(); p public.provider_profiles; m public.provider_media;
BEGIN
  SELECT * INTO m FROM public.provider_media WHERE id=p_media_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND'; END IF;
  SELECT * INTO p FROM public.provider_profiles WHERE id=m.provider_id FOR UPDATE;
  IF p.owner_id<>v_actor AND NOT provider_private.is_admin() THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND'; END IF;
  SELECT * INTO m FROM public.provider_media WHERE id=p_media_id FOR UPDATE;
  IF m.status<>'removed' THEN
    UPDATE public.provider_media SET status='removed',updated_at=now() WHERE id=m.id;
    PERFORM provider_private.audit(p.id,v_actor,'media_removed',m.id);
  END IF;
  RETURN jsonb_build_object('id',m.id,'storage_path',m.storage_path);
END $$;

CREATE FUNCTION public.provider_submit_business_inquiry(p_input jsonb,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=provider_private.require_actor(); b public.business_inquiries;
BEGIN
  PERFORM provider_private.keys(p_input,ARRAY['kind','subject','message','contact_name','privacy_consent']);
  IF p_request_id IS NULL OR p_input->>'kind' IS NULL OR p_input->>'kind' NOT IN ('collaboration','media','data','other')
    OR p_input->'privacy_consent' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  PERFORM provider_private.text_value(p_input,'subject',1,200); PERFORM provider_private.text_value(p_input,'message',1,5000);
  PERFORM provider_private.text_value(p_input,'contact_name',1,100);
  PERFORM pg_advisory_xact_lock(hashtextextended('business-inquiry:'||v_actor::text,0));
  SELECT * INTO b FROM public.business_inquiries WHERE owner_id=v_actor AND request_id=p_request_id;
  IF FOUND THEN
    IF b.submission_payload<>p_input THEN RAISE EXCEPTION 'PROVIDER_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN to_jsonb(b);
  END IF;
  IF (SELECT count(*) FROM public.business_inquiries WHERE owner_id=v_actor AND created_at>now()-interval '1 day')>=10
  THEN RAISE EXCEPTION 'PROVIDER_INVALID_STATE'; END IF;
  INSERT INTO public.business_inquiries(owner_id,request_id,submission_payload,kind,subject,message,contact_name,contact_email)
  SELECT v_actor,p_request_id,p_input,p_input->>'kind',btrim(p_input->>'subject'),btrim(p_input->>'message'),btrim(p_input->>'contact_name'),email
  FROM auth.users WHERE id=v_actor RETURNING * INTO b;
  PERFORM provider_private.audit(NULL,v_actor,'business_inquiry_submitted',b.id);
  RETURN to_jsonb(b);
END $$;
CREATE FUNCTION public.provider_review_business_inquiry(p_inquiry_id uuid,p_expected_version int,p_status text,p_reply text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=provider_private.require_admin(); b public.business_inquiries;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('received','reviewing','responded','closed') OR p_reply IS NULL OR length(p_reply)>5000
    OR (p_status='responded' AND nullif(btrim(p_reply),'') IS NULL) THEN RAISE EXCEPTION 'PROVIDER_INVALID_INPUT'; END IF;
  SELECT * INTO b FROM public.business_inquiries WHERE id=p_inquiry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_NOT_FOUND'; END IF;
  IF b.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'PROVIDER_VERSION_CONFLICT'; END IF;
  UPDATE public.business_inquiries SET status=p_status,reply=nullif(btrim(p_reply),''),reviewed_by=v_actor,version=version+1,updated_at=now()
    WHERE id=b.id RETURNING * INTO b;
  PERFORM provider_private.audit(NULL,v_actor,'business_inquiry_reviewed',b.id,jsonb_build_object('status',b.status,'version',b.version));
  RETURN to_jsonb(b);
END $$;

CREATE FUNCTION public.provider_public_catalog(p_provider_id uuid DEFAULT NULL,p_limit int DEFAULT 30) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(item ORDER BY updated_at DESC,id),'[]'::jsonb) FROM (
    SELECT p.updated_at,p.id,jsonb_build_object('id',p.id,'kind',p.kind,'name',p.name,'categories',p.categories,'regions',p.regions,
      'introduction',p.introduction,'website',p.website,'instagram',p.instagram,'updated_at',p.updated_at,
      'offerings',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'provider_id',o.provider_id,'name',o.name,'category',o.category,
        'description',o.description,'base_price_krw',o.base_price_krw,'price_unit',o.price_unit,'includes',o.includes,
        'extra_charges',o.extra_charges,'conditions',o.conditions,'review_status',o.review_status,'recommendation_status',o.recommendation_status,'version',o.version,
        'reviewed_at',o.reviewed_at,'updated_at',o.updated_at) ORDER BY o.created_at)
        FROM public.provider_offerings o WHERE o.provider_id=p.id AND o.review_status='approved'),'[]'::jsonb),
      'media',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'provider_id',m.provider_id,'caption',m.caption,'alt_text',m.alt_text,'sort_order',m.sort_order)
        ORDER BY m.sort_order,m.created_at) FROM public.provider_media m WHERE m.provider_id=p.id AND m.status='ready'),'[]'::jsonb)) AS item
    FROM public.provider_profiles p WHERE p.approval_status='approved' AND p.publication_status='published'
      AND NOT EXISTS(SELECT 1 FROM public.account_deletion_jobs d WHERE d.user_id=p.owner_id AND d.status<>'completed')
      AND (p_provider_id IS NULL OR p.id=p_provider_id)
    ORDER BY p.updated_at DESC,p.id LIMIT greatest(1,least(coalesce(p_limit,30),100))
  ) catalog;
$$;

-- New definer functions are never left callable through PUBLIC's default ACL.
DO $acl$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature,n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='provider_private' OR (n.nspname='public' AND p.proname IN (
      'provider_submit_application','provider_resubmit_application','provider_get_workspace','provider_admin_workspace',
      'provider_update_profile','provider_set_publication','provider_review_application','provider_suspend_profile','provider_restore_profile',
      'provider_save_offering','provider_review_offering','provider_register_media_upload','provider_abort_media_upload','provider_finalize_media','provider_remove_media',
      'provider_submit_business_inquiry','provider_review_business_inquiry','provider_public_catalog'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
    IF f.nspname='public' THEN
      IF f.proname IN ('provider_register_media_upload','provider_abort_media_upload') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
      ELSIF f.proname='provider_public_catalog' THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon,authenticated,service_role',f.signature);
      ELSE EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
      END IF;
    ELSIF f.proname IN ('is_admin','owns') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
    END IF;
  END LOOP;
END $acl$;

COMMENT ON TABLE public.provider_profiles IS 'Reviewed publishing access for individual/team/company profiles; independent of legacy vendors and service recommendation eligibility.';
COMMENT ON FUNCTION public.provider_update_profile(uuid,integer,jsonb) IS 'Approved owners self-publish presentation text; critical service terms use a separate review lifecycle.';
COMMENT ON FUNCTION public.provider_register_media_upload(uuid,uuid,text,integer) IS 'Trusted server only: reserve one of twelve private image slots after byte validation; no client-defined object path.';
COMMIT;
