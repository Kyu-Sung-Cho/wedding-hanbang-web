// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const configSource = readFileSync(resolve(process.cwd(), 'next.config.ts'), 'utf8');
const redirectsStart = configSource.indexOf('async redirects()');
const rewritesStart = configSource.indexOf('async rewrites()');
const headersStart = configSource.indexOf('async headers()');
const redirectsSource = configSource.slice(redirectsStart, rewritesStart);
const rewritesSource = configSource.slice(rewritesStart, headersStart);

describe('SAI origin isolation', () => {
  it('navigates to the external origin instead of proxying it under hanbang.ai', () => {
    expect(redirectsStart).toBeGreaterThanOrEqual(0);
    expect(rewritesStart).toBeGreaterThan(redirectsStart);
    expect(headersStart).toBeGreaterThan(rewritesStart);
    expect(redirectsSource).toContain('source: "/sai"');
    expect(redirectsSource).toContain('source: "/sai/:path*"');
    expect(redirectsSource).toContain('destination: "https://sai-mu-nine.vercel.app"');
    expect(rewritesSource).not.toContain('sai-mu-nine.vercel.app');
  });

  it('does not treat the external application as a route-specific same-origin CSP surface', () => {
    expect(configSource).not.toContain('saiContentSecurityPolicy');
  });
});
