-- Defense in depth for every SECURITY DEFINER routine that resolves objects in
-- public: application JWT roles must never be able to replace those objects.
BEGIN;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM anon;
REVOKE CREATE ON SCHEMA public FROM authenticated;
REVOKE CREATE ON SCHEMA public FROM service_role;

DO $public_schema_acl_postcondition$
DECLARE
  v_role name;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon'::name, 'authenticated'::name, 'service_role'::name]
  LOOP
    IF has_schema_privilege(v_role, 'public', 'CREATE') THEN
      RAISE EXCEPTION '% must not retain CREATE on schema public', v_role;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        namespace.nspacl,
        pg_catalog.acldefault('n', namespace.nspowner)
      )
    ) AS privilege
    WHERE namespace.nspname = 'public'
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'CREATE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC must not retain CREATE on schema public';
  END IF;
END
$public_schema_acl_postcondition$;

COMMIT;
