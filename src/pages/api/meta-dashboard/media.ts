import type { APIRoute } from 'astro';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MEDIA_DIR, readPolicy, validateCampaignPlan } from '../../../lib/metaAdsConfig.js';
import { readDashboardPlan, writeDashboardMedia, writeDashboardPlan } from '../../../lib/metaDashboardStorage.js';

export const prerender = false;

function safeExtension(fileName: string, mimeType: string) {
  const extension = extname(fileName).toLowerCase();

  if (['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov'].includes(extension)) {
    return extension;
  }

  const byMime: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
  };

  return byMime[mimeType] || '';
}

export const POST: APIRoute = async ({ request }) => {
  const policy = readPolicy();
  const formData = await request.formData();
  const files = formData.getAll('media').filter((value): value is File => value instanceof File);

  if (files.length === 0) {
    return Response.json({ ok: false, errors: ['Nessun file ricevuto.'] }, { status: 400 });
  }

  const maxBytes = policy.media.maxFileSizeMb * 1024 * 1024;
  const uploadedAssets = [];

  for (const file of files) {
    if (!policy.media.allowedMimeTypes.includes(file.type)) {
      return Response.json({ ok: false, errors: [`Formato non consentito: ${file.name}.`] }, { status: 400 });
    }

    if (file.size > maxBytes) {
      return Response.json(
        { ok: false, errors: [`File troppo grande: ${file.name}. Massimo ${policy.media.maxFileSizeMb} MB.`] },
        { status: 400 },
      );
    }

    const extension = safeExtension(file.name, file.type);

    if (!extension) {
      return Response.json({ ok: false, errors: [`Estensione non consentita: ${file.name}.`] }, { status: 400 });
    }

    const id = randomUUID();
    const storedFileName = `${id}${extension}`;
    const storedPath = `${MEDIA_DIR}/${storedFileName}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const asset = {
      id,
      originalName: file.name,
      storedPath,
      extension,
      size: file.size,
      mimeType: file.type,
      uploadedAt: new Date().toISOString(),
      status: 'local_only',
    };

    uploadedAssets.push(await writeDashboardMedia(asset, bytes));
  }

  const plan = await readDashboardPlan();
  const nextPlan = {
    ...plan,
    updatedAt: new Date().toISOString(),
    mediaAssets: [...(Array.isArray(plan.mediaAssets) ? plan.mediaAssets : []), ...uploadedAssets],
  };
  const errors = validateCampaignPlan(nextPlan, policy);

  if (errors.length > 0) {
    return Response.json({ ok: false, errors }, { status: 400 });
  }

  await writeDashboardPlan(nextPlan);

  return Response.json({ ok: true, assets: uploadedAssets, plan: nextPlan });
};
