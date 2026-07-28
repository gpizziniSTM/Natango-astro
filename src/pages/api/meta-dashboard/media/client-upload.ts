import type { APIRoute } from 'astro';
import { handleUpload } from '@vercel/blob/client';
import { readPolicy } from '../../../../lib/metaAdsConfig.js';

export const prerender = false;

function getEnvValue(name: string) {
  return import.meta.env[name] || process.env[name];
}

export const POST: APIRoute = async ({ request }) => {
  const policy = readPolicy();
  const body = await request.json();

  const response = await handleUpload({
    request,
    body,
    token: getEnvValue('BLOB_READ_WRITE_TOKEN'),
    onBeforeGenerateToken: async (pathname, clientPayload) => {
      const payload = JSON.parse(clientPayload || '{}');
      const maxBytes = policy.media.maxFileSizeMb * 1024 * 1024;

      if (!pathname.startsWith('dashboard/media/')) {
        throw new Error('Percorso media non consentito.');
      }

      if (!policy.media.allowedMimeTypes.includes(payload.mimeType)) {
        throw new Error('Formato media non consentito.');
      }

      if (Number(payload.size) > maxBytes) {
        throw new Error(`File troppo grande. Massimo ${policy.media.maxFileSizeMb} MB.`);
      }

      return {
        allowedContentTypes: policy.media.allowedMimeTypes,
        maximumSizeInBytes: maxBytes,
        allowOverwrite: true,
        tokenPayload: clientPayload,
      };
    },
  });

  return Response.json(response);
};
