import fs from "node:fs";
import path from "node:path";

function readEnvFile(filePath) {
  const env = {};
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    const value = line
      .slice(index + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    env[key] = value;
  }
  return env;
}

const defaultEnvPath = path.join(process.cwd(), "apps", "web", ".env.local");
const envPath = process.env.SUPABASE_ENV_FILE ?? defaultEnvPath;
const fileEnv = fs.existsSync(envPath) ? readEnvFile(envPath) : {};
const env = { ...fileEnv, ...process.env };
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const expectedProjectRef = env.SUPABASE_EXPECTED_PROJECT_REF;

if (!supabaseUrl || !anonKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in process environment or SUPABASE_ENV_FILE."
  );
  process.exit(1);
}

if (
  expectedProjectRef &&
  !new URL(supabaseUrl).hostname.startsWith(`${expectedProjectRef}.`)
) {
  console.error("Supabase URL does not match SUPABASE_EXPECTED_PROJECT_REF.");
  process.exit(1);
}

const pageSize = 1_000;
const headers = {
  apikey: anonKey,
  Authorization: `Bearer ${anonKey}`,
};

async function fetchAll(relativeUrl) {
  const rows = [];

  for (let offset = 0; ; offset += pageSize) {
    const separator = relativeUrl.includes("?") ? "&" : "?";
    const response = await fetch(
      `${supabaseUrl}/rest/v1/${relativeUrl}${separator}limit=${pageSize}&offset=${offset}`,
      { headers }
    );

    if (!response.ok) {
      console.error(
        `Anonymous vendor probe request failed: status=${response.status}`
      );
      process.exit(1);
    }

    const page = await response.json();
    if (!Array.isArray(page)) {
      console.error("Anonymous vendor probe returned a non-array payload.");
      process.exit(1);
    }

    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

const [nonApprovedVendors, approvedVendors, products, images] =
  await Promise.all([
    fetchAll("vendors?select=id&status=neq.approved"),
    fetchAll("vendors?select=id&status=eq.approved"),
    fetchAll("vendor_products?select=id,vendor_id"),
    fetchAll("vendor_images?select=id,vendor_id"),
  ]);

if (nonApprovedVendors.length > 0) {
  console.error(
    `Anonymous vendor probe failed: ${nonApprovedVendors.length} non-approved vendor row(s) are visible.`
  );
  process.exit(1);
}

const approvedVendorIds = new Set(
  approvedVendors.map((vendor) => vendor.id).filter(Boolean)
);
const exposedProducts = products.filter(
  (product) => !approvedVendorIds.has(product.vendor_id)
);
const exposedImages = images.filter(
  (image) => !approvedVendorIds.has(image.vendor_id)
);

if (exposedProducts.length > 0 || exposedImages.length > 0) {
  console.error(
    `Anonymous vendor probe failed: non-approved product rows=${exposedProducts.length}, image rows=${exposedImages.length}.`
  );
  process.exit(1);
}

console.table([
  { surface: "non-approved vendors", visibleRows: 0 },
  { surface: "approved vendors", visibleRows: approvedVendors.length },
  { surface: "approved-vendor products", visibleRows: products.length },
  { surface: "approved-vendor images", visibleRows: images.length },
]);
console.log(
  "Anonymous vendor probe passed: every visible vendor surface is approval-scoped."
);
