import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { retry, throwError, timer } from 'rxjs';

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
