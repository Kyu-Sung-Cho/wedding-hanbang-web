-- Recovery captures portable job definitions plus a fail-closed execution
-- environment summary. Source jobid/database/host/port values are not copied;
-- database and approved scheduler role are validated before target rebinding.
WITH captured_jobs AS (
  SELECT job_row.jobname AS job_name,
         job_row.schedule,
         job_row.command,
         job_row.active,
         job_row.database,
         job_row.username
  FROM cron.job job_row
), execution_environment AS (
  SELECT jsonb_build_object(
    'preActivationLauncherState',
      coalesce(current_setting('cron.launch_active_jobs', true), ''),
    'runningJobCount', (
      SELECT count(*)::bigint
      FROM cron.job_run_details run_detail
      WHERE run_detail.status = 'running'
    ),
    'timezone', coalesce(current_setting('cron.timezone', true), ''),
    'schedulerRole', CASE
      WHEN count(*) > 0 AND bool_and(job_row.username = 'postgres')
        THEN 'postgres'
      ELSE 'mismatch'
    END,
    'databaseBinding', CASE
      WHEN count(*) > 0 AND bool_and(job_row.database = current_database())
        THEN 'current_database'
      ELSE 'mismatch'
    END
  ) AS value
  FROM captured_jobs job_row
)
SELECT jsonb_build_object(
  'schemaVersion', 1,
  'contract', 'hanbang-approved-maintenance-crons-v1',
  'executionEnvironment', (SELECT value FROM execution_environment),
  'jobs', coalesce(
    jsonb_agg(
      jsonb_build_object(
        'jobName', captured.job_name,
        'schedule', captured.schedule,
        'command', captured.command,
        'active', captured.active
      )
      ORDER BY captured.job_name
    ) FILTER (WHERE captured.job_name IS NOT NULL),
    '[]'::jsonb
  )
) AS recovery_cron_contract
FROM captured_jobs captured;
