# Release checks

These checks are fail-closed, read-only production gates. They do not apply a
migration, mutate Storage, create a backup, or prove that a backup can be
restored.

For the Amora Engine v2 release, use this order:

1. Save the exact 19-policy, 10-bucket Storage inventory receipt.
2. Remove exactly the 15 named Storage mutation policies through Dashboard.
3. Run the read-only Storage freeze verifier. It must prove exactly four
   historical SELECT policies, zero mutations, unchanged bucket configuration
   and object counts, and no staging bucket.
4. Record the freeze timestamp. Existing signed upload tokens bypass Storage
   RLS and remain valid for two hours. Wait at least 2 hours 10 minutes, then run
   `amora-engine-v2-storage-freeze-pre.sql` twice at least five minutes apart.
   Both controller receipts must have the same total/per-bucket object counts,
   exactly four policies, and zero mutation policies.
5. Create and independently verify the database backup/restore receipt.
6. Run `amora-engine-v2-20260716-pre.sql` against the pinned production target.
   Its Storage block intentionally checks the frozen four-policy prestate.
7. Continue only when its sole result is `{ "verified": true }`, then apply
   exactly the 27 hash-pinned migrations from `20260716090000` through
   `20260716117000`, with the temporary global database write fence still
   installed.
8. Create the exact private empty staging bucket. Remove the frozen four SELECT
   policies and create the provisional strict deletion/membership/production-
   guarded chat INSERT through Dashboard. Run the final Storage verifier and
   `amora-engine-v2-storage-final-post-push.sql`; both must prove the permanent
   policy exists while `production_storage_writes_allowed()` is still false.
9. Run `amora-engine-v2-20260716-post.sql`. Continue only on its sole
   `{ "verified": true }` result.
10. Prove the exact direct-upload positive and negative contract on a disposable
    hosted project. Deploy and run production read-only canary while both fences
    remain closed. Only then may the controller remove the exact temporary
    database-fence objects and run one authorized positive production canary.

The provisional INSERT-only policy is not a release approval: Supabase's hosted
Storage API may require a same-path SELECT policy to return inserted metadata.
A failed hosted positive probe requires a reviewed manifest redesign, not a
weakened verifier. The default phase-2 safe rollback converges to zero policies,
so public reads and mutations both remain removed. The phase-1 recovery alone
preserves the exact four historical reads; the separate 19-policy emergency
restore is time-bounded, security-regressing, and never controller-bound.

Any exception is a hard stop. Do not edit a candidate count or weaken a check
to make a changed production state pass; take a new read-only inventory,
explain the drift, and produce a new reviewed release contract instead.

The post-check proves the resulting ledger, schema, ACL, RLS, and selected data
invariants at the instant it runs. It does not independently reconstruct
pre-migration row counts, prove that the 1160 retention function was never
invoked, or replace the controller receipt, backup verification, separate
different-project hosted restore rehearsal, canary, and rollback decision record.
