import assert from "node:assert/strict";
import test from "node:test";

import { assertApprovedPreviewTarget } from "./lib/preview-smoke-guard.mjs";

test("accepts only an explicitly approved non-production Supabase target", () => {
  const result = assertApprovedPreviewTarget({
    supabaseUrl: "https://previewref.supabase.co",
    expectedProjectRef: "previewref",
    releaseTargets: {
      productionSupabaseProjectRefs: ["productionref"],
      approvedNonProductionSupabaseProjectRefs: ["previewref"],
    },
  });

  assert.deepEqual(result, {
    projectRef: "previewref",
    supabaseUrl: "https://previewref.supabase.co",
  });
});

test("rejects a production ref even if it is mistakenly added to the preview list", () => {
  assert.throws(
    () =>
      assertApprovedPreviewTarget({
        supabaseUrl: "https://productionref.supabase.co",
        expectedProjectRef: "productionref",
        releaseTargets: {
          productionSupabaseProjectRefs: ["productionref"],
          approvedNonProductionSupabaseProjectRefs: ["productionref"],
        },
      }),
    /explicitly approved non-production project/,
  );
});

test("rejects an unapproved or URL-mismatched project", () => {
  const releaseTargets = {
    productionSupabaseProjectRefs: ["productionref"],
    approvedNonProductionSupabaseProjectRefs: ["previewref"],
  };

  assert.throws(
    () =>
      assertApprovedPreviewTarget({
        supabaseUrl: "https://unknownref.supabase.co",
        expectedProjectRef: "unknownref",
        releaseTargets,
      }),
    /explicitly approved non-production project/,
  );
  assert.throws(
    () =>
      assertApprovedPreviewTarget({
        supabaseUrl: "https://previewref.supabase.co/rest/v1",
        expectedProjectRef: "previewref",
        releaseTargets,
      }),
    /exact expected preview project/,
  );
});
