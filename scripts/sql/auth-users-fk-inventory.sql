BEGIN TRANSACTION READ ONLY;

SELECT
  con.conname AS constraint_name,
  child_ns.nspname AS child_schema,
  child.relname AS child_table,
  jsonb_agg(child_att.attname ORDER BY child_key.ordinality) AS child_columns,
  ref_ns.nspname AS referenced_schema,
  ref.relname AS referenced_table,
  jsonb_agg(ref_att.attname ORDER BY child_key.ordinality) AS referenced_columns,
  jsonb_agg(NOT child_att.attnotnull ORDER BY child_key.ordinality)
    AS child_column_nullable,
  con.confmatchtype::text AS confmatchtype,
  CASE con.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
  END AS on_delete,
  CASE con.confupdtype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
  END AS on_update,
  con.convalidated AS validated,
  con.condeferrable AS deferrable,
  con.condeferred AS initially_deferred,
  pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint AS con
JOIN pg_class AS child ON child.oid = con.conrelid
JOIN pg_namespace AS child_ns ON child_ns.oid = child.relnamespace
JOIN pg_class AS ref ON ref.oid = con.confrelid
JOIN pg_namespace AS ref_ns ON ref_ns.oid = ref.relnamespace
JOIN unnest(con.conkey) WITH ORDINALITY AS child_key(attnum, ordinality)
  ON true
JOIN unnest(con.confkey) WITH ORDINALITY AS ref_key(attnum, ordinality)
  ON ref_key.ordinality = child_key.ordinality
JOIN pg_attribute AS child_att
  ON child_att.attrelid = child.oid
  AND child_att.attnum = child_key.attnum
JOIN pg_attribute AS ref_att
  ON ref_att.attrelid = ref.oid
  AND ref_att.attnum = ref_key.attnum
WHERE con.contype = 'f'
  AND child_ns.nspname = 'public'
  AND ref_ns.nspname = 'auth'
  AND ref.relname = 'users'
GROUP BY
  con.oid,
  con.conname,
  child_ns.nspname,
  child.relname,
  ref_ns.nspname,
  ref.relname,
  con.confdeltype,
  con.confupdtype,
  con.confmatchtype,
  con.convalidated,
  con.condeferrable,
  con.condeferred
ORDER BY child.relname, con.conname;

ROLLBACK;
