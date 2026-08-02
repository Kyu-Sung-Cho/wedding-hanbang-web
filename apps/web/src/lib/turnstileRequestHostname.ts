/**
 * Resolve the hostname that reached the Next request boundary.
 *
 * Deliberately ignore caller-supplied Host/X-Forwarded-Host header values.
 * Vercel/Next has already constructed `request.url` at its routing boundary;
 * Siteverify must match the challenge hostname to that canonical URL value.
 */
export function getTurnstileRequestHostname(request: Request): string | null {
  try {
    return new URL(request.url).hostname || null;
  } catch {
    return null;
  }
}
