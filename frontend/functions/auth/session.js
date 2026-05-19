import { createSessionCookie } from '../_shared/session.js';

export async function onRequestPost({ request, env }) {
  return createSessionCookie(request, env);
}
