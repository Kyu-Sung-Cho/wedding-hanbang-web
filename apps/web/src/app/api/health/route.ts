const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

function healthy() {
  return new Response(null, {
    status: 204,
    headers: NO_STORE_HEADERS,
  });
}

export const dynamic = "force-dynamic";

export function GET() {
  return healthy();
}

export function HEAD() {
  return healthy();
}
