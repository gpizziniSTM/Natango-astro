import type { APIRoute } from 'astro';
import {
  deleteDashboardMedia,
  readDashboardMedia,
  readDashboardPlan,
  writeDashboardPlan,
} from '../../../../lib/metaDashboardStorage.js';
import { readPolicy } from '../../../../lib/metaAdsConfig.js';

export const prerender = false;

function findAsset(plan: any, id?: string) {
  return (plan.mediaAssets || []).find((item: { id: string }) => item.id === id);
}

function fallbackAssetFromUrl(url: URL, id?: string) {
  const policy = readPolicy();
  const storedPath = url.searchParams.get('path') || '';
  const mimeType = url.searchParams.get('type') || '';
  const originalName = url.searchParams.get('name') || 'media';

  if (!id || !storedPath.startsWith(`dashboard/media/${id}`) || !policy.media.allowedMimeTypes.includes(mimeType)) {
    return null;
  }

  return {
    id,
    storedPath,
    mimeType,
    originalName,
    storage: 'blob',
  };
}

function fileNameHeader(fileName: string) {
  return `inline; filename="${encodeURIComponent(fileName)}"`;
}

function parseRange(rangeHeader: string | null, size: number) {
  if (!rangeHeader) {
    return null;
  }

  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);

  if (!match) {
    return null;
  }

  const [, startText, endText] = match;
  const start = startText ? Number(startText) : Math.max(size - Number(endText), 0);
  const end = endText && startText ? Number(endText) : size - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= size || start > end) {
    return { invalid: true as const };
  }

  return { start, end };
}

export const GET: APIRoute = async ({ params, request, url }) => {
  const plan = await readDashboardPlan();
  const asset = findAsset(plan, params.id) || fallbackAssetFromUrl(url, params.id);

  if (!asset) {
    return new Response('Media non trovato', { status: 404 });
  }

  const media = await readDashboardMedia(asset);

  if (!media) {
    return new Response('Media non disponibile', { status: 404 });
  }

  const bytes = Buffer.from(media.bytes);
  const range = parseRange(request.headers.get('range'), bytes.length);
  const baseHeaders = {
    'Content-Type': media.mimeType,
    'Cache-Control': 'private, max-age=60',
    'Content-Disposition': fileNameHeader(asset.originalName),
    'Accept-Ranges': 'bytes',
  };

  if (range?.invalid) {
    return new Response('Intervallo non valido', {
      status: 416,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes */${bytes.length}`,
      },
    });
  }

  if (range) {
    const chunk = bytes.subarray(range.start, range.end + 1);

    return new Response(chunk, {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Length': String(chunk.length),
        'Content-Range': `bytes ${range.start}-${range.end}/${bytes.length}`,
      },
    });
  }

  return new Response(media.bytes, {
    headers: {
      ...baseHeaders,
      'Content-Length': String(bytes.length),
    },
  });
};

export const DELETE: APIRoute = async ({ params }) => {
  const plan = await readDashboardPlan();
  const asset = findAsset(plan, params.id);

  if (!asset) {
    return Response.json({ ok: false, errors: ['Media non trovato.'] }, { status: 404 });
  }

  await deleteDashboardMedia(asset);

  const nextPlan = {
    ...plan,
    updatedAt: new Date().toISOString(),
    mediaAssets: (plan.mediaAssets || []).filter((item: { id: string }) => item.id !== params.id),
    ads: (plan.ads || []).map((ad: { mediaAssetId?: string }) =>
      ad.mediaAssetId === params.id ? { ...ad, mediaAssetId: null } : ad,
    ),
    actionLog: [
      {
        action: 'delete_media',
        result: 'ok',
        detail: `Media rimosso: ${asset.originalName}`,
        createdAt: new Date().toISOString(),
      },
      ...(Array.isArray(plan.actionLog) ? plan.actionLog : []),
    ].slice(0, 50),
  };

  await writeDashboardPlan(nextPlan);

  return Response.json({ ok: true, deletedId: params.id, plan: nextPlan });
};
