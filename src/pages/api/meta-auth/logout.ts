import type { APIRoute } from 'astro';
import { getAuthCookieName } from '../../../lib/metaDashboardAuth';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect }) => {
  cookies.delete(getAuthCookieName(), { path: '/' });

  return redirect('/meta-login', 303);
};
