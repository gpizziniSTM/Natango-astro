import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { get, put } from '@vercel/blob';
import { defaultGoogleCampaignPlan } from './defaultGoogleCampaignPlan.js';

export const GOOGLE_PLAN_PATH = 'google-dry-runs/campaign-plan.json';
const GOOGLE_PLAN_BLOB_PATH = 'dashboard/google-campaign-plan.json';

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

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function readLocalGooglePlan() {
  if (!existsSync(GOOGLE_PLAN_PATH)) return structuredClone(defaultGoogleCampaignPlan);
  return JSON.parse(readFileSync(GOOGLE_PLAN_PATH, 'utf8'));
}

export async function readGoogleDashboardPlan() {
  if (!useBlobStorage()) return readLocalGooglePlan();

  const blob = await get(GOOGLE_PLAN_BLOB_PATH, { access: 'private', token: blobToken() });
  if (!blob) {
    const plan = readLocalGooglePlan();
    await writeGoogleDashboardPlan(plan);
    return plan;
  }

  return JSON.parse((await streamToBuffer(blob.stream)).toString('utf8'));
}

export async function writeGoogleDashboardPlan(plan) {
  if (!useBlobStorage()) {
    mkdirSync(dirname(GOOGLE_PLAN_PATH), { recursive: true });
    writeFileSync(GOOGLE_PLAN_PATH, `${JSON.stringify(plan, null, 2)}\n`);
    return plan;
  }

  await put(GOOGLE_PLAN_BLOB_PATH, JSON.stringify(plan, null, 2), {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: true,
    token: blobToken(),
  });
  return plan;
}
