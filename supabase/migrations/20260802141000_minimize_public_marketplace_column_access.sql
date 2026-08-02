-- Replace broad marketplace base-table SELECT grants with explicit public
-- projections. Public server APIs already use service_role allow-lists; this
-- closes direct PostgREST reads of reviewer identities, booking identifiers,
-- vendor-only notes, and raw per-slot capacity.

BEGIN;

DO $marketplace_column_preflight$
DECLARE
  missing_column text;
BEGIN
  SELECT format('%I.%I', required.table_name, required.column_name)
  INTO missing_column
  FROM (VALUES
    ('vendor_products', 'id'),
    ('vendor_products', 'vendor_id'),
    ('vendor_products', 'name'),
    ('vendor_products', 'description'),
    ('vendor_products', 'price'),
    ('vendor_products', 'discount_price'),
    ('vendor_products', 'original_price'),
    ('vendor_products', 'duration'),
    ('vendor_products', 'duration_minutes'),
    ('vendor_products', 'is_active'),
    ('vendor_products', 'is_popular'),
    ('vendor_products', 'sort_order'),
    ('vendor_products', 'category_fields'),
    ('vendor_products', 'includes'),
    ('vendor_products', 'excludes'),
    ('vendor_products', 'images'),
    ('vendor_products', 'created_at'),
    ('vendor_products', 'updated_at'),
    ('vendor_reviews', 'id'),
    ('vendor_reviews', 'rating'),
    ('vendor_reviews', 'content'),
    ('vendor_reviews', 'images'),
    ('vendor_reviews', 'reply'),
    ('vendor_reviews', 'replied_at'),
    ('vendor_reviews', 'created_at'),
    ('vendor_staff', 'id'),
    ('vendor_staff', 'vendor_id'),
    ('vendor_staff', 'name'),
    ('vendor_staff', 'role'),
    ('vendor_staff', 'description'),
    ('vendor_images', 'id'),
    ('vendor_images', 'vendor_id'),
    ('vendor_images', 'image_url'),
    ('vendor_images', 'image_type'),
    ('vendor_images', 'sort_order'),
    ('vendor_images', 'product_id'),
    ('vendor_images', 'alt_text'),
    ('vendor_images', 'is_thumbnail'),
    ('vendor_timeslots', 'id'),
    ('vendor_timeslots', 'vendor_id'),
    ('vendor_timeslots', 'day'),
    ('vendor_timeslots', 'hour'),
    ('vendor_timeslots', 'available'),
    ('product_timeslots', 'id'),
    ('product_timeslots', 'product_id'),
    ('product_timeslots', 'day'),
    ('product_timeslots', 'hour'),
    ('product_timeslots', 'available'),
    ('staff_timeslots', 'id'),
    ('staff_timeslots', 'staff_id'),
    ('staff_timeslots', 'day'),
    ('staff_timeslots', 'hour'),
    ('staff_timeslots', 'available')
  ) AS required(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS actual
    WHERE actual.table_schema = 'public'
      AND actual.table_name = required.table_name
      AND actual.column_name = required.column_name
  )
  ORDER BY required.table_name, required.column_name
  LIMIT 1;

  IF missing_column IS NOT NULL THEN
    RAISE EXCEPTION 'MARKETPLACE_PUBLIC_COLUMN_MISSING: %', missing_column
      USING ERRCODE = '55000';
  END IF;
END;
$marketplace_column_preflight$;

DO $remove_broad_marketplace_reads$
DECLARE
  target_table text;
  all_columns text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'vendor_products',
    'vendor_reviews',
    'vendor_staff',
    'vendor_images',
    'vendor_timeslots',
    'product_timeslots',
    'staff_timeslots'
  ]::text[]
  LOOP
    EXECUTE format(
      'REVOKE SELECT ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      target_table
    );

    SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
    INTO all_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = target_table;

    EXECUTE format(
      'REVOKE SELECT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      all_columns,
      target_table
    );
    EXECUTE format(
      'GRANT SELECT ON TABLE public.%I TO service_role',
      target_table
    );
  END LOOP;
END;
$remove_broad_marketplace_reads$;

GRANT SELECT (
  id, vendor_id, name, description, price, discount_price, original_price,
  duration, duration_minutes, is_active, is_popular, sort_order,
  category_fields, includes, excludes, images, created_at, updated_at
) ON TABLE public.vendor_products TO anon, authenticated;

GRANT SELECT (
  id, rating, content, images, reply, replied_at, created_at
) ON TABLE public.vendor_reviews TO anon, authenticated;

GRANT SELECT (
  id, vendor_id, name, role, description
) ON TABLE public.vendor_staff TO anon, authenticated;

GRANT SELECT (
  id, vendor_id, image_url, image_type, sort_order, product_id, alt_text,
  is_thumbnail
) ON TABLE public.vendor_images TO anon, authenticated;

GRANT SELECT (
  id, vendor_id, day, hour, available
) ON TABLE public.vendor_timeslots TO anon, authenticated;

GRANT SELECT (
  id, product_id, day, hour, available
) ON TABLE public.product_timeslots TO anon, authenticated;

GRANT SELECT (
  id, staff_id, day, hour, available
) ON TABLE public.staff_timeslots TO anon, authenticated;

DO $postflight$
DECLARE
  target_table text;
  exposed_column text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'vendor_products',
    'vendor_reviews',
    'vendor_staff',
    'vendor_images',
    'vendor_timeslots',
    'product_timeslots',
    'staff_timeslots'
  ]::text[]
  LOOP
    IF has_table_privilege('anon', format('public.%I', target_table), 'SELECT')
       OR has_table_privilege(
         'authenticated',
         format('public.%I', target_table),
         'SELECT'
       ) THEN
      RAISE EXCEPTION 'MARKETPLACE_BROAD_CLIENT_SELECT_REMAINS: %', target_table
        USING ERRCODE = '55000';
    END IF;

    IF NOT has_table_privilege(
      'service_role',
      format('public.%I', target_table),
      'SELECT'
    ) THEN
      RAISE EXCEPTION 'MARKETPLACE_SERVICE_SELECT_MISSING: %', target_table
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  SELECT format('%I.%I', actual.table_name, actual.column_name)
  INTO exposed_column
  FROM information_schema.columns AS actual
  WHERE actual.table_schema = 'public'
    AND actual.table_name IN (
      'vendor_products',
      'vendor_reviews',
      'vendor_staff',
      'vendor_images',
      'vendor_timeslots',
      'product_timeslots',
      'staff_timeslots'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('vendor_products', 'id'),
        ('vendor_products', 'vendor_id'),
        ('vendor_products', 'name'),
        ('vendor_products', 'description'),
        ('vendor_products', 'price'),
        ('vendor_products', 'discount_price'),
        ('vendor_products', 'original_price'),
        ('vendor_products', 'duration'),
        ('vendor_products', 'duration_minutes'),
        ('vendor_products', 'is_active'),
        ('vendor_products', 'is_popular'),
        ('vendor_products', 'sort_order'),
        ('vendor_products', 'category_fields'),
        ('vendor_products', 'includes'),
        ('vendor_products', 'excludes'),
        ('vendor_products', 'images'),
        ('vendor_products', 'created_at'),
        ('vendor_products', 'updated_at'),
        ('vendor_reviews', 'id'),
        ('vendor_reviews', 'rating'),
        ('vendor_reviews', 'content'),
        ('vendor_reviews', 'images'),
        ('vendor_reviews', 'reply'),
        ('vendor_reviews', 'replied_at'),
        ('vendor_reviews', 'created_at'),
        ('vendor_staff', 'id'),
        ('vendor_staff', 'vendor_id'),
        ('vendor_staff', 'name'),
        ('vendor_staff', 'role'),
        ('vendor_staff', 'description'),
        ('vendor_images', 'id'),
        ('vendor_images', 'vendor_id'),
        ('vendor_images', 'image_url'),
        ('vendor_images', 'image_type'),
        ('vendor_images', 'sort_order'),
        ('vendor_images', 'product_id'),
        ('vendor_images', 'alt_text'),
        ('vendor_images', 'is_thumbnail'),
        ('vendor_timeslots', 'id'),
        ('vendor_timeslots', 'vendor_id'),
        ('vendor_timeslots', 'day'),
        ('vendor_timeslots', 'hour'),
        ('vendor_timeslots', 'available'),
        ('product_timeslots', 'id'),
        ('product_timeslots', 'product_id'),
        ('product_timeslots', 'day'),
        ('product_timeslots', 'hour'),
        ('product_timeslots', 'available'),
        ('staff_timeslots', 'id'),
        ('staff_timeslots', 'staff_id'),
        ('staff_timeslots', 'day'),
        ('staff_timeslots', 'hour'),
        ('staff_timeslots', 'available')
      ) AS allowed(table_name, column_name)
      WHERE allowed.table_name = actual.table_name
        AND allowed.column_name = actual.column_name
    )
    AND (
      has_column_privilege(
        'anon',
        format('public.%I', actual.table_name),
        actual.column_name,
        'SELECT'
      )
      OR has_column_privilege(
        'authenticated',
        format('public.%I', actual.table_name),
        actual.column_name,
        'SELECT'
      )
    )
  ORDER BY actual.table_name, actual.ordinal_position
  LIMIT 1;

  IF exposed_column IS NOT NULL THEN
    RAISE EXCEPTION 'MARKETPLACE_PRIVATE_COLUMN_EXPOSED: %', exposed_column
      USING ERRCODE = '55000';
  END IF;
END;
$postflight$;

COMMIT;
