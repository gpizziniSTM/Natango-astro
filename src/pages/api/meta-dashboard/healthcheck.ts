import type { APIRoute } from 'astro';
import { runMetaHealthCheck } from '../../../lib/metaAdsConfig.js';

export const prerender = false;

export const POST: APIRoute = async () => {
  const result = await runMetaHealthCheck();

  return Response.json(result, { status: result.ok ? 200 : 400 });
};
