WITH expected_columns(table_name, column_name, data_type, not_null) AS (
  VALUES
    ('couples', 'id', 'uuid', true),
    ('couples', 'invite_code', 'text', true),
    ('couples', 'bride_id', 'uuid', false),
    ('couples', 'groom_id', 'uuid', false),
    ('couples', 'created_at', 'timestamp with time zone', false),
    ('couples', 'updated_at', 'timestamp with time zone', false),
    ('profiles', 'id', 'uuid', true),
    ('profiles', 'email', 'text', false),
    ('profiles', 'name', 'text', false),
    ('profiles', 'role', 'text', false),
    ('profiles', 'couple_id', 'uuid', false),
    ('profiles', 'created_at', 'timestamp with time zone', false),
    ('profiles', 'updated_at', 'timestamp with time zone', false),
    ('profiles', 'user_type', 'text', false),
    ('profiles', 'consents', 'jsonb', false),
    ('vendors', 'id', 'uuid', true),
    ('vendors', 'name', 'text', true),
    ('vendors', 'category', 'text', true),
    ('vendors', 'region', 'text', true),
    ('vendors', 'address', 'text', false),
    ('vendors', 'phone', 'text', false),
    ('vendors', 'website', 'text', false),
    ('vendors', 'instagram', 'text', false),
    ('vendors', 'description', 'text', false),
    ('vendors', 'style_tags', 'text[]', false),
    ('vendors', 'is_fixed_price', 'boolean', false),
    ('vendors', 'is_verified', 'boolean', false),
    ('vendors', 'rating', 'numeric(2,1)', false),
    ('vendors', 'review_count', 'integer', false),
    ('vendors', 'thumbnail_url', 'text', false),
    ('vendors', 'created_at', 'timestamp with time zone', false),
    ('vendors', 'updated_at', 'timestamp with time zone', false),
    ('vendors', 'owner_id', 'uuid', false),
    ('vendors', 'commission_rate', 'numeric(5,2)', false),
    ('vendors', 'bank_account', 'text', false),
    ('vendors', 'business_number', 'text', false),
    ('vendor_products', 'id', 'uuid', true),
    ('vendor_products', 'vendor_id', 'uuid', true),
    ('vendor_products', 'name', 'text', true),
    ('vendor_products', 'price', 'integer', true),
    ('vendor_products', 'original_price', 'integer', false),
    ('vendor_products', 'includes', 'text[]', false),
    ('vendor_products', 'excludes', 'text[]', false),
    ('vendor_products', 'duration', 'text', false),
    ('vendor_products', 'notes', 'text', false),
    ('vendor_products', 'is_popular', 'boolean', false),
    ('vendor_products', 'sort_order', 'integer', false),
    ('vendor_products', 'created_at', 'timestamp with time zone', false),
    ('vendor_products', 'updated_at', 'timestamp with time zone', false),
    ('vendor_images', 'id', 'uuid', true),
    ('vendor_images', 'vendor_id', 'uuid', true),
    ('vendor_images', 'image_url', 'text', true),
    ('vendor_images', 'image_type', 'text', false),
    ('vendor_images', 'sort_order', 'integer', false),
    ('vendor_images', 'created_at', 'timestamp with time zone', false),
    ('vendor_bookings', 'id', 'uuid', true),
    ('vendor_bookings', 'vendor_id', 'uuid', false),
    ('vendor_bookings', 'couple_id', 'uuid', false),
    ('vendor_bookings', 'product_id', 'uuid', false),
    ('vendor_bookings', 'booking_date', 'date', true),
    ('vendor_bookings', 'booking_time', 'time without time zone', false),
    ('vendor_bookings', 'booking_type', 'text', false),
    ('vendor_bookings', 'bride_name', 'text', false),
    ('vendor_bookings', 'groom_name', 'text', false),
    ('vendor_bookings', 'contact_phone', 'text', false),
    ('vendor_bookings', 'status', 'text', false),
    ('vendor_bookings', 'amount', 'integer', false),
    ('vendor_bookings', 'is_paid', 'boolean', false),
    ('vendor_bookings', 'memo', 'text', false),
    ('vendor_bookings', 'created_at', 'timestamp with time zone', false),
    ('vendor_bookings', 'updated_at', 'timestamp with time zone', false),
    ('vendor_favorites', 'id', 'uuid', true),
    ('vendor_favorites', 'user_id', 'uuid', true),
    ('vendor_favorites', 'vendor_id', 'uuid', true),
    ('vendor_favorites', 'created_at', 'timestamp with time zone', false)
), actual_columns AS (
  SELECT c.relname AS table_name,
         a.attname AS column_name,
         format_type(a.atttypid, a.atttypmod) AS data_type,
         a.attnotnull AS not_null
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a
    ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE n.nspname = 'public'
), column_mismatches AS (
  SELECT expected.table_name,
         expected.column_name,
         expected.data_type AS expected_type,
         expected.not_null AS expected_not_null,
         actual.data_type AS actual_type,
         actual.not_null AS actual_not_null
  FROM expected_columns expected
  LEFT JOIN actual_columns actual USING (table_name, column_name)
  WHERE actual.column_name IS NULL
     OR actual.data_type IS DISTINCT FROM expected.data_type
     OR actual.not_null IS DISTINCT FROM expected.not_null
), expected_constraints(table_name, constraint_name, expected_definition) AS (
  VALUES
    ('couples', 'couples_pkey', 'PRIMARY KEY (id)'),
    ('couples', 'couples_invite_code_key', 'UNIQUE (invite_code)'),
    ('couples', 'couples_bride_id_fkey', 'FOREIGN KEY (bride_id) REFERENCES auth.users(id) ON DELETE SET NULL'),
    ('couples', 'couples_groom_id_fkey', 'FOREIGN KEY (groom_id) REFERENCES auth.users(id) ON DELETE SET NULL'),
    ('profiles', 'profiles_pkey', 'PRIMARY KEY (id)'),
    ('profiles', 'profiles_id_fkey', 'FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE'),
    ('profiles', 'profiles_couple_id_fkey', 'FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE SET NULL'),
    ('profiles', 'profiles_role_check', 'CHECK (role = ANY (ARRAY[''bride''::text, ''groom''::text]))'),
    ('profiles', 'profiles_user_type_check', 'CHECK (user_type = ANY (ARRAY[''user''::text, ''vendor''::text, ''admin''::text]))'),
    ('vendors', 'vendors_pkey', 'PRIMARY KEY (id)'),
    ('vendors', 'vendors_owner_id_fkey', 'FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL'),
    ('vendors', 'vendors_category_check', NULL),
    ('vendor_products', 'vendor_products_pkey', 'PRIMARY KEY (id)'),
    ('vendor_products', 'vendor_products_vendor_id_fkey', 'FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE'),
    ('vendor_images', 'vendor_images_pkey', 'PRIMARY KEY (id)'),
    ('vendor_images', 'vendor_images_vendor_id_fkey', 'FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE'),
    ('vendor_images', 'vendor_images_image_type_check', 'CHECK (image_type = ANY (ARRAY[''portfolio''::text, ''interior''::text, ''product''::text]))'),
    ('vendor_bookings', 'vendor_bookings_pkey', 'PRIMARY KEY (id)'),
    ('vendor_bookings', 'vendor_bookings_vendor_id_fkey', 'FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE'),
    ('vendor_bookings', 'vendor_bookings_couple_id_fkey', 'FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE SET NULL'),
    ('vendor_bookings', 'vendor_bookings_product_id_fkey', 'FOREIGN KEY (product_id) REFERENCES vendor_products(id) ON DELETE SET NULL'),
    ('vendor_bookings', 'vendor_bookings_booking_type_check', 'CHECK (booking_type = ANY (ARRAY[''consultation''::text, ''fitting''::text, ''shooting''::text, ''ceremony''::text]))'),
    ('vendor_bookings', 'vendor_bookings_status_check', 'CHECK (status = ANY (ARRAY[''pending''::text, ''confirmed''::text, ''cancelled''::text, ''completed''::text]))'),
    ('vendor_favorites', 'vendor_favorites_pkey', 'PRIMARY KEY (id)'),
    ('vendor_favorites', 'vendor_favorites_user_id_fkey', 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
    ('vendor_favorites', 'vendor_favorites_vendor_id_fkey', 'FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE'),
    ('vendor_favorites', 'vendor_favorites_user_id_vendor_id_key', 'UNIQUE (user_id, vendor_id)')
), actual_constraints AS (
  SELECT table_row.relname AS table_name,
         constraint_row.conname AS constraint_name,
         pg_get_constraintdef(constraint_row.oid, true) AS actual_definition,
         constraint_row.convalidated AS actual_validated
  FROM pg_constraint constraint_row
  JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
  JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
  WHERE namespace_row.nspname = 'public'
), constraint_mismatches AS (
  SELECT expected.*, actual.actual_definition
  FROM expected_constraints expected
  LEFT JOIN actual_constraints actual USING (table_name, constraint_name)
  WHERE actual.constraint_name IS NULL
     OR NOT coalesce(actual.actual_validated, false)
     OR (
       expected.expected_definition IS NOT NULL
       AND actual.actual_definition IS DISTINCT FROM expected.expected_definition
     )
), expected_category_constraint AS (
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260513999000'
  ) THEN
    'CHECK (category = ANY (ARRAY[''studio''::text, ''dress''::text, ''makeup''::text, ''package''::text, ''snap''::text, ''dvd''::text, ''hanbok''::text, ''suit''::text, ''jewelry''::text, ''invitation''::text, ''venue''::text, ''honeymoon''::text, ''other''::text]))'
  ELSE
    'CHECK (category = ANY (ARRAY[''studio''::text, ''dress''::text, ''makeup''::text, ''package''::text, ''snap''::text, ''dvd''::text, ''hanbok''::text, ''suit''::text, ''jewelry''::text, ''invitation''::text]))'
  END AS expected_definition
), category_constraint_mismatches AS (
  SELECT expected.expected_definition,
         actual.actual_definition,
         actual.actual_validated
  FROM expected_category_constraint expected
  LEFT JOIN actual_constraints actual
    ON actual.table_name = 'vendors'
   AND actual.constraint_name = 'vendors_category_check'
  WHERE actual.actual_definition IS DISTINCT FROM expected.expected_definition
     OR NOT coalesce(actual.actual_validated, false)
), expected_indexes(index_name, expected_definition) AS (
  VALUES
    ('idx_vendors_category', 'CREATE INDEX idx_vendors_category ON public.vendors USING btree (category)'),
    ('idx_vendors_region', 'CREATE INDEX idx_vendors_region ON public.vendors USING btree (region)'),
    ('idx_vendors_owner', 'CREATE INDEX idx_vendors_owner ON public.vendors USING btree (owner_id)'),
    ('idx_vendor_products_vendor', 'CREATE INDEX idx_vendor_products_vendor ON public.vendor_products USING btree (vendor_id)'),
    ('idx_vendor_bookings_vendor', 'CREATE INDEX idx_vendor_bookings_vendor ON public.vendor_bookings USING btree (vendor_id)'),
    ('idx_vendor_bookings_couple', 'CREATE INDEX idx_vendor_bookings_couple ON public.vendor_bookings USING btree (couple_id)'),
    ('idx_vendor_bookings_date', 'CREATE INDEX idx_vendor_bookings_date ON public.vendor_bookings USING btree (booking_date)'),
    ('idx_vendor_bookings_status', 'CREATE INDEX idx_vendor_bookings_status ON public.vendor_bookings USING btree (status)'),
    ('idx_vendor_favorites_user', 'CREATE INDEX idx_vendor_favorites_user ON public.vendor_favorites USING btree (user_id)')
), actual_indexes AS (
  SELECT index_class.relname AS index_name,
         pg_get_indexdef(index_class.oid) AS actual_definition,
         index_row.indisvalid AS actual_valid,
         index_row.indisready AS actual_ready
  FROM pg_index index_row
  JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
  JOIN pg_namespace namespace_row ON namespace_row.oid = index_class.relnamespace
  WHERE namespace_row.nspname = 'public'
), index_mismatches AS (
  SELECT expected.*,
         actual.actual_definition,
         actual.actual_valid,
         actual.actual_ready
  FROM expected_indexes expected
  LEFT JOIN actual_indexes actual USING (index_name)
  WHERE actual.index_name IS NULL
     OR actual.actual_definition IS DISTINCT FROM expected.expected_definition
     OR NOT coalesce(actual.actual_valid, false)
     OR NOT coalesce(actual.actual_ready, false)
), expected_defaults(table_name, column_name, expected_default) AS (
  VALUES
    ('couples', 'id', 'gen_random_uuid()'),
    ('couples', 'created_at', 'now()'),
    ('couples', 'updated_at', 'now()'),
    ('profiles', 'created_at', 'now()'),
    ('profiles', 'updated_at', 'now()'),
    ('profiles', 'user_type', '''user''::text'),
    ('profiles', 'consents', '''{}''::jsonb'),
    ('vendors', 'id', 'gen_random_uuid()'),
    ('vendors', 'style_tags', '''{}''::text[]'),
    ('vendors', 'is_fixed_price', 'true'),
    ('vendors', 'is_verified', 'false'),
    ('vendors', 'rating', '0'),
    ('vendors', 'review_count', '0'),
    ('vendors', 'commission_rate', '15.00'),
    ('vendors', 'created_at', 'now()'),
    ('vendors', 'updated_at', 'now()'),
    ('vendor_products', 'id', 'gen_random_uuid()'),
    ('vendor_products', 'includes', '''{}''::text[]'),
    ('vendor_products', 'excludes', '''{}''::text[]'),
    ('vendor_products', 'is_popular', 'false'),
    ('vendor_products', 'sort_order', '0'),
    ('vendor_products', 'created_at', 'now()'),
    ('vendor_products', 'updated_at', 'now()'),
    ('vendor_images', 'id', 'gen_random_uuid()'),
    ('vendor_images', 'image_type', '''portfolio''::text'),
    ('vendor_images', 'sort_order', '0'),
    ('vendor_images', 'created_at', 'now()'),
    ('vendor_bookings', 'id', 'gen_random_uuid()'),
    ('vendor_bookings', 'status', '''pending''::text'),
    ('vendor_bookings', 'is_paid', 'false'),
    ('vendor_bookings', 'created_at', 'now()'),
    ('vendor_bookings', 'updated_at', 'now()'),
    ('vendor_favorites', 'id', 'gen_random_uuid()'),
    ('vendor_favorites', 'created_at', 'now()')
), default_mismatches AS (
  SELECT expected.*,
         pg_get_expr(default_row.adbin, default_row.adrelid) AS actual_default
  FROM expected_defaults expected
  LEFT JOIN pg_class table_row
    ON table_row.oid = to_regclass('public.' || expected.table_name)
  LEFT JOIN pg_attribute attribute_row
    ON attribute_row.attrelid = table_row.oid
   AND attribute_row.attname = expected.column_name
   AND attribute_row.attnum > 0
   AND NOT attribute_row.attisdropped
  LEFT JOIN pg_attrdef default_row
    ON default_row.adrelid = table_row.oid
   AND default_row.adnum = attribute_row.attnum
  WHERE default_row.oid IS NULL
     OR pg_get_expr(default_row.adbin, default_row.adrelid)
       IS DISTINCT FROM expected.expected_default
), expected_rls(table_name) AS (
  VALUES ('couples'), ('profiles'), ('vendors'), ('vendor_products'),
         ('vendor_images'), ('vendor_bookings'), ('vendor_favorites')
), rls_disabled AS (
  SELECT expected.table_name
  FROM expected_rls expected
  LEFT JOIN pg_namespace namespace_row ON namespace_row.nspname = 'public'
  LEFT JOIN pg_class table_row
    ON table_row.relname = expected.table_name
   AND table_row.relnamespace = namespace_row.oid
  WHERE table_row.oid IS NULL OR NOT table_row.relrowsecurity
), summary AS (
  SELECT
    EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations
      WHERE version = '20260202000000'
    ) AS history_present,
    NOT EXISTS (SELECT 1 FROM column_mismatches)
      AND NOT EXISTS (SELECT 1 FROM constraint_mismatches)
      AND NOT EXISTS (SELECT 1 FROM category_constraint_mismatches)
      AND NOT EXISTS (SELECT 1 FROM index_mismatches)
      AND NOT EXISTS (SELECT 1 FROM default_mismatches)
      AND NOT EXISTS (SELECT 1 FROM rls_disabled) AS catalog_matches
)
SELECT jsonb_build_object(
  'version', '20260202000000',
  'history_present', summary.history_present,
  'catalog_matches', summary.catalog_matches,
  -- Once history exists, later migrations may intentionally evolve the
  -- baseline (for example invite_code becomes nullable). This field answers
  -- only whether a missing history row may be reconciled right now.
  'reconciliation_allowed', CASE
    WHEN summary.history_present THEN NULL
    ELSE summary.catalog_matches
  END,
  'column_mismatches', COALESCE(
    (SELECT jsonb_agg(to_jsonb(row_value)) FROM column_mismatches row_value),
    '[]'::jsonb
  ),
  'constraint_mismatches', COALESCE(
    (SELECT jsonb_agg(to_jsonb(row_value)) FROM constraint_mismatches row_value),
    '[]'::jsonb
  ),
  'category_constraint_mismatches', COALESCE(
    (SELECT jsonb_agg(to_jsonb(row_value)) FROM category_constraint_mismatches row_value),
    '[]'::jsonb
  ),
  'index_mismatches', COALESCE(
    (SELECT jsonb_agg(to_jsonb(row_value)) FROM index_mismatches row_value),
    '[]'::jsonb
  ),
  'default_mismatches', COALESCE(
    (SELECT jsonb_agg(to_jsonb(row_value)) FROM default_mismatches row_value),
    '[]'::jsonb
  ),
  'rls_disabled', COALESCE(
    (SELECT jsonb_agg(to_jsonb(row_value)) FROM rls_disabled row_value),
    '[]'::jsonb
  ),
  'applied_versions', COALESCE(
    (SELECT jsonb_agg(version ORDER BY version)
     FROM supabase_migrations.schema_migrations),
    '[]'::jsonb
  )
) AS baseline_preflight
FROM summary;
