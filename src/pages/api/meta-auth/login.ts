import type { APIRoute } from 'astro';
import { authCookieOptions, createSessionCookie, getAuthCookieName, verifyCredentials } from '../../../lib/metaDashboardAuth';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect, request }) => {
  const formData = await request.formData();
  const username = String(formData.get('username') || '');
  const password = String(formData.get('password') || '');

  if (!verifyCredentials(username, password)) {
    return redirect('/meta-login?error=Credenziali%20non%20valide', 303);
  }

  cookies.set(getAuthCookieName(), createSessionCookie(username), authCookieOptions());

  return redirect('/meta-dashboard', 303);
};
