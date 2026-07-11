function expectedProjectRef(argv) {
  const index = argv.indexOf("--expected-project-ref");
  const value = index >= 0 ? argv[index + 1] : "";
  if (!/^[a-z0-9]{20}$/.test(value ?? "")) {
    throw new Error("--expected-project-ref is required.");
  }
  return value;
}

const expectedRef = expectedProjectRef(process.argv.slice(2));
const verifyAccessOnly = process.argv.includes("--verify-access-only");
const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl || !serviceRoleKey) {
  console.error("Supabase URL and service-role key are required in process env.");
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(baseUrl);
} catch {
  console.error("NEXT_PUBLIC_SUPABASE_URL is invalid.");
  process.exit(1);
}
if (parsedUrl.protocol !== "https:"
  || parsedUrl.hostname !== `${expectedRef}.supabase.co`) {
  console.error("Supabase URL does not match the expected project ref.");
  process.exit(1);
}

const bucketUrl = new URL(
  "/storage/v1/bucket/invitation-photos",
  parsedUrl
);
const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
};

// Storage can deliberately hide a missing bucket from non-service callers.
// Prove this credential at an authoritative Auth Admin boundary first; discard
// the returned user data immediately and never log it.
const authAdminUrl = new URL("/auth/v1/admin/users?page=1&per_page=1", parsedUrl);
const authAdminResponse = await fetch(authAdminUrl, {
  method: "GET",
  headers,
  signal: AbortSignal.timeout(10_000),
});
const authAdminBody = await authAdminResponse.json().catch(() => null);
if (authAdminResponse.status !== 200
  || authAdminBody === null
  || typeof authAdminBody !== "object"
  || !Array.isArray(authAdminBody.users)) {
  console.error("Credential is not authorized at the Supabase Auth Admin boundary.");
  process.exit(1);
}

function isExactMissingBucket(response, body) {
  return response.status === 400
    && body !== null
    && typeof body === "object"
    && body.statusCode === "404"
    && body.error === "Bucket not found"
    && body.message === "Bucket not found";
}

if (verifyAccessOnly) {
  const response = await fetch(bucketUrl, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => null);
  if (response.status !== 200 && !isExactMissingBucket(response, body)) {
    console.error("Storage service-role access preflight failed.");
    process.exit(1);
  }
  console.log("Storage service-role access is valid for the expected project.");
} else {
  const deleteResponse = await fetch(bucketUrl, {
  method: "DELETE",
  headers,
  signal: AbortSignal.timeout(10_000),
});
  const deleteBody = await deleteResponse.json().catch(() => null);
  if (deleteResponse.status !== 200
    && !isExactMissingBucket(deleteResponse, deleteBody)) {
    console.error(`Storage API refused bucket retirement (HTTP ${deleteResponse.status}).`);
    process.exit(1);
  }

  const verifyResponse = await fetch(bucketUrl, {
  method: "GET",
  headers,
  signal: AbortSignal.timeout(10_000),
});
  const verifyBody = await verifyResponse.json().catch(() => null);
  if (!isExactMissingBucket(verifyResponse, verifyBody)) {
    console.error("Invitation bucket still exists after the Storage API retirement step.");
    process.exit(1);
  }

  console.log("Invitation bucket is absent on the explicitly expected project.");
}
