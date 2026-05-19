import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { from, retry, switchMap, throwError, timer } from 'rxjs';

const REMOTE_UI_HOSTS = new Set(['smartgarden.gloriaundphilipp.de', 'mach-nass.de']);

export const accessRetryInterceptor: HttpInterceptorFn = (request, next) => {
  if (!isRemoteApiRequest(request.url)) {
    return next(request);
  }

  return from(ensureRemoteProxySession()).pipe(
    switchMap(() => next(request)),
    retry({
      count: request.method.toUpperCase() === 'GET' ? 1 : 0,
      delay: (error) => {
        if (!isLikelyAccessRefreshError(error)) {
          return throwError(() => error);
        }
        proxySessionPromise = undefined;
        return from(ensureRemoteProxySession()).pipe(switchMap(() => timer(300)));
      }
    })
  );
};

let proxySessionPromise: Promise<void> | undefined;

function isRemoteApiRequest(url: string): boolean {
  if (!REMOTE_UI_HOSTS.has(globalThis.location?.hostname)) {
    return false;
  }
  if (url.startsWith('/api/')) {
    return true;
  }

  try {
    const parsed = new URL(url, globalThis.location?.origin);
    return REMOTE_UI_HOSTS.has(parsed.hostname) && parsed.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

function isLikelyAccessRefreshError(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) {
    return false;
  }

  // Cloudflare Access redirects stale XHR sessions to its login host. Browsers
  // surface that as status 0/CORS instead of a JSON response.
  return error.status === 0;
}

function ensureRemoteProxySession(): Promise<void> {
  proxySessionPromise ??= fetch('/auth/session', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store'
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`Remote proxy session failed with ${response.status}`);
    }
  });

  return proxySessionPromise;
}
