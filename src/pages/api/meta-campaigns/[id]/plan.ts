import type { APIRoute } from 'astro';
import { fetchMetaCampaignPlan } from '../../../../lib/metaAdsConfig.js';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const result = await fetchMetaCampaignPlan(params.id);

  return Response.json(result, { status: result.ok ? 200 : 400 });
};
