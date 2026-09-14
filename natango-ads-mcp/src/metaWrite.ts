// Client Meta Marketing API — operazioni di SCRITTURA su campagne/adset/ads.
//
// Regole di sicurezza (non negoziabili, applicate qui e non lasciate al chiamante):
//  1. dryRun=true di default: il tool restituisce il payload che invierebbe,
//     senza inviarlo. Serve dryRun:false esplicito per scrivere.
//  2. Budget giornaliero cappato: META_MAX_DAILY_BUDGET (unità piena, default 10).
//  3. Nessuna scrittura di targeting senza almeno un luogo (mai "tutto il mondo").
//  4. Ogni scrittura reale viene loggata in mutations.jsonl con before/after.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./env.js";

const GRAPH_BASE = () => `https://graph.facebook.com/${config.meta.apiVersion}`;
const MAX_DAILY_BUDGET = Number(process.env.META_MAX_DAILY_BUDGET ?? "10");
const LOG_PATH = process.env.META_MUTATION_LOG ?? "/Users/gius/Documents/Natango/natango-ads-mcp/mutations.jsonl";

async function graph(method: "GET" | "POST", path: string, params: Record<string, string> = {}) {
  const url = new URL(`${GRAPH_BASE()}${path}`);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (method === "GET") url.searchParams.set(k, v);
    else body.set(k, v);
  }
  if (method === "GET") url.searchParams.set("access_token", config.meta.accessToken);
  else body.set("access_token", config.meta.accessToken);

  const res = await fetch(url.toString(), method === "GET" ? { method } : { method, body });
  const data = await res.json();
  if (!res.ok || data.error) {
    const e = data?.error;
    const msg = e ? `${e.message}${e.error_user_msg ? " — " + e.error_user_msg : ""} (code ${e.code}${e.error_subcode ? "/" + e.error_subcode : ""})` : `HTTP ${res.status}`;
    throw new Error(`Meta Graph API error: ${msg}`);
  }
  return data;
}

function logMutation(entry: Record<string, unknown>) {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {
    // il log non deve mai bloccare l'operazione
  }
}

const ADSET_FIELDS =
  "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,start_time,end_time,targeting,optimization_goal,bid_strategy";

export async function metaAdsetDetails(adsetId: string) {
  return graph("GET", `/${adsetId}`, { fields: ADSET_FIELDS });
}

export async function metaListAdsets(campaignId?: string) {
  const path = campaignId ? `/${campaignId}/adsets` : `/${config.meta.adAccountId}/adsets`;
  const data = await graph("GET", path, { fields: ADSET_FIELDS, limit: "50" });
  return data.data ?? [];
}

// --- update adset ------------------------------------------------------

export interface AdsetUpdateParams {
  adsetId: string;
  name?: string;
  status?: "ACTIVE" | "PAUSED";
  /** Unità piena (es. 5 = 5,00 €) */
  dailyBudget?: number;
  /** ISO 8601 con offset, es. 2026-10-31T23:59:00+0100 */
  endTime?: string;
  /** Raggio in km attorno a Roma centro; riscrive SOLO geo_locations, il resto del targeting resta */
  geoRadiusKm?: number;
  dryRun?: boolean;
}

function buildGeo(radiusKm: number) {
  return {
    custom_locations: [{ latitude: 41.9028, longitude: 12.4964, radius: radiusKm, distance_unit: "kilometer" }],
    location_types: ["home"],
  };
}

export async function metaUpdateAdset(p: AdsetUpdateParams) {
  const dryRun = p.dryRun ?? true;
  const before = await metaAdsetDetails(p.adsetId);
  const payload: Record<string, string> = {};

  if (p.name) payload.name = p.name;
  if (p.status) payload.status = p.status;
  if (p.dailyBudget !== undefined) {
    if (p.dailyBudget > MAX_DAILY_BUDGET) {
      throw new Error(`dailyBudget ${p.dailyBudget} supera il cap META_MAX_DAILY_BUDGET=${MAX_DAILY_BUDGET}`);
    }
    payload.daily_budget = String(Math.round(p.dailyBudget * 100));
  }
  if (p.endTime) payload.end_time = p.endTime;
  if (p.geoRadiusKm !== undefined) {
    if (p.geoRadiusKm < 1 || p.geoRadiusKm > 80) throw new Error("geoRadiusKm deve essere tra 1 e 80");
    const targeting = { ...(before.targeting ?? {}), geo_locations: buildGeo(p.geoRadiusKm) };
    payload.targeting = JSON.stringify(targeting);
  }
  if (Object.keys(payload).length === 0) throw new Error("Nessun campo da aggiornare");

  if (dryRun) return { dryRun: true, adsetId: p.adsetId, before, payload };

  const result = await graph("POST", `/${p.adsetId}`, payload);
  const after = await metaAdsetDetails(p.adsetId);
  logMutation({ op: "update_adset", adsetId: p.adsetId, payload, before, after, result });
  return { dryRun: false, result, after };
}

// --- status campagna / adset / ad --------------------------------------

export async function metaSetStatus(objectId: string, status: "ACTIVE" | "PAUSED", dryRun = true) {
  const before = await graph("GET", `/${objectId}`, { fields: "id,name,status,effective_status" });
  if (dryRun) return { dryRun: true, before, payload: { status } };
  const result = await graph("POST", `/${objectId}`, { status });
  const after = await graph("GET", `/${objectId}`, { fields: "id,name,status,effective_status" });
  logMutation({ op: "set_status", objectId, status, before, after });
  return { dryRun: false, result, after };
}

// --- duplicate adset (con ads) -----------------------------------------
//
// Usa l'endpoint nativo /{adset}/copies con deep_copy (copia anche le ads).
// La copia nasce PAUSED; poi si applicano nome/budget/date/geo con
// metaUpdateAdset e infine, se richiesto, si attiva. Il geo viene SEMPRE
// riscritto con location_types=home: è la ragione per cui la duplicazione
// da UI perdeva il luogo (opzione "recent+home" dismessa da Meta).

export interface AdsetDuplicateParams {
  sourceAdsetId: string;
  name: string;
  /** ISO 8601 con offset */
  startTime?: string;
  endTime: string;
  dailyBudget?: number;
  geoRadiusKm?: number;
  activate?: boolean;
  dryRun?: boolean;
}

export async function metaDuplicateAdset(p: AdsetDuplicateParams) {
  const dryRun = p.dryRun ?? true;
  const source = await metaAdsetDetails(p.sourceAdsetId);
  const budget = p.dailyBudget ?? (source.daily_budget ? Number(source.daily_budget) / 100 : undefined);
  if (budget !== undefined && budget > MAX_DAILY_BUDGET) {
    throw new Error(`dailyBudget ${budget} supera il cap META_MAX_DAILY_BUDGET=${MAX_DAILY_BUDGET}`);
  }
  const radius = p.geoRadiusKm ?? source.targeting?.geo_locations?.custom_locations?.[0]?.radius ?? 12;

  const copyPayload: Record<string, string> = {
    deep_copy: "true",
    status_option: "PAUSED",
    rename_options: JSON.stringify({ rename_strategy: "NO_RENAME" }),
  };
  if (p.startTime) copyPayload.start_time = p.startTime;
  copyPayload.end_time = p.endTime;

  const plan = {
    step1_copy: { endpoint: `/${p.sourceAdsetId}/copies`, payload: copyPayload },
    step2_update: { name: p.name, dailyBudget: budget, endTime: p.endTime, geoRadiusKm: radius },
    step3_activate: p.activate ?? false,
  };
  if (dryRun) return { dryRun: true, source, plan };

  const copy = await graph("POST", `/${p.sourceAdsetId}/copies`, copyPayload);
  const newId: string = copy.copied_adset_id ?? copy.ad_object_ids?.find((o: any) => o.ad_object_type === "adset")?.copied_id;
  if (!newId) throw new Error(`Copia creata ma ID non riconosciuto: ${JSON.stringify(copy)}`);

  await metaUpdateAdset({ adsetId: newId, name: p.name, dailyBudget: budget, endTime: p.endTime, geoRadiusKm: radius, dryRun: false });
  if (p.activate) await metaSetStatus(newId, "ACTIVE", false);

  const after = await metaAdsetDetails(newId);
  logMutation({ op: "duplicate_adset", sourceAdsetId: p.sourceAdsetId, newAdsetId: newId, plan, after });
  return { dryRun: false, newAdsetId: newId, after };
}

// --- update ad (landing / stato) ---------------------------------------

export async function metaUpdateAdLink(adId: string, newUrl: string, dryRun = true) {
  const ad = await graph("GET", `/${adId}`, { fields: "id,name,status,creative{id,object_story_spec,asset_feed_spec}" });
  const creative = ad.creative ?? {};
  // Le ads Meta sono immutabili nella creative: si crea una nuova creative con il link cambiato
  // e la si assegna all'ad. Qui copriamo solo il caso object_story_spec.link_data (single image/video).
  const spec = creative.object_story_spec;
  if (!spec?.link_data) {
    throw new Error("Creative non supportata (manca object_story_spec.link_data): cambia il link da UI");
  }
  const newSpec = { ...spec, link_data: { ...spec.link_data, link: newUrl } };
  if (dryRun) return { dryRun: true, adId, currentLink: spec.link_data.link, newSpec };

  const newCreative = await graph("POST", `/${config.meta.adAccountId}/adcreatives`, {
    object_story_spec: JSON.stringify(newSpec),
    name: `${creative.id}-link-${Date.now()}`,
  });
  const result = await graph("POST", `/${adId}`, { creative: JSON.stringify({ creative_id: newCreative.id }) });
  logMutation({ op: "update_ad_link", adId, from: spec.link_data.link, to: newUrl, newCreativeId: newCreative.id });
  return { dryRun: false, result, newCreativeId: newCreative.id };
}
