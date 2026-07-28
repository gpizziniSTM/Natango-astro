import type { APIRoute } from 'astro';
import { readPolicy, validateCampaignPlan } from '../../../../lib/metaAdsConfig.js';
import { readDashboardPlan, writeDashboardPlan } from '../../../../lib/metaDashboardStorage.js';

export const prerender = false;

function validAsset(asset: any, policy: any) {
  const errors = [];
  const maxBytes = policy.media.maxFileSizeMb * 1024 * 1024;

  if (!asset?.id || !/^[a-f0-9-]{36}$/i.test(asset.id)) {
    errors.push('ID media non valido.');
  }

  if (!asset?.storedPath?.startsWith(`dashboard/media/${asset.id}`)) {
    errors.push('Percorso media non valido.');
  }

  if (!policy.media.allowedMimeTypes.includes(asset?.mimeType)) {
    errors.push('Formato media non consentito.');
  }

  if (Number(asset?.size) > maxBytes) {
    errors.push(`File troppo grande. Massimo ${policy.media.maxFileSizeMb} MB.`);
  }

  return errors;
}

export const POST: APIRoute = async ({ request }) => {
  const policy = readPolicy();
  const { asset } = await request.json().catch(() => ({ asset: null }));
  const assetErrors = validAsset(asset, policy);

  if (assetErrors.length > 0) {
    return Response.json({ ok: false, errors: assetErrors }, { status: 400 });
  }

  const plan = await readDashboardPlan();
  const existingAssets = Array.isArray(plan.mediaAssets) ? plan.mediaAssets : [];
  const nextAsset = {
    id: asset.id,
    originalName: asset.originalName,
    storedPath: asset.storedPath,
    extension: asset.extension,
    size: asset.size,
    mimeType: asset.mimeType,
    uploadedAt: asset.uploadedAt || new Date().toISOString(),
    status: 'uploaded',
    storage: 'blob',
    url: asset.url,
  };
  const nextPlan = {
    ...plan,
    updatedAt: new Date().toISOString(),
    mediaAssets: [...existingAssets.filter((item: { id: string }) => item.id !== nextAsset.id), nextAsset],
  };
  const errors = validateCampaignPlan(nextPlan, policy);

  if (errors.length > 0) {
    return Response.json({ ok: false, errors }, { status: 400 });
  }

  await writeDashboardPlan(nextPlan);

  return Response.json({ ok: true, asset: nextAsset, plan: nextPlan });
};
