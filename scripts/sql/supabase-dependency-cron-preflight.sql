-- Read-only exact inventory. The guarded PowerShell workflow executes this
-- file only after to_regclass('cron.job') proves that pg_cron is installed.
WITH required_dependency_crons(
  job_name, expected_schedule, expected_command, creator_version
) AS (
  VALUES
    ('delete-expired-amora-request-claims', '29 18 * * *',
      'SELECT public.delete_expired_amora_request_claims();', '20260710050000'),
    ('reconcile-stale-amora-chat-requests', '*/5 * * * *',
      'SELECT public.reconcile_stale_amora_chat_requests(100);', '20260711139000'),
    ('enforce-ai-interaction-retention', '17 18 * * *',
      'SELECT public.enforce_ai_interaction_retention();', '20260710010000'),
    ('enforce-court-provider-deletion-handoff-retention', '7 * * * *',
      'SELECT public.enforce_court_provider_deletion_handoff_retention(1000);',
      '20260714102000'),
    ('enforce-court-provider-request-key-reveal-audit-retention', '37 * * * *',
      'SELECT public.enforce_court_provider_request_key_reveal_audit_retention(1000);',
      '20260714103000'),
    ('enforce-application-survey-retention', '41 18 * * *',
      'SELECT public.enforce_application_survey_retention();', '20260711141000'),
    ('delete-expired-rate-limit-buckets', '47 18 * * *',
      'SELECT public.delete_expired_rate_limit_buckets();', '20260711141000')
), dependency_cron_status AS (
  SELECT required.job_name,
         required.creator_version,
         count(job_row.jobid) AS existing_count,
         count(job_row.jobid) <= 1 AS existing_replaceable,
         count(job_row.jobid) = 1 AND bool_and(
           job_row.schedule = required.expected_schedule
           AND job_row.command = required.expected_command
           AND job_row.database = current_database()
           AND job_row.username = 'postgres'
           AND job_row.active
         ) AS exact
  FROM required_dependency_crons required
  LEFT JOIN cron.job job_row ON job_row.jobname = required.job_name
  GROUP BY required.job_name, required.creator_version
)
SELECT jsonb_object_agg(
  status.job_name,
  to_jsonb(status) - 'job_name'
  ORDER BY status.job_name
) AS dependency_cron_status
FROM dependency_cron_status status;
