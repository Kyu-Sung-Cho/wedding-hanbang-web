BEGIN;

ALTER TABLE public.vendor_staff
  ADD COLUMN IF NOT EXISTS public_profile_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS public_profile_consent_version text;

DO $add_vendor_staff_consent_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.vendor_staff'::regclass
      AND conname = 'vendor_staff_public_profile_consent_pair'
  ) THEN
    ALTER TABLE public.vendor_staff
      ADD CONSTRAINT vendor_staff_public_profile_consent_pair CHECK (
        (public_profile_consent_at IS NULL AND public_profile_consent_version IS NULL)
        OR (
          public_profile_consent_at IS NOT NULL
          AND public_profile_consent_version ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
        )
      );
  END IF;
END;
$add_vendor_staff_consent_constraint$;

DROP POLICY IF EXISTS "Public can view active staff" ON public.vendor_staff;
CREATE POLICY "Public can view active consented staff"
ON public.vendor_staff
FOR SELECT
TO anon, authenticated
USING (
  is_active = true
  AND public_profile_consent_at IS NOT NULL
  AND public_profile_consent_version = '2026-08-02'
  AND EXISTS (
    SELECT 1
    FROM public.vendors
    WHERE vendors.id = vendor_staff.vendor_id
      AND vendors.status = 'approved'
  )
);

DROP POLICY IF EXISTS "Public can view staff timeslots" ON public.staff_timeslots;
CREATE POLICY "Public can view consented staff timeslots"
ON public.staff_timeslots
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.vendor_staff AS staff
    JOIN public.vendors AS vendor ON vendor.id = staff.vendor_id
    WHERE staff.id = staff_timeslots.staff_id
      AND staff.is_active = true
      AND staff.public_profile_consent_at IS NOT NULL
      AND staff.public_profile_consent_version = '2026-08-02'
      AND vendor.status = 'approved'
  )
);

-- Consent evidence itself is internal. Public clients keep only the previously
-- reviewed staff projection, and RLS decides whether a row may be published.
REVOKE SELECT (public_profile_consent_at, public_profile_consent_version)
ON TABLE public.vendor_staff FROM PUBLIC, anon, authenticated;

DO $verify_vendor_staff_publication_consent$
DECLARE
  staff_policy text;
  timeslot_policy text;
BEGIN
  SELECT pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
  INTO staff_policy
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'public.vendor_staff'::regclass
    AND policy.polname = 'Public can view active consented staff';

  SELECT pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
  INTO timeslot_policy
  FROM pg_catalog.pg_policy AS policy
  WHERE policy.polrelid = 'public.staff_timeslots'::regclass
    AND policy.polname = 'Public can view consented staff timeslots';

  IF staff_policy IS NULL
    OR staff_policy NOT ILIKE '%public_profile_consent_at IS NOT NULL%'
    OR staff_policy NOT ILIKE '%public_profile_consent_version%2026-08-02%'
    OR timeslot_policy IS NULL
    OR timeslot_policy NOT ILIKE '%public_profile_consent_at IS NOT NULL%'
    OR timeslot_policy NOT ILIKE '%public_profile_consent_version%2026-08-02%'
  THEN
    RAISE EXCEPTION 'VENDOR_STAFF_PUBLICATION_CONSENT_POLICY_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$verify_vendor_staff_publication_consent$;

COMMIT;
