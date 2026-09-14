// Client Google Ads minimale, sola lettura.
//
// Volutamente NON usa una libreria client full (mutate incluse): chiama solo
// l'endpoint REST `googleAds:search`, che è read-only per costruzione.
// Autenticazione via service account (JWT), come da flusso raccomandato da
// Google per applicazioni server-to-server su account già di proprietà:
// https://developers.google.com/google-ads/api/docs/oauth/service-accounts

import { JWT } from "google-auth-library";
import { readFileSync } from "node:fs";
import { config } from "./env.js";

const SCOPE = "https://www.googleapis.com/auth/adwords";

let cachedClient: JWT | undefined;

function getJwtClient(): JWT {
  if (cachedClient) return cachedClient;
  const keyFile = JSON.parse(readFileSync(config.google.serviceAccountJson, "utf-8"));
  cachedClient = new JWT({
    email: keyFile.client_email,
    key: keyFile.private_key,
    scopes: [SCOPE],
  });
  return cachedClient;
}

async function getAccessToken(): Promise<string> {
  const client = getJwtClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Impossibile ottenere un access token Google Ads (service account).");
  return token;
}

interface GoogleAdsRow {
  [key: string]: unknown;
}

/**
 * Esegue una query GAQL contro `customers/{customerId}/googleAds:search`
 * e restituisce tutte le righe, paginando fino a un tetto di sicurezza.
 */
export async function gaqlSearch(customerId: string, query: string): Promise<GoogleAdsRow[]> {
  const accessToken = await getAccessToken();
  const baseUrl = `https://googleads.googleapis.com/${config.google.apiVersion}/customers/${customerId}/googleAds:search`;

  const rows: GoogleAdsRow[] = [];
  let pageToken: string | undefined;
  const MAX_PAGES = 10;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "developer-token": config.google.developerToken,
        "login-customer-id": config.google.loginCustomerId,
      },
      body: JSON.stringify({
        query,
        pageToken,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Google Ads API error (${res.status}): ${body}`);
    }

    const data = (await res.json()) as { results?: GoogleAdsRow[]; nextPageToken?: string };
    rows.push(...(data.results ?? []));

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return rows;
}

function microsToAmount(micros: unknown): number | null {
  if (typeof micros !== "string" && typeof micros !== "number") return null;
  return Number(micros) / 1_000_000;
}

export interface CampaignReportParams {
  customerId?: string;
  campaignId?: string;
  /** LAST_7_DAYS | LAST_14_DAYS | LAST_30_DAYS | THIS_MONTH | LAST_MONTH | YESTERDAY */
  dateRange?: string;
}

export async function googleCampaignReport(params: CampaignReportParams) {
  const customerId = params.customerId ?? config.google.customerId;
  const dateRange = params.dateRange ?? "LAST_7_DAYS";
  const campaignFilter = params.campaignId ? `AND campaign.id = ${Number(params.campaignId)}` : "";

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date DURING ${dateRange}
    ${campaignFilter}
    ORDER BY metrics.cost_micros DESC
  `.trim();

  const rows = await gaqlSearch(customerId, query);

  return rows.map((r: any) => ({
    campaignId: r.campaign?.id,
    campaignName: r.campaign?.name,
    status: r.campaign?.status,
    impressions: Number(r.metrics?.impressions ?? 0),
    clicks: Number(r.metrics?.clicks ?? 0),
    costCurrency: microsToAmount(r.metrics?.costMicros),
    ctr: r.metrics?.ctr ?? null,
    avgCpc: microsToAmount(r.metrics?.averageCpc),
    conversions: r.metrics?.conversions ?? null,
    conversionsValue: r.metrics?.conversionsValue ?? null,
  }));
}

export interface CampaignDiagnosisParams {
  customerId?: string;
  campaignId?: string;
}

/**
 * Diagnostica del perché una campagna non sta erogando (0 impression pur
 * essendo ENABLED): usa campaign.primary_status / primary_status_reasons
 * (i motivi espliciti di Google) più le date di inizio/fine campagna, che
 * sono la causa più comune per una campagna nuova ancora a zero.
 * Nessun filtro di data: sono attributi della campagna, non metriche.
 */
export async function googleCampaignDiagnosis(params: CampaignDiagnosisParams) {
  const customerId = params.customerId ?? config.google.customerId;
  const filter = params.campaignId
    ? `WHERE campaign.id = ${Number(params.campaignId)}`
    : `WHERE campaign.status != 'REMOVED'`;

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.primary_status,
      campaign.primary_status_reasons,
      campaign.start_date_time,
      campaign.end_date_time,
      campaign.serving_status,
      campaign.advertising_channel_type
    FROM campaign
    ${filter}
  `.trim();

  const rows = await gaqlSearch(customerId, query);

  return rows.map((r: any) => ({
    campaignId: r.campaign?.id,
    campaignName: r.campaign?.name,
    status: r.campaign?.status,
    primaryStatus: r.campaign?.primaryStatus,
    primaryStatusReasons: r.campaign?.primaryStatusReasons ?? [],
    startDate: r.campaign?.startDateTime,
    endDate: r.campaign?.endDateTime,
    servingStatus: r.campaign?.servingStatus,
    channelType: r.campaign?.advertisingChannelType,
  }));
}

export interface ConversionReportParams {
  customerId?: string;
  dateRange?: string;
}

export async function googleConversionReport(params: ConversionReportParams) {
  const customerId = params.customerId ?? config.google.customerId;
  const dateRange = params.dateRange ?? "LAST_30_DAYS";

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      segments.conversion_action_name,
      metrics.conversions,
      metrics.conversions_value,
      metrics.cost_per_conversion
    FROM campaign
    WHERE segments.date DURING ${dateRange}
      AND metrics.conversions > 0
    ORDER BY metrics.conversions_value DESC
  `.trim();

  const rows = await gaqlSearch(customerId, query);

  return rows.map((r: any) => ({
    campaignId: r.campaign?.id,
    campaignName: r.campaign?.name,
    conversionAction: r.segments?.conversionActionName,
    conversions: r.metrics?.conversions ?? null,
    conversionsValue: r.metrics?.conversionsValue ?? null,
    costPerConversion: microsToAmount(r.metrics?.costPerConversion),
  }));
}
