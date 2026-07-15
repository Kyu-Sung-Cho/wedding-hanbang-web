// Vitest runs route modules outside Next.js' server-module graph. Production
// still resolves the real `server-only` guard; tests alias it to this marker.
export {};
