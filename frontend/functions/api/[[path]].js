import { hasValidSession } from '../_shared/session.js';

const API_ORIGIN = 'https://smartgarden-api.gloriaundphilipp.de';
const REMOTE_UI_HOSTS = new Set(['smartgarden.gloriaundphilipp.de', 'mach-nass.de']);
const ACCESS_REFRESH_HEADER = 'X-SmartGarden-Access-Refresh';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'cookie',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

export async function onRequest(context) {
  const { request, env, params } = context;
  const requestUrl = new URL(request.url);
  if (!REMOTE_UI_HOSTS.has(requestUrl.hostname)) {
    return new Response('Not found', { status: 404 });
  }

  if (!(await hasValidSession(request, env))) {
    return new Response('Remote proxy session missing', {
      status: 401,
      headers: {
        'content-type': 'text/plain',
        'cache-control': 'no-store'
      }
    });
  }

  const path = Array.isArray(params.path) ? params.path.join('/') : params.path || '';
  const targetUrl = new URL(`/api/${path}`, API_ORIGIN);
  targetUrl.search = requestUrl.search;

  const uiAccessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || getCookie(request.headers.get('Cookie'), 'CF_Authorization');
  const headers = new Headers(request.headers);
  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }
  for (const header of Array.from(headers.keys())) {
    if (header.toLowerCase().startsWith('cf-access')) {
      headers.delete(header);
    }
  }
  if (uiAccessJwt) {
    headers.set('X-SmartGarden-Access-Jwt', uiAccessJwt);
  }

  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers.set('CF-Access-Client-Id', env.CF_ACCESS_CLIENT_ID);
    headers.set('CF-Access-Client-Secret', env.CF_ACCESS_CLIENT_SECRET);
    headers.set('X-SmartGarden-Access-Service-Token-Id', env.CF_ACCESS_CLIENT_ID);
    headers.set('X-SmartGarden-Pages-Proxy-Id', env.CF_ACCESS_CLIENT_ID);
  }

  const response = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual'
  });

  if (isCloudflareAccessRedirect(response)) {
    return new Response('Cloudflare Access session refresh required', {
      status: 401,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'text/plain',
        [ACCESS_REFRESH_HEADER]: 'required'
      }
    });
  }

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  responseHeaders.delete('transfer-encoding');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  });
}

function isCloudflareAccessRedirect(response) {
  if (![301, 302, 303, 307, 308].includes(response.status)) {
    return false;
  }

  const location = response.headers.get('location') || '';
  return location.includes('/cdn-cgi/access/login/') || location.includes('.cloudflareaccess.com/');
}

function getCookie(cookieHeader, name) {
  if (!cookieHeader) {
    return '';
  }
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) {
      return rawValue.join('=');
    }
  }
  return '';
}
