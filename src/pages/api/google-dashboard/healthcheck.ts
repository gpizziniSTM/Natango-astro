import type { APIRoute } from 'astro';
import { runGoogleAdsHealthCheck } from '../../../lib/googleAdsConfig.js';

export const prerender = false;

export const POST: APIRoute = async () => {
  const result = await runGoogleAdsHealthCheck();
  return Response.json(result, { status: result.ok ? 200 : 400 });
};
