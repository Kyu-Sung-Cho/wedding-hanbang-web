-- One sanitized JSON row for database-readonly-realtime-cron-v1.
-- Never return activity query text, cron command text, client addresses, config paths, or credentials.
WITH required_roles(role_name) AS (
  VALUES
    ('authenticator'::text),
    ('supabase_auth_admin'::text),
    ('supabase_storage_admin'::text),
    ('dashboard_user'::text)
), database_identity AS (
  SELECT oid, datname
  FROM pg_catalog.pg_database
  WHERE datname = current_database()
), role_status AS (
  SELECT
    required.role_name,
    role_row.oid IS NOT NULL AS role_exists,
    (
      SELECT split_part(config.value, '=', 2)
      FROM pg_catalog.pg_db_role_setting setting_row
      CROSS JOIN LATERAL unnest(setting_row.setconfig) AS config(value)
      WHERE setting_row.setrole = role_row.oid
        AND setting_row.setdatabase = (SELECT oid FROM database_identity)
        AND config.value LIKE 'default_transaction_read_only=%'
      LIMIT 1
    ) AS configured_value
  FROM required_roles required
  LEFT JOIN pg_catalog.pg_roles role_row
    ON role_row.rolname = required.role_name
), cron_setting AS (
  SELECT
    current_setting('cron.launch_active_jobs', true) AS launch_active_jobs,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_file_settings file_setting
      WHERE file_setting.name = 'cron.launch_active_jobs'
        AND file_setting.applied
        AND file_setting.sourcefile LIKE '%postgresql.auto.conf'
    ) AS auto_override_present,
    (
      SELECT file_setting.setting
      FROM pg_catalog.pg_file_settings file_setting
      WHERE file_setting.name = 'cron.launch_active_jobs'
        AND file_setting.applied
        AND file_setting.sourcefile LIKE '%postgresql.auto.conf'
      ORDER BY file_setting.seqno DESC
      LIMIT 1
    ) AS auto_override_value
), drain_status AS (
  SELECT
    count(*) FILTER (
      WHERE activity.pid <> pg_backend_pid()
        AND activity.xact_start IS NOT NULL
    )::bigint AS active_transactions,
    count(*) FILTER (
      WHERE activity.pid <> pg_backend_pid()
        AND activity.usename IN (
          'authenticator',
          'supabase_auth_admin',
          'supabase_storage_admin',
          'dashboard_user'
        )
    )::bigint AS protected_role_sessions,
    min(activity.backend_start) FILTER (
      WHERE activity.pid <> pg_backend_pid()
        AND activity.usename IN (
          'authenticator',
          'supabase_auth_admin',
          'supabase_storage_admin',
          'dashboard_user'
        )
    ) AS oldest_protected_role_session_at_utc,
    count(*) FILTER (
      WHERE activity.pid <> pg_backend_pid()
        AND activity.backend_type = 'client backend'
    )::bigint AS client_backend_sessions,
    count(*) FILTER (
      WHERE activity.pid <> pg_backend_pid()
        AND (
          activity.backend_type IS NULL
          OR (
            activity.backend_type = 'client backend'
            AND (
              activity.backend_start IS NULL
              OR activity.usename IS NULL
              OR session_role.oid IS NULL
            )
          )
        )
    )::bigint AS unclassified_client_backends,
    count(*) FILTER (
      WHERE activity.pid <> pg_backend_pid()
        AND activity.backend_type = 'client backend'
        AND (
          session_role.oid IS NULL
          OR activity.usename NOT IN (
            'authenticator',
            'supabase_auth_admin',
            'supabase_storage_admin',
            'dashboard_user'
          )
        )
    )::bigint AS unclassified_writer_sessions,
    min(activity.backend_start) FILTER (
      WHERE activity.pid <> pg_backend_pid()
        AND activity.backend_type = 'client backend'
    ) AS oldest_client_backend_start_at_utc,
    max(activity.backend_start) FILTER (
      WHERE activity.pid <> pg_backend_pid()
        AND activity.backend_type = 'client backend'
    ) AS newest_client_backend_start_at_utc
  FROM pg_catalog.pg_stat_activity activity
  LEFT JOIN pg_catalog.pg_roles session_role
    ON session_role.rolname = activity.usename
  WHERE activity.datname = current_database()
), cron_drain AS (
  SELECT count(*)::bigint AS running_cron_jobs
  FROM cron.job_run_details run_detail
  WHERE run_detail.status = 'running'
), role_json AS (
  SELECT jsonb_object_agg(
    role_name,
    jsonb_build_object(
      'exists', role_exists,
      'configuredValue', configured_value
    )
    ORDER BY role_name
  ) AS value
  FROM role_status
)
SELECT jsonb_build_object(
  'contract', 'database-readonly-realtime-cron-v1',
  'database', (SELECT datname FROM database_identity),
  'roles', (SELECT value FROM role_json),
  'cron', jsonb_build_object(
    'launchActiveJobs', (SELECT launch_active_jobs FROM cron_setting),
    'autoOverridePresent', (SELECT auto_override_present FROM cron_setting),
    'autoOverrideValue', (SELECT auto_override_value FROM cron_setting)
  ),
  'drain', jsonb_build_object(
    'activeTransactions', (SELECT active_transactions FROM drain_status),
    'runningCronJobs', (SELECT running_cron_jobs FROM cron_drain),
    'protectedRoleSessions', (SELECT protected_role_sessions FROM drain_status),
    'oldestProtectedRoleSessionAtUtc',
      (SELECT oldest_protected_role_session_at_utc FROM drain_status),
    'clientBackendSessions', (SELECT client_backend_sessions FROM drain_status),
    'unclassifiedClientBackends',
      (SELECT unclassified_client_backends FROM drain_status),
    'unclassifiedWriterSessions',
      (SELECT unclassified_writer_sessions FROM drain_status),
    'oldestClientBackendStartAtUtc',
      (SELECT oldest_client_backend_start_at_utc FROM drain_status),
    'newestClientBackendStartAtUtc',
      (SELECT newest_client_backend_start_at_utc FROM drain_status)
  ),
  'backendBoundary', jsonb_build_object(
    'observedAtUtc', statement_timestamp(),
    'postmasterStartedAtUtc', pg_postmaster_start_time(),
    'clientBackendSessions', (SELECT client_backend_sessions FROM drain_status),
    'unclassifiedClientBackends',
      (SELECT unclassified_client_backends FROM drain_status),
    'unclassifiedWriterSessions',
      (SELECT unclassified_writer_sessions FROM drain_status),
    'oldestClientBackendStartAtUtc',
      (SELECT oldest_client_backend_start_at_utc FROM drain_status),
    'newestClientBackendStartAtUtc',
      (SELECT newest_client_backend_start_at_utc FROM drain_status)
  ),
  'releaseConnection', jsonb_build_object(
    'roleClass', CASE
      WHEN session_user = 'postgres' AND current_user = 'postgres'
        THEN 'supabase_project_postgres'
      ELSE 'unexpected'
    END,
    'transactionReadOnly', current_setting('transaction_read_only') = 'on'
  )
) AS write_fence_status;
