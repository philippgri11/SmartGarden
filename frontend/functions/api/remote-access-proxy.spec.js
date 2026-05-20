import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionCookie } from '../_shared/session.js';
import { onRequest } from './[[path]].js';

const env = {
  CF_ACCESS_CLIENT_ID: 'pages-token.access',
  CF_ACCESS_CLIENT_SECRET: 'service-secret',
  SMARTGARDEN_PROXY_SESSION_SECRET: 'session-secret'
};

describe('remote API Pages proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('turns upstream Cloudflare Access redirects into a retryable 401', async () => {
    const request = await apiRequestWithSession('/api/schedules/projection?days=7');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, {
        status: 302,
        headers: {
          location: 'https://bitter-waterfall-8d76.cloudflareaccess.com/cdn-cgi/access/login/mach-nass.de?redirect_url=/api/schedules/projection'
        }
      }))
    );

    const response = await onRequest({ request, env, params: { path: ['schedules', 'projection'] } });

    expect(response.status).toBe(401);
    expect(response.headers.get('X-SmartGarden-Access-Refresh')).toBe('required');
    expect(await response.text()).toContain('session refresh');
  });

  it('creates a proxy session from the Access cookie fallback', async () => {
    const response = await createSessionCookie(
      new Request('https://mach-nass.de/auth/session', {
        method: 'POST',
        headers: { cookie: 'CF_Authorization=access-jwt-from-cookie' }
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('SG_PROXY_SESSION=');
  });
});

async function apiRequestWithSession(path) {
  const session = await createSessionCookie(
    new Request('https://mach-nass.de/auth/session', {
      method: 'POST',
      headers: { 'Cf-Access-Jwt-Assertion': 'access-jwt' }
    }),
    env
  );
  const sessionCookie = session.headers.get('set-cookie')?.match(/SG_PROXY_SESSION=[^;]+/)?.[0];
  if (!sessionCookie) {
    throw new Error('session cookie missing');
  }

  return new Request(`https://mach-nass.de${path}`, {
    headers: {
      cookie: `${sessionCookie}; CF_Authorization=access-jwt`
    }
  });
}
