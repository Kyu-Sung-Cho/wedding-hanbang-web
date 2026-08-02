const ENCODED_CONTROL = /%(?:25)*(?:00|0a|0d)/iu;
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const PHONE_DESTINATION = /^\+?[0-9(). -]{3,32}$/u;

function containsRawControl(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function cleanRawUrl(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > 2048 || containsRawControl(raw) || ENCODED_CONTROL.test(raw)) {
    return null;
  }
  return raw;
}

function hostMatches(hostname, allowedDomains) {
  const host = hostname.toLowerCase();
  return allowedDomains.some((domain) => (
    host === domain || host.endsWith(`.${domain}`)
  ));
}

export function normalizeExternalHttpsUrl(value, allowedDomains = []) {
  const raw = cleanRawUrl(value);
  if (!raw) return null;
  try {
    const url = new globalThis.URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (allowedDomains.length > 0 && !hostMatches(url.hostname, allowedDomains)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeWebViewExternalUrl(value) {
  const httpsUrl = normalizeExternalHttpsUrl(value);
  if (httpsUrl) return httpsUrl;

  const raw = cleanRawUrl(value);
  if (!raw) return null;
  try {
    const url = new globalThis.URL(raw);
    if (url.protocol === "mailto:") {
      if (!EMAIL_ADDRESS.test(decodeURIComponent(url.pathname))) return null;
      return url.toString();
    }
    if (url.protocol === "tel:") {
      if (url.search || url.hash || !PHONE_DESTINATION.test(decodeURIComponent(url.pathname))) {
        return null;
      }
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}
