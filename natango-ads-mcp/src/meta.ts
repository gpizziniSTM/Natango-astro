// Client Meta Marketing API minimale, sola lettura (solo chiamate GET).
//
// NB: il System User Token attualmente in uso ha anche ads_management e
// business_management (può scrivere). Questo modulo non chiama MAI un
// endpoint di scrittura, ma la restrizione "vera" va fatta lato Meta
// Business Manager con un System User dedicato in sola lettura (vedi README,
// sezione "Debito tecnico" — punto rimandato nella scelta "adattata ai tempi").

import { config } from "./env.js";

const GRAPH_BASE = () => `https://graph.facebook.com/${config.meta.apiVersion}`;

// --- Conversione valuta -----------------------------------------------
//
// Trappola nota dell'API Meta: alcuni campi monetari sono espressi nella
// sottounità minima della valuta (es. centesimi per EUR/USD), altri già
// nell'unità piena. Confonderli produce numeri sballati di un fattore 100.
//
//  - AdAccount.amount_spent, .balance, .spend_cap  -> sottounità (÷100)
//  - Campaign/AdSet.daily_budget, .lifetime_budget -> sottounità (÷100)
//  - Insights.spend (metaCampaignInsights)         -> GIÀ unità piena, non toccare
//
// Le valute "zero-decimal" (es. JPY, KRW) fanno eccezione: per queste
// l'API restituisce già l'unità piena, quindi niente divisione.
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG",
  "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

function toMajorUnits(raw: unknown, currency: string): number | null {
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  if (Number.isNaN(n)) return null;
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? n : n / 100;
}

async function metaGet(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${GRAPH_BASE()}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", config.meta.accessToken);

  const res = await fetch(url.toString(), { method: "GET" });
  const data = await res.json();

  if (!res.ok || data.error) {
    const msg = data?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Meta Graph API error: ${msg}`);
  }
  return data;
}

export interface MetaInsightsParams {
  campaignId?: string;
  /** today | yesterday | last_7d | last_14d | last_30d | this_month | last_month */
  datePreset?: string;
}

export async function metaCampaignInsights(params: MetaInsightsParams) {
  const datePreset = params.datePreset ?? "last_7d";
  const fields = [
    "campaign_name",
    "impressions",
    "clicks",
    "spend", // già in unità piena di valuta, nessuna conversione
    "ctr",
    "cpc",
    "reach",
    "actions",
    "cost_per_action_type",
  ].join(",");

  if (params.campaignId) {
    const data = await metaGet(`/${params.campaignId}/insights`, { fields, date_preset: datePreset });
    return data.data ?? [];
  }

  // Nessuna campagna specificata: rollup a livello di ad account, per campagna.
  const data = await metaGet(`/${config.meta.adAccountId}/insights`, {
    level: "campaign",
    fields,
    date_preset: datePreset,
  });
  return data.data ?? [];
}

export interface MetaStatusParams {
  includeCampaigns?: boolean;
}

export async function metaAdsStatus(params: MetaStatusParams = {}) {
  const rawAccount = await metaGet(`/${config.meta.adAccountId}`, {
    fields: "name,account_status,currency,amount_spent,balance,spend_cap",
  });

  const currency = rawAccount.currency ?? "EUR";

  const account = {
    ...rawAccount,
    amount_spent: toMajorUnits(rawAccount.amount_spent, currency),
    balance: toMajorUnits(rawAccount.balance, currency),
    spend_cap: toMajorUnits(rawAccount.spend_cap, currency),
  };

  let campaigns: unknown[] = [];
  if (params.includeCampaigns ?? true) {
    const campaignsRes = await metaGet(`/${config.meta.adAccountId}/campaigns`, {
      fields: "id,name,status,effective_status,daily_budget,lifetime_budget,objective,buying_type,smart_promotion_type",
    });
    campaigns = (campaignsRes.data ?? []).map((c: any) => ({
      ...c,
      daily_budget: c.daily_budget !== undefined ? toMajorUnits(c.daily_budget, currency) : undefined,
      lifetime_budget: c.lifetime_budget !== undefined ? toMajorUnits(c.lifetime_budget, currency) : undefined,
    }));
  }

  const tokenExpiry = config.meta.tokenExpiresAt
    ? (() => {
        const expiresAt = new Date(config.meta.tokenExpiresAt!);
        const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        return { expiresAt: expiresAt.toISOString(), daysLeft };
      })()
    : null;

  return {
    account,
    campaigns,
    tokenExpiry,
  };
}
