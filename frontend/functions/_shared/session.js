const SESSION_COOKIE = 'SG_PROXY_SESSION';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export async function createSessionCookie(request, env) {
  const accessJwt = request.headers.get('Cf-Access-Jwt-Assertion') || readCookie(request.headers.get('cookie') || '', 'CF_Authorization');
  if (!accessJwt) {
    return new Response('Cloudflare Access session missing', { status: 401 });
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS
  };
  const token = await signSession(payload, signingSecret(env));
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'set-cookie': `${SESSION_COOKIE}=${token}; Path=/api; Max-Age=${SESSION_MAX_AGE_SECONDS}; Secure; HttpOnly; SameSite=Lax`
    }
  });
}

export async function hasValidSession(request, env) {
  const token = readCookie(request.headers.get('cookie') || '', SESSION_COOKIE);
  if (!token) {
    return false;
  }

  const [payloadPart, signaturePart] = token.split('.');
  if (!payloadPart || !signaturePart) {
    return false;
  }

  const expectedSignature = await hmac(payloadPart, signingSecret(env));
  if (!constantTimeEqual(signaturePart, expectedSignature)) {
    return false;
  }

  try {
    const payload = JSON.parse(textFromBase64Url(payloadPart));
    return typeof payload.exp === 'number' && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function signingSecret(env) {
  return env.SMARTGARDEN_PROXY_SESSION_SECRET || env.CF_ACCESS_CLIENT_SECRET;
}

async function signSession(payload, secret) {
  const payloadPart = base64Url(JSON.stringify(payload));
  const signaturePart = await hmac(payloadPart, secret);
  return `${payloadPart}.${signaturePart}`;
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret || ''),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return base64UrlBytes(new Uint8Array(signature));
}

function readCookie(cookieHeader, name) {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function base64Url(value) {
  return base64UrlBytes(new TextEncoder().encode(value));
}

function base64UrlBytes(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function textFromBase64Url(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return atob(padded);
}
