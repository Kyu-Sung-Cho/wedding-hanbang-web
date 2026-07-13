SELECT count(*)::bigint AS retired_invitation_inventory_jobs
FROM public.account_deletion_jobs AS job
WHERE job.storage_inventory IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(job.storage_inventory) AS item(value)
    WHERE item.value->>'bucket' = 'invitation-photos'
  );
