import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { del, get, put } from '@vercel/blob';
import { defaultCampaignPlan } from './defaultCampaignPlan.js';
import { MEDIA_DIR, PLAN_PATH } from './metaAdsConfig.js';

const PLAN_BLOB_PATH = 'dashboard/campaign-plan.json';

function getEnvValue(name) {
  return import.meta.env?.[name] || process.env[name];
}

function useBlobStorage() {
  const isProduction = Boolean(import.meta.env?.PROD) || process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  return isProduction && Boolean(getEnvValue('BLOB_READ_WRITE_TOKEN'));
}

function blobToken() {
  return getEnvValue('BLOB_READ_WRITE_TOKEN');
}

export function readLocalPlan() {
  if (!existsSync(PLAN_PATH)) {
    return structuredClone(defaultCampaignPlan);
  }

  return JSON.parse(readFileSync(PLAN_PATH, 'utf8'));
}

async function streamToBuffer(stream) {
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

export async function readDashboardPlan() {
  if (!useBlobStorage()) {
    return readLocalPlan();
  }

  const blob = await get(PLAN_BLOB_PATH, { access: 'private', token: blobToken() });

  if (!blob) {
    const plan = readLocalPlan();
    await writeDashboardPlan(plan);
    return plan;
  }

  const bytes = await streamToBuffer(blob.stream);
  return JSON.parse(bytes.toString('utf8'));
}

export async function writeDashboardPlan(plan) {
  if (!useBlobStorage()) {
    mkdirSync(dirname(PLAN_PATH), { recursive: true });
    writeFileSync(PLAN_PATH, `${JSON.stringify(plan, null, 2)}\n`);
    return plan;
  }

  await put(PLAN_BLOB_PATH, JSON.stringify(plan, null, 2), {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: true,
    token: blobToken(),
  });

  return plan;
}

export async function writeDashboardMedia(asset, bytes) {
  if (!useBlobStorage()) {
    mkdirSync(MEDIA_DIR, { recursive: true });
    writeFileSync(asset.storedPath, bytes);
    return {
      ...asset,
      storage: 'local',
    };
  }

  const pathname = `dashboard/media/${asset.id}${asset.extension}`;
  const blob = await put(pathname, bytes, {
    access: 'private',
    contentType: asset.mimeType,
    allowOverwrite: true,
    token: blobToken(),
  });

  return {
    ...asset,
    storage: 'blob',
    storedPath: pathname,
    url: blob.url,
  };
}

export async function readDashboardMedia(asset) {
  if (asset.storage === 'blob' || useBlobStorage()) {
    const blob = await get(asset.storedPath, { access: 'private', token: blobToken() });

    if (!blob) {
      return null;
    }

    return {
      bytes: await streamToBuffer(blob.stream),
      mimeType: asset.mimeType,
    };
  }

  if (!existsSync(asset.storedPath)) {
    return null;
  }

  return {
    bytes: readFileSync(asset.storedPath),
    mimeType: asset.mimeType,
  };
}

export async function deleteDashboardMedia(asset) {
  if (asset.storage === 'blob' || useBlobStorage()) {
    if (asset.storedPath) {
      await del(asset.storedPath, { token: blobToken() });
    }

    return;
  }

  if (asset.storedPath && existsSync(asset.storedPath)) {
    rmSync(asset.storedPath, { force: true });
  }
}
