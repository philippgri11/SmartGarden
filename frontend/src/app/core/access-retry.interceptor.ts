import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, retry, throwError, timer } from 'rxjs';

const REMOTE_UI_HOST = 'smartgarden.gloriaundphilipp.de';

export const accessRetryInterceptor: HttpInterceptorFn = (request, next) => {
  if (!isRemoteReadRequest(request.method, request.url)) {
    return next(request);
  }

  return next(request).pipe(
    retry({
      count: 2,
      delay: (error, retryCount) => {
        if (!isLikelyAccessRefreshError(error)) {
          return throwError(() => error);
        }
        return timer(retryCount === 1 ? 600 : 1600);
      }
    }),
    catchError((error) => {
      if (isLikelyAccessRefreshError(error)) {
        triggerAccessReauthentication();
      }
      return throwError(() => error);
    })
  );
};

function isRemoteReadRequest(method: string, url: string): boolean {
  if (method.toUpperCase() !== 'GET') {
    return false;
  }
  if (globalThis.location?.hostname !== REMOTE_UI_HOST) {
    return false;
  }
  if (url.startsWith('/api/')) {
    return true;
  }

  try {
    const parsed = new URL(url, globalThis.location?.origin);
    return parsed.hostname === REMOTE_UI_HOST && parsed.pathname.startsWith('/api/');
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

function triggerAccessReauthentication(): void {
  const now = Date.now();
  const storageKey = 'smartgarden:last-access-reauth';
  const lastRedirect = Number(readSessionValue(storageKey) || '0');
  if (now - lastRedirect < 10000) {
    return;
  }

  writeSessionValue(storageKey, String(now));
  globalThis.location?.assign(globalThis.location.href);
}

function readSessionValue(key: string): string | null {
  try {
    return globalThis.sessionStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeSessionValue(key: string, value: string): void {
  try {
    globalThis.sessionStorage?.setItem(key, value);
  } catch {
    // If sessionStorage is unavailable, reloading once is still preferable to
    // leaving the remote UI in a half-authenticated state.
  }
}
