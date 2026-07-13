WITH public_table_stats AS (
  SELECT relname AS table_name,
         n_live_tup::bigint AS estimated_rows,
         pg_total_relation_size(relid)::bigint AS total_bytes
  FROM pg_stat_user_tables
  WHERE schemaname = 'public'
), public_table_counts AS (
  SELECT p.tablename AS table_name,
         (
           (xpath(
             '/row/exact_count/text()',
             query_to_xml(
               format('SELECT count(*) AS exact_count FROM %I.%I', p.schemaname, p.tablename),
               false,
               true,
               ''
             )
           ))[1]::text
         )::bigint AS exact_rows
  FROM pg_tables p
  WHERE p.schemaname = 'public'
), bucket_inventory AS (
  SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.id), '[]'::jsonb) AS buckets,
         count(*)::bigint AS bucket_count
  FROM storage.buckets b
), object_inventory AS (
  SELECT count(*)::bigint AS object_count,
         coalesce(sum(
           CASE
             WHEN o.metadata ->> 'size' ~ '^[0-9]+$'
               THEN (o.metadata ->> 'size')::bigint
             ELSE 0
           END
         ), 0)::bigint AS total_bytes,
         max(o.updated_at) AS max_updated_at
  FROM storage.objects o
), extension_inventory AS (
  SELECT coalesce(jsonb_agg(
           jsonb_build_object('name', extname, 'version', extversion)
           ORDER BY extname
         ), '[]'::jsonb) AS extensions
  FROM pg_extension
), sequence_inventory AS (
  SELECT coalesce(jsonb_agg(
           jsonb_build_object(
             'schema', schemaname,
             'name', sequencename,
             'lastValue', last_value
           ) ORDER BY schemaname, sequencename
         ), '[]'::jsonb) AS sequences
  FROM pg_sequences
  WHERE schemaname IN ('auth', 'public', 'storage')
)
SELECT jsonb_build_object(
  'schemaVersion', 1,
  'capturedAt', clock_timestamp(),
  'databaseSizeBytes', pg_database_size(current_database()),
  'authUserCount', (SELECT count(*)::bigint FROM auth.users),
  'publicTables', (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'name', table_name,
        'estimatedRows', estimated_rows,
        'totalBytes', total_bytes
      ) ORDER BY table_name
    ), '[]'::jsonb)
    FROM public_table_stats
  ),
  'publicTableCounts', (
    SELECT coalesce(jsonb_object_agg(table_name, exact_rows ORDER BY table_name), '{}'::jsonb)
    FROM public_table_counts
  ),
  'extensions', (SELECT extensions FROM extension_inventory),
  'sequences', (SELECT sequences FROM sequence_inventory),
  'storage', jsonb_build_object(
    'buckets', (SELECT buckets FROM bucket_inventory),
    'bucketCount', (SELECT bucket_count FROM bucket_inventory),
    'objectCount', (SELECT object_count FROM object_inventory),
    'totalBytes', (SELECT total_bytes FROM object_inventory),
    'maxUpdatedAt', (SELECT max_updated_at FROM object_inventory)
  )
) AS recovery_inventory;
