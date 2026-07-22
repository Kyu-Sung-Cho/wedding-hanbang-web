import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPriceDemoFixture,
  assertPriceDemoSeedEnvironment,
  buildPriceDemoFixture,
  createSupabasePriceDemoSeedRepository,
  PRICE_DEMO_SEED_RETIRED_MESSAGE,
  runPriceDemoSeed,
  type PriceDemoFixture,
  type PriceDemoPrice,
  type PriceDemoSeedRepository,
} from "../price-demo-seed.js";

const ADMIN_ACTOR_ID = "a1100000-0000-4000-8000-000000000001";

test("the retired CLI fails before any direct kca_tprice write can start", async () => {
  await assert.rejects(
    runPriceDemoSeed({}),
    (error: unknown) => error instanceof Error
      && error.message === PRICE_DEMO_SEED_RETIRED_MESSAGE,
  );
});

test("the demo fixture is balanced, unmistakably synthetic, fully sourced, and has one publish target", () => {
  const fixture = buildPriceDemoFixture();

  assert.equal(fixture.agencies.length, 3);
  assert.equal(fixture.vendors.length, 12);
  assert.equal(fixture.snapshot.source, "kca_tprice");
  assert.equal(
    fixture.vendors.every((vendor) => [
      "seoul_gangnam3", "seoul_etc", "incheon", "busan", "daejeon",
      "gwangju", "daegu", "ulsan", "gyeonggi", "chungcheong",
      "jeolla", "gyeongsang", "gangwon", "jeju",
    ].includes(vendor.region_code)),
    true,
  );
  assert.equal(
    new Set(
      fixture.vendors
        .filter((vendor) => vendor.category === "studio")
        .map((vendor) => vendor.region_code),
    ).size,
    3,
  );
  assert.deepEqual(
    Object.fromEntries(
      ["studio", "dress", "makeup", "venue"].map((category) => [
        category,
        fixture.vendors.filter((vendor) => vendor.category === category).length,
      ]),
    ),
    { studio: 3, dress: 3, makeup: 3, venue: 3 },
  );

  const visibleLabels = [
    ...fixture.agencies.flatMap((agency) => [agency.name, agency.display_name, ...agency.aliases]),
    ...fixture.vendors.flatMap((vendor) => [vendor.name, ...vendor.aliases]),
    fixture.snapshot.period_label,
    fixture.snapshot.source_note,
    ...fixture.prices.flatMap((price) => [
      price.item_name,
      price.base_spec,
      price.price_note,
      price.source_file,
      price.source_quote,
      ...price.options.flatMap((option) => [
        option.name,
        option.raw_text,
        option.source_file,
        option.source_quote,
      ]),
    ]),
  ];
  assert.equal(visibleLabels.every((label) => /SAMPLE|데모/u.test(label)), true);

  assert.equal(fixture.vendors.reduce((sum, vendor) => sum + vendor.aliases.length, 0) >= 2, true);
  assert.equal(
    fixture.prices.filter((price) =>
      Number.isSafeInteger(price.price_min_krw)
      && Number.isSafeInteger(price.price_max_krw)
      && price.price_min_krw <= price.price_max_krw
    ).length >= 3,
    true,
  );
  assert.equal(
    fixture.prices.flatMap((price) => price.options)
      .filter((option) => option.is_effectively_mandatory).length >= 2,
    true,
  );

  assert.equal(fixture.prices.length, fixture.vendors.length);
  assert.equal(fixture.prices.every((price) =>
    price.review.action === "approve"
    && price.review.expected_review_version === 0
    && price.source_file.length > 0
    && price.source_quote.length > 0
    && price.source_object_keys.length > 0
    && price.confidence === 1
    && price.options.every((option) =>
      option.source_file.length > 0
      && option.source_quote.length > 0
      && option.source_object_keys.length > 0
      && option.confidence === 1
    )
  ), true);
  assert.deepEqual(fixture.publication, {
    snapshot_id: fixture.snapshot.id,
    method: "promote_price_snapshot",
  });
  assert.equal("published" in fixture.snapshot, false);
  assert.equal("is_current" in fixture.snapshot, false);
});

test("the demo seed accepts only explicitly confirmed localhost or non-production staging", () => {
  assert.deepEqual(assertPriceDemoSeedEnvironment({
    PRICE_DEMO_SEED_TARGET_ENV: "local",
    PRICE_DEMO_SEED_CONFIRM: "SEED_SAMPLE_PRICE_DISCLOSURE:local",
    PRICE_DEMO_SEED_ADMIN_ACTOR_ID: ADMIN_ACTOR_ID,
    SUPABASE_PROJECT_REF: "local",
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_sample_local_only",
  }), {
    target: "local",
    projectRef: "local",
    url: "http://127.0.0.1:54321",
    key: "sb_secret_sample_local_only",
    actorId: ADMIN_ACTOR_ID,
  });

  assert.deepEqual(assertPriceDemoSeedEnvironment({
    PRICE_DEMO_SEED_TARGET_ENV: "staging",
    PRICE_DEMO_SEED_CONFIRM: "SEED_SAMPLE_PRICE_DISCLOSURE:sample-staging-ref",
    PRICE_DEMO_SEED_ADMIN_ACTOR_ID: ADMIN_ACTOR_ID,
    PRICE_DEMO_SEED_STAGING_PROJECT_REF: "sample-staging-ref",
    SUPABASE_PROJECT_REF: "sample-staging-ref",
    SUPABASE_URL: "https://sample-staging-ref.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_sample_staging_only",
  }), {
    target: "staging",
    projectRef: "sample-staging-ref",
    url: "https://sample-staging-ref.supabase.co",
    key: "sb_secret_sample_staging_only",
    actorId: ADMIN_ACTOR_ID,
  });
});

test("the demo seed fails closed for production identities, hanbang.ai, or spoofed confirmation", () => {
  const staging = {
    PRICE_DEMO_SEED_TARGET_ENV: "staging",
    PRICE_DEMO_SEED_CONFIRM: "SEED_SAMPLE_PRICE_DISCLOSURE:sample-staging-ref",
    PRICE_DEMO_SEED_ADMIN_ACTOR_ID: ADMIN_ACTOR_ID,
    PRICE_DEMO_SEED_STAGING_PROJECT_REF: "sample-staging-ref",
    SUPABASE_PROJECT_REF: "sample-staging-ref",
    SUPABASE_URL: "https://sample-staging-ref.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_sample_staging_only",
  };

  for (const env of [
    {},
    { ...staging, PRICE_DEMO_SEED_CONFIRM: "yes" },
    { ...staging, PRICE_DEMO_SEED_STAGING_PROJECT_REF: "another-staging-ref" },
    {
      ...staging,
      SUPABASE_PROJECT_REF: "slrtobkksjmxgzatjyqb",
      PRICE_DEMO_SEED_STAGING_PROJECT_REF: "slrtobkksjmxgzatjyqb",
      PRICE_DEMO_SEED_CONFIRM: "SEED_SAMPLE_PRICE_DISCLOSURE:slrtobkksjmxgzatjyqb",
      SUPABASE_URL: "https://slrtobkksjmxgzatjyqb.supabase.co",
      SUPABASE_PRODUCTION_PROJECT_REF: "fake-production-ref",
    },
    { ...staging, PRICE_DEMO_SEED_APP_URL: "https://hanbang.ai" },
    { ...staging, NEXT_PUBLIC_APP_URL: "https://www.hanbang.ai/price" },
    { ...staging, SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_not_allowed" },
  ]) {
    assert.throws(() => assertPriceDemoSeedEnvironment(env), /demo seed|production|hanbang|confirm|staging|service.role/iu);
  }
});

class MemoryPriceDemoRepository implements PriceDemoSeedRepository {
  readonly agencies = new Set<string>();
  readonly vendors = new Set<string>();
  readonly prices = new Map<string, "pending" | "approved">();
  readonly options = new Set<string>();
  publishedSnapshotId: string | null = null;
  private preparedFixture: PriceDemoFixture | null = null;
  private successfulApprovals = 0;
  private injectFailureOnce = true;

  async prepareFoundation(fixture: PriceDemoFixture): Promise<void> {
    this.preparedFixture = fixture;
    for (const agency of fixture.agencies) this.agencies.add(agency.id);
    for (const vendor of fixture.vendors) this.vendors.add(vendor.id);
  }

  async preparePrice(price: PriceDemoPrice): Promise<"pending" | "approved"> {
    if (!this.preparedFixture) throw new Error("foundation required");
    if (!this.prices.has(price.id)) this.prices.set(price.id, "pending");
    if (this.prices.get(price.id) === "pending") {
      for (const option of price.options) this.options.add(option.id);
    }
    return this.prices.get(price.id) ?? "pending";
  }

  async approvePrice(price: PriceDemoPrice, _actorId: string): Promise<void> {
    if (this.injectFailureOnce && this.successfulApprovals === 5) {
      this.injectFailureOnce = false;
      throw new Error("simulated transient database failure");
    }
    this.prices.set(price.id, "approved");
    this.successfulApprovals += 1;
  }

  async promoteSnapshot(snapshotId: string, _actorId: string): Promise<void> {
    if ([...this.prices.values()].some((status) => status !== "approved")) {
      throw new Error("cannot publish pending fixture");
    }
    this.publishedSnapshotId = snapshotId;
  }

  async verifyPublishedFixture(fixture: PriceDemoFixture): Promise<void> {
    assert.equal(this.publishedSnapshotId, fixture.snapshot.id);
    assert.equal(this.agencies.size, fixture.agencies.length);
    assert.equal(this.vendors.size, fixture.vendors.length);
    assert.equal(this.prices.size, fixture.prices.length);
    assert.equal(this.options.size, fixture.prices.flatMap((price) => price.options).length);
    assert.equal([...this.prices.values()].every((status) => status === "approved"), true);
  }
}

test("a partial demo seed failure is safely replayable without duplicate rows", async () => {
  const fixture = buildPriceDemoFixture();
  const repository = new MemoryPriceDemoRepository();

  await assert.rejects(
    applyPriceDemoFixture(repository, fixture, ADMIN_ACTOR_ID),
    /simulated transient database failure/iu,
  );
  assert.equal(repository.publishedSnapshotId, null);

  const recovered = await applyPriceDemoFixture(repository, fixture, ADMIN_ACTOR_ID);
  const replayed = await applyPriceDemoFixture(repository, fixture, ADMIN_ACTOR_ID);

  assert.deepEqual(recovered, replayed);
  assert.deepEqual(recovered, {
    snapshot_id: fixture.snapshot.id,
    agencies: 3,
    vendors: 12,
    prices: 12,
    options: 12,
    mandatory_options: 2,
    published: true,
  });
});

test("the Supabase repository publishes only through the fenced promotion RPC with the admin actor", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data: null, error: null };
    },
  };
  const repository = createSupabasePriceDemoSeedRepository({
    target: "local",
    projectRef: "local",
    url: "http://127.0.0.1:54321",
    key: "sb_secret_sample_local_only",
    actorId: ADMIN_ACTOR_ID,
  }, client as never);
  const snapshotId = buildPriceDemoFixture().snapshot.id;

  await repository.promoteSnapshot(snapshotId, ADMIN_ACTOR_ID);

  assert.deepEqual(calls, [{
    name: "promote_price_snapshot",
    args: { p_snapshot_id: snapshotId, p_actor_id: ADMIN_ACTOR_ID },
  }]);

  await assert.rejects(
    repository.promoteSnapshot("d3c00000-0000-4000-8000-000000000099", ADMIN_ACTOR_ID),
    /canonical|fixture|snapshot/iu,
  );
  assert.equal(calls.length, 1);
});

test("runtime validation rejects a modified fixture before any seed write", async () => {
  const fixture = buildPriceDemoFixture();
  fixture.vendors[0].name = "Looks Like A Real Vendor";
  const repository = new MemoryPriceDemoRepository();

  await assert.rejects(
    applyPriceDemoFixture(repository, fixture, ADMIN_ACTOR_ID),
    /canonical|fixture|SAMPLE|데모/iu,
  );
  assert.equal(repository.agencies.size, 0);
  assert.equal(repository.vendors.size, 0);
});
