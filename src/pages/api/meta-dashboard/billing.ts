import type { APIRoute } from 'astro';
import { fetchMetaBillingOverview } from '../../../lib/metaAdsConfig.js';

export const prerender = false;

export const GET: APIRoute = async () => {
  const result = await fetchMetaBillingOverview();

  return Response.json(result, { status: result.ok ? 200 : 400 });
};
