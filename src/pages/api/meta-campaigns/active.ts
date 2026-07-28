import type { APIRoute } from 'astro';
import { fetchMetaCampaignOverview } from '../../../lib/metaAdsConfig.js';

export const prerender = false;

export const GET: APIRoute = async () => {
  const result = await fetchMetaCampaignOverview();

  return Response.json(result, { status: result.ok ? 200 : 400 });
};
