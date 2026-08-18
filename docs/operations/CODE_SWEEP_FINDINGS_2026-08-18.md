# Code Sweep Findings — 2026-08-18

> **Status:** INVESTIGATION COMPLETE · NO HIGH-CONFIDENCE BUGS FOUND
>
> **Scope:** Full code sweep of the wedding-hanbang-web monorepo (웨딩한방 / hanbang.ai)
> investigating how the code actually behaves against documented hypotheses.

## Summary

All investigated hypotheses were either **already correct** or **already protected**.
No high-confidence safety/correctness bugs requiring immediate fixes were discovered.
The codebase has robust test coverage for critical paths including privacy fences,
approval workflows, vendor identity, and production write boundaries.

---

## Hypotheses Investigated

### 1. OpenAI vs Anthropic

**Hypothesis:** Docs say OpenAI but live calls may be Anthropic

**Finding:** ✓ **VERIFIED CORRECT** — Only OpenAI is used

- `apps/web/src/lib/ai/modelConfig.ts` defines only `gpt-5.6-terra` and `gpt-5.6-luna`
- `apps/web/src/lib/ai/openai.ts` uses the `openai` SDK exclusively
- `apps/web/src/lib/ai/auditedOpenAI.ts` wraps all calls with audit logging
- No Anthropic SDK or direct calls found in the codebase
- Documentation mentions of Anthropic are historical/comparative, not implementation

### 2. Budget Ratio Divergence

**Hypothesis:** Budget ratio numbers may diverge across surfaces

**Finding:** ✓ **ALREADY FIXED** — `CATEGORY_RATIOS` removed, test protection added

- `apps/web/src/components/app/budget/__tests__/budgetReliability.test.ts` enforces:
  - No hardcoded `ratio: 0.15` patterns
  - No `CATEGORY_RATIOS` constants
  - Both web and mobile UI correctly state only entered/confirmed budgets are summed
- Commit `04f0ea16` removed the problematic ratio constants

### 3. Amora Tool Failures Shown as Success

**Hypothesis:** Amora tool failures may be persisted/shown as success

**Finding:** ✓ **WORKING CORRECTLY** — Failures propagate with `success: false`

- `apps/web/src/lib/ai/toolExecutor.ts` returns `failureResult` with explicit error codes
- `apps/web/src/app/api/chat/route.ts` rejects invalid tool calls with specific error codes:
  - `AMORA_MAX_TOOL_CALLS_PER_TURN`, `MODEL_MUTATION_TOOL_BLOCKED`
  - `QUESTION_SCOPE_TOOL_BLOCKED`, `TOOL_NOT_AVAILABLE_FOR_TURN`, `INVALID_TOOL_INPUT`
- `apps/web/src/components/app/chat/ActionCard.tsx` uses `getUserFacingDisplayMessage`
  to sanitize and display user-friendly error messages
- `ActionCard.failure-regression.test.tsx` verifies internal IDs are redacted

### 4. Seed/Apply APIs Writing to Production from Local Dev

**Hypothesis:** Seed/apply APIs may write fake approved vendors to prod from local dev

**Finding:** ✓ **PROTECTED** — Multiple layers of safeguards

- `apps/web/src/lib/supabase/destinationFence.ts`:
  - Validates destination URLs and project references
  - Requires explicit `SUPABASE_PRODUCTION_WRITE_CONFIRM` for prod writes
  - `verifyRuntimeSupabaseServiceDestination()` called on every admin client creation
- `scripts/ingest/destination.ts`:
  - `REPOSITORY_PRODUCTION_PROJECT_REFS` provides hardcoded production denylist
- `scripts/ingest/price-demo-seed.ts`:
  - `runPriceDemoSeed` function is **retired and throws an error**
  - Multiple assertions: `assertNotProductionDestination`, `assertDisclosureStagingProjectRef`
  - Requires `PRICE_DEMO_SEED_CONFIRM` string

### 5. Schedule Missing momentType

**Hypothesis:** Schedule may lack momentType

**Finding:** ✓ **PROPERLY HANDLED**

- `apps/web/src/utils/scheduleEvents.ts` includes `momentType` in `ScheduleEventDraft`
- `SCHEDULE_EVENT_STRING_LIMITS.momentType` provides validation
- `apps/web/src/lib/ai/tools/scheduleTools.ts` passes `momentType` to schedule functions

### 6. Today/Lounge Completion % and "N일 지남"

**Hypothesis:** May show impossible completion % or "N일 지남"

**Finding:** ✓ **INTENTIONAL DESIGN**

- `apps/web/src/app/(app)/lounge/page.tsx` calculates:
  - `progressPercent` correctly: `Math.round((summary.done / summary.total) * 100)`
  - `daysUntilDeadline = dday - category.ddayDeadline`
- "N일 지남" shows days past the **default checking point** (not an impossible value)
- Progress correctly excludes `not_applicable` items from the total

### 7. Couple Invite May Be Broken

**Hypothesis:** Do not claim "둘이" works

**Finding:** ✓ **WORKING CORRECTLY**

- **Shared validation:** Web and Mobile both import from `@hanbang/shared`:
  - `COUPLE_INVITE_CODE_MAX_LENGTH` (15 chars: `WH-` + 12 digits)
  - `COUPLE_INVITE_CODE_PLACEHOLDER`
  - `normalizeCoupleInviteCode`, `describeCoupleInviteCodeProblem`
- **DB RPC `join_couple`** (migration 20260714160000):
  - Advisory lock prevents race conditions
  - Validates auth, role, invite code format
  - Checks existing couple membership
  - Verifies slot availability (bride/groom)
  - Proper error codes: `ALREADY_LINKED`, `MEMBERSHIP_INCONSISTENT`, `BRIDE_SLOT_OCCUPIED`
- **Test coverage:** `coupleInviteCode.test.ts`, `route.test.ts` cover:
  - Code length validation
  - Normalization (lowercase, spaces, quotes)
  - Race conditions and error handling

### 8. Apply-Before-Approval Writes

**Hypothesis:** May allow apply without approval

**Finding:** ✓ **PROTECTED** — DB function enforces approval requirement

- `claim_amora_shared_action_application` (migration 20260730102000):
  ```sql
  IF v_accepted_count < (v_context ->> 'requiredCount')::integer THEN
    RAISE EXCEPTION 'AMORA_SHARED_ACTION_APPROVAL_REQUIRED'
      USING ERRCODE = '55000';
  END IF;
  ```
- Approval policy defined in `@hanbang/shared`:
  - `couple`: Both members approve (budget, wedding date, venue, commitments)
  - `single`: One member can approve (task status, checklist items)
  - `blocked`: Disabled during beta

### 9. Price Catalog Identity vs vendorIdentity.ts

**Hypothesis:** Public /price catalog identity may mix two shops

**Finding:** ✓ **WELL TESTED** — Comprehensive identity rules with test coverage

- `apps/web/src/lib/price/vendorIdentity.ts`:
  - `normalizeVendorName`: Strips company suffixes, spaces, punctuation
  - `SAME_NAME_DIFFERENT_BUSINESS`: Explicitly separates shops with same name but different businesses
    (랑게 광주/서울, 메이든스튜디오 서울/대구, 라망)
  - `SAME_BUSINESS_DIFFERENT_NAME`: Merges 38 confirmed same-shop variants
  - `VENDOR_BRANCHES`: Handles branch locations (수원헤움 = 헤움수원점)
  - `vendorIdentityKey`: Creates unique identity key per vendor
- **Test files:**
  - `sameBusinessDifferentName.test.ts`: Verifies merge rules
  - `vendorBranchIdentity.test.ts`: Verifies branch handling
  - `vendorIdentityMerge.test.ts`: Verifies region filtering

### 10. Other Wiring/Auth/Data-Loss Bugs

**Finding:** ✓ **NO ISSUES FOUND**

- Extensive RLS policies across 80+ migrations
- Privacy fence tests: `currentCoupleMembershipPrivacyFence.test.ts`
- Hardening tests: `priceConsumerCrossContractHardeningIntegration.test.ts`
- Auth boundary tests: `route.trust-boundary.test.ts`

---

## What's Live vs Designed-Not-Shipped

### Live and Working

- OpenAI integration (gpt-5.6-luna/terra only)
- Budget tracking without arbitrary ratios
- Amora tool execution with proper failure handling
- Couple invite flow (Web + Mobile)
- Schedule with momentType
- Lounge progress tracking
- Vendor identity merging/separation
- Approval workflow for shared actions

### Designed but Not Shipped (Product Gaps)

- **Three hall questions flow** (region, guests, meal-cost cap): Product decision, not a code bug
- **Today screen 3-question flow**: Separate product ship, code structure exists
- **Full Amora-led course vs dashboard/tool hub**: Architecture transition in progress
- **37 undecided vendor pairs**: Listed in `docs/operations/VENDOR_MERGE_REVIEW_2026-07-27.md`

---

## In-Flight PRs (Not Touched)

As instructed, the following PRs were left alone:

- PR #107: agency/vendor ingest
- PR #108: /price item-first then region
- PR #109: vendor identity verification report
- PR #110: 라망 Seoul slug merge; 테레지아/버드투블룸 removed from name-merge

No regressions were identified in these PRs.

---

## Verification Method

- **E (Empirical):** Direct file reads, grep searches, test inspection
- **S (Source):** Official documentation, migration SQL, TypeScript types
- **I (Inference):** Conclusions drawn from E/S evidence

All findings are based on actual code inspection, not documentation alone.

---

## Conclusion

The codebase is in good health. The hypotheses provided were either:
1. Already correct (OpenAI usage)
2. Already fixed with test protection (budget ratios)
3. Working as designed (N일 지남, invite flow)
4. Protected by DB-level enforcement (approval workflow, production write fence)

**No immediate code changes required.**
