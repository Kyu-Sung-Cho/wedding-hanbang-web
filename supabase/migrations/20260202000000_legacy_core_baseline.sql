BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Evidence-backed baseline for tables that predated the checked-in migration
-- history. The source of truth is the production pg_catalog shape plus the
-- compatibility comments in the February 2026 ALTER migrations.
--
-- Every CREATE is a no-op on the existing production schema. The catalog
-- assertion below prevents IF NOT EXISTS from silently accepting an
-- incompatible table during the one-time ledger backfill.

CREATE TABLE IF NOT EXISTS public.couples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code text NOT NULL UNIQUE,
  bride_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  groom_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  name text,
  role text CONSTRAINT profiles_role_check CHECK (role IN ('bride', 'groom')),
  couple_id uuid REFERENCES public.couples(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  user_type text DEFAULT 'user'
    CONSTRAINT profiles_user_type_check CHECK (user_type IN ('user', 'vendor', 'admin')),
  consents jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL
    CONSTRAINT vendors_category_check CHECK (category IN (
      'studio', 'dress', 'makeup', 'package', 'snap', 'dvd', 'hanbok',
      'suit', 'jewelry', 'invitation'
    )),
  region text NOT NULL,
  address text,
  phone text,
  website text,
  instagram text,
  description text,
  style_tags text[] DEFAULT '{}'::text[],
  is_fixed_price boolean DEFAULT true,
  is_verified boolean DEFAULT false,
  rating numeric(2,1) DEFAULT 0,
  review_count integer DEFAULT 0,
  thumbnail_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  commission_rate numeric(5,2) DEFAULT 15.00,
  bank_account text,
  business_number text
);

CREATE TABLE IF NOT EXISTS public.vendor_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  price integer NOT NULL,
  original_price integer,
  includes text[] DEFAULT '{}'::text[],
  excludes text[] DEFAULT '{}'::text[],
  duration text,
  notes text,
  is_popular boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vendor_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  image_type text DEFAULT 'portfolio'
    CONSTRAINT vendor_images_image_type_check CHECK (
      image_type IN ('portfolio', 'interior', 'product')
    ),
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vendor_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE CASCADE,
  couple_id uuid REFERENCES public.couples(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.vendor_products(id) ON DELETE SET NULL,
  booking_date date NOT NULL,
  booking_time time without time zone,
  booking_type text
    CONSTRAINT vendor_bookings_booking_type_check CHECK (
      booking_type IN ('consultation', 'fitting', 'shooting', 'ceremony')
    ),
  bride_name text,
  groom_name text,
  contact_phone text,
  status text DEFAULT 'pending'
    CONSTRAINT vendor_bookings_status_check CHECK (
      status IN ('pending', 'confirmed', 'cancelled', 'completed')
    ),
  amount integer,
  is_paid boolean DEFAULT false,
  memo text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vendor_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_vendors_category ON public.vendors(category);
CREATE INDEX IF NOT EXISTS idx_vendors_region ON public.vendors(region);
CREATE INDEX IF NOT EXISTS idx_vendors_owner ON public.vendors(owner_id);
CREATE INDEX IF NOT EXISTS idx_vendor_products_vendor ON public.vendor_products(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_bookings_vendor ON public.vendor_bookings(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_bookings_couple ON public.vendor_bookings(couple_id);
CREATE INDEX IF NOT EXISTS idx_vendor_bookings_date ON public.vendor_bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_vendor_bookings_status ON public.vendor_bookings(status);
CREATE INDEX IF NOT EXISTS idx_vendor_favorites_user ON public.vendor_favorites(user_id);

-- Fail closed between CREATE and the later policy migrations.
ALTER TABLE public.couples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_favorites ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_mismatch text;
BEGIN
  WITH expected(table_name, column_name, data_type, not_null) AS (
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
  ), actual AS (
    SELECT c.relname AS table_name,
           a.attname AS column_name,
           format_type(a.atttypid, a.atttypmod) AS data_type,
           a.attnotnull AS not_null
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a
      ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = 'public'
  )
  SELECT string_agg(
           format('%I.%I expected %s not_null=%s, got %s not_null=%s',
             expected.table_name, expected.column_name, expected.data_type,
             expected.not_null, coalesce(actual.data_type, '<missing>'),
             coalesce(actual.not_null::text, '<missing>')),
           '; ' ORDER BY expected.table_name, expected.column_name
         )
  INTO v_mismatch
  FROM expected
  LEFT JOIN actual USING (table_name, column_name)
  WHERE actual.column_name IS NULL
     OR actual.data_type IS DISTINCT FROM expected.data_type
     OR actual.not_null IS DISTINCT FROM expected.not_null;

  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'LEGACY_CORE_BASELINE_CATALOG_MISMATCH: %', v_mismatch
      USING ERRCODE = '55000';
  END IF;

  WITH expected(table_name, constraint_name, definition) AS (
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
      ('vendors', 'vendors_category_check', 'CHECK (category = ANY (ARRAY[''studio''::text, ''dress''::text, ''makeup''::text, ''package''::text, ''snap''::text, ''dvd''::text, ''hanbok''::text, ''suit''::text, ''jewelry''::text, ''invitation''::text]))'),
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
  ), actual AS (
    SELECT c.relname AS table_name,
           constraint_row.conname AS constraint_name,
           pg_get_constraintdef(constraint_row.oid, true) AS definition,
           constraint_row.convalidated AS validated
    FROM pg_constraint constraint_row
    JOIN pg_class c ON c.oid = constraint_row.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
  )
  SELECT string_agg(
           format('%I.%I expected %s validated, got %s validated=%s',
             expected.table_name, expected.constraint_name, expected.definition,
             coalesce(actual.definition, '<missing>'),
             coalesce(actual.validated::text, '<missing>')),
           '; ' ORDER BY expected.table_name, expected.constraint_name
         )
  INTO v_mismatch
  FROM expected
  LEFT JOIN actual USING (table_name, constraint_name)
  WHERE actual.constraint_name IS NULL
     OR actual.definition IS DISTINCT FROM expected.definition
     OR NOT coalesce(actual.validated, false);

  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'LEGACY_CORE_BASELINE_CONSTRAINT_MISMATCH: %', v_mismatch
      USING ERRCODE = '55000';
  END IF;

  WITH expected(index_name, definition) AS (
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
  ), actual AS (
    SELECT index_class.relname AS index_name,
           pg_get_indexdef(index_class.oid) AS definition,
           index_row.indisvalid AS valid,
           index_row.indisready AS ready
    FROM pg_index index_row
    JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
    JOIN pg_namespace n ON n.oid = index_class.relnamespace
    WHERE n.nspname = 'public'
  )
  SELECT string_agg(
           format('%I expected %s valid/ready, got %s valid=%s ready=%s',
             expected.index_name, expected.definition,
             coalesce(actual.definition, '<missing>'),
             coalesce(actual.valid::text, '<missing>'),
             coalesce(actual.ready::text, '<missing>')),
           '; ' ORDER BY expected.index_name
         )
  INTO v_mismatch
  FROM expected
  LEFT JOIN actual USING (index_name)
  WHERE actual.index_name IS NULL
     OR actual.definition IS DISTINCT FROM expected.definition
     OR NOT coalesce(actual.valid, false)
     OR NOT coalesce(actual.ready, false);

  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'LEGACY_CORE_BASELINE_INDEX_MISMATCH: %', v_mismatch
      USING ERRCODE = '55000';
  END IF;

  WITH expected(table_name, column_name, definition) AS (
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
      ('vendors', 'created_at', 'now()'),
      ('vendors', 'updated_at', 'now()'),
      ('vendors', 'commission_rate', '15.00'),
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
  ), actual AS (
    SELECT c.relname AS table_name,
           attribute_row.attname AS column_name,
           pg_get_expr(default_row.adbin, default_row.adrelid) AS definition
    FROM pg_attrdef default_row
    JOIN pg_class c ON c.oid = default_row.adrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute attribute_row
      ON attribute_row.attrelid = c.oid
     AND attribute_row.attnum = default_row.adnum
    WHERE n.nspname = 'public'
  )
  SELECT string_agg(
           format('%I.%I expected default %s, got %s',
             expected.table_name, expected.column_name, expected.definition,
             coalesce(actual.definition, '<missing>')),
           '; ' ORDER BY expected.table_name, expected.column_name
         )
  INTO v_mismatch
  FROM expected
  LEFT JOIN actual USING (table_name, column_name)
  WHERE actual.column_name IS NULL
     OR actual.definition IS DISTINCT FROM expected.definition;

  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'LEGACY_CORE_BASELINE_DEFAULT_MISMATCH: %', v_mismatch
      USING ERRCODE = '55000';
  END IF;

  SELECT string_agg(expected.table_name, ', ' ORDER BY expected.table_name)
  INTO v_mismatch
  FROM (VALUES
    ('couples'), ('profiles'), ('vendors'), ('vendor_products'),
    ('vendor_images'), ('vendor_bookings'), ('vendor_favorites')
  ) AS expected(table_name)
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class c
    ON c.relnamespace = n.oid
   AND c.relname = expected.table_name
  WHERE c.oid IS NULL OR NOT c.relrowsecurity;

  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'LEGACY_CORE_BASELINE_RLS_MISMATCH: %', v_mismatch
      USING ERRCODE = '55000';
  END IF;
END;
$$;

COMMIT;
