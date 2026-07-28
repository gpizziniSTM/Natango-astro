import { existsSync, readFileSync } from 'node:fs';
import { defaultCampaignPlan } from './defaultCampaignPlan.js';
import { defaultMetaAdsPolicy } from './defaultMetaAdsPolicy.js';

export const GRAPH_API_VERSION = 'v25.0';
export const POLICY_PATH = 'config/meta-ads-policy.json';
export const PLAN_PATH = 'meta-dry-runs/campaign-plan.json';
export const MEDIA_DIR = 'meta-assets';

export function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readLocalEnv(path = '.env') {
  if (!existsSync(path)) {
    return {};
  }

  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return index === -1 ? [line, ''] : [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

export function getMetaEnv() {
  const astroEnv = import.meta.env || {};
  const runtimeEnv = process.env || {};
  const localEnv = readLocalEnv();

  return {
    appId: astroEnv.META_APP_ID || runtimeEnv.META_APP_ID || localEnv.META_APP_ID,
    adAccountId: astroEnv.META_AD_ACCOUNT_ID || runtimeEnv.META_AD_ACCOUNT_ID || localEnv.META_AD_ACCOUNT_ID,
    accessToken: astroEnv.META_ACCESS_TOKEN || runtimeEnv.META_ACCESS_TOKEN || localEnv.META_ACCESS_TOKEN,
    dailyBudgetCapEur:
      astroEnv.META_DAILY_BUDGET_CAP_EUR || runtimeEnv.META_DAILY_BUDGET_CAP_EUR || localEnv.META_DAILY_BUDGET_CAP_EUR,
    timezone: astroEnv.META_TIMEZONE || runtimeEnv.META_TIMEZONE || localEnv.META_TIMEZONE,
  };
}

export function readPolicy() {
  if (!existsSync(POLICY_PATH)) {
    return structuredClone(defaultMetaAdsPolicy);
  }

  return readJsonFile(POLICY_PATH);
}

export function getBudgetLimits(plan, policy) {
  const absoluteMaxDailyBudgetEur = Number(
    policy.budget.absoluteMaxDailyBudgetEur || policy.budget.maxConfigurableDailyBudgetEur || policy.budget.maxDailyBudgetEur,
  );
  const requestedMaxDailyBudgetEur = Number(plan.budgetGuard?.maxDailyBudgetEur ?? policy.budget.maxDailyBudgetEur);
  const maxDailyBudgetEur = Math.min(requestedMaxDailyBudgetEur, absoluteMaxDailyBudgetEur);
  const absoluteMaxCampaignBudgetEur = Number(policy.budget.absoluteMaxCampaignBudgetEur || policy.budget.maxCampaignBudgetEur || 500);
  const requestedMaxCampaignBudgetEur = Number(plan.budgetGuard?.maxCampaignBudgetEur ?? policy.budget.maxCampaignBudgetEur ?? absoluteMaxCampaignBudgetEur);
  const maxCampaignBudgetEur = Math.min(requestedMaxCampaignBudgetEur, absoluteMaxCampaignBudgetEur);

  return {
    maxDailyBudgetEur,
    absoluteMaxDailyBudgetEur,
    maxCampaignBudgetEur,
    absoluteMaxCampaignBudgetEur,
  };
}

export function validateCampaignPlan(plan, policy) {
  const errors = [];

  if (!plan || typeof plan !== 'object') {
    return ['Il piano campagna non e un oggetto JSON valido.'];
  }

  if (plan.account?.id !== policy.account.id) {
    errors.push(`Account non valido: ${plan.account?.id || 'mancante'}.`);
  }

  if (plan.dryRun !== true) {
    errors.push('Il piano deve restare in modalita dry-run.');
  }

  if (plan.writeCallsAllowed !== false) {
    errors.push('Le scritture Meta devono restare disabilitate.');
  }

  if (plan.campaign?.status !== 'PAUSED' && plan.campaign?.status !== 'DRAFT') {
    errors.push('Lo stato campagna deve essere PAUSED o DRAFT.');
  }

  const dailyBudget = Number(plan.campaign?.dailyBudgetEur);
  const budgetLimits = getBudgetLimits(plan, policy);
  const requestedBudgetLimit = Number(plan.budgetGuard?.maxDailyBudgetEur ?? policy.budget.maxDailyBudgetEur);
  const requestedCampaignBudgetLimit = Number(
    plan.budgetGuard?.maxCampaignBudgetEur ?? policy.budget.maxCampaignBudgetEur ?? budgetLimits.absoluteMaxCampaignBudgetEur,
  );

  if (!Number.isFinite(requestedBudgetLimit) || requestedBudgetLimit < 1) {
    errors.push('Tetto budget non valido: minimo 1 EUR/giorno.');
  }

  if (requestedBudgetLimit > budgetLimits.absoluteMaxDailyBudgetEur) {
    errors.push(`Tetto budget sopra il limite assoluto di ${budgetLimits.absoluteMaxDailyBudgetEur} EUR/giorno.`);
  }

  if (!Number.isFinite(requestedCampaignBudgetLimit) || requestedCampaignBudgetLimit < 1) {
    errors.push('Tetto campagna non valido: minimo 1 EUR.');
  }

  if (requestedCampaignBudgetLimit > budgetLimits.absoluteMaxCampaignBudgetEur) {
    errors.push(`Tetto campagna sopra il limite assoluto di ${budgetLimits.absoluteMaxCampaignBudgetEur} EUR.`);
  }

  if (!Number.isFinite(dailyBudget) || dailyBudget < 1) {
    errors.push('Budget giornaliero non valido: minimo 1 EUR/giorno.');
  }

  if (dailyBudget > budgetLimits.maxDailyBudgetEur) {
    errors.push(`Budget sopra il tetto di ${budgetLimits.maxDailyBudgetEur} EUR/giorno.`);
  }

  const durationDays = Number(plan.campaign?.durationDays ?? 10);

  if (!Number.isFinite(durationDays) || durationDays < 1 || durationDays > 90) {
    errors.push('Durata campagna non valida: deve essere tra 1 e 90 giorni.');
  }

  if (!Array.isArray(plan.ads) || plan.ads.length === 0) {
    errors.push('Serve almeno un annuncio nel piano.');
  }

  if (!Array.isArray(plan.adSets) || plan.adSets.length === 0) {
    errors.push('Serve almeno un pubblico/ad set nel piano.');
  }

  if (plan.mediaAssets && !Array.isArray(plan.mediaAssets)) {
    errors.push('Gli asset media devono essere una lista.');
  }

  if (policy.tracking?.pixelId && plan.tracking?.pixelId && plan.tracking.pixelId !== policy.tracking.pixelId) {
    errors.push('Pixel ID non coerente con la policy.');
  }

  const serializedPlan = JSON.stringify(plan);

  if (/EA[A-Za-z0-9]{20,}/.test(serializedPlan) || serializedPlan.includes('META_ACCESS_TOKEN')) {
    errors.push('Il piano sembra contenere un token o un riferimento a segreti.');
  }

  return errors;
}

export function getDashboardValidation(plan, policy) {
  const adsWithText = plan.ads?.filter((ad) => ad.primaryText?.trim() && ad.headline?.trim()) ?? [];
  const mediaCount = plan.mediaAssets?.length ?? 0;
  const budgetLimits = getBudgetLimits(plan, policy);
  const checks = [
    {
      id: 'account',
      label: 'Account Meta',
      ok: plan.account?.id === policy.account.id,
      detail: plan.account?.id === policy.account.id ? policy.account.name : 'Account non corrispondente',
    },
    {
      id: 'budget',
      label: 'Budget',
      ok: Number(plan.campaign?.dailyBudgetEur) <= budgetLimits.maxDailyBudgetEur,
      detail: `${plan.campaign?.dailyBudgetEur ?? 0} EUR/giorno`,
    },
    {
      id: 'campaign_status',
      label: 'Stato campagna',
      ok: plan.campaign?.status === 'PAUSED' || plan.campaign?.status === 'DRAFT',
      detail: plan.campaign?.status || 'Mancante',
    },
    {
      id: 'ad_copy',
      label: 'Testi annunci',
      ok: adsWithText.length === plan.ads?.length && adsWithText.length > 0,
      detail: `${adsWithText.length}/${plan.ads?.length ?? 0} completi`,
    },
    {
      id: 'media',
      label: 'Media',
      ok: mediaCount > 0,
      detail: mediaCount > 0 ? `${mediaCount} asset caricati` : 'Nessun media caricato',
    },
    {
      id: 'safe_mode',
      label: 'Modalita sicura',
      ok: plan.dryRun === true && plan.writeCallsAllowed === false,
      detail: plan.writeCallsAllowed
        ? 'Scritture non protette'
        : policy.access?.allowCreate
          ? 'Solo creazione in PAUSED; attivazione bloccata'
          : 'Dry-run, scritture bloccate',
    },
    {
      id: 'secrets',
      label: 'Segreti',
      ok: plan.safetyChecks?.tokenIncludedInOutput === false,
      detail: 'Token non incluso nel piano',
    },
    {
      id: 'pixel',
      label: 'Pixel',
      ok: plan.tracking?.pixelId === policy.tracking?.pixelId && plan.tracking?.activeEvents?.includes('Lead'),
      detail: plan.tracking?.pixelId ? `Pixel ${plan.tracking.pixelId}, Lead attivo` : 'Pixel non configurato',
    },
  ];

  return {
    checks,
    ready: checks.every((check) => check.ok),
  };
}

export async function runMetaHealthCheck() {
  const env = getMetaEnv();
  const policy = readPolicy();
  const required = ['appId', 'adAccountId', 'accessToken', 'dailyBudgetCapEur', 'timezone'];
  const missing = required.filter((key) => !env[key]?.trim());

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Configurazione mancante: ${missing.join(', ')}`,
    };
  }

  const budgetCap = Number(env.dailyBudgetCapEur);
  const policyAbsoluteBudgetCap = Number(
    policy.budget.absoluteMaxDailyBudgetEur || policy.budget.maxConfigurableDailyBudgetEur || policy.budget.maxDailyBudgetEur,
  );

  if (!Number.isFinite(budgetCap) || budgetCap <= 0 || budgetCap > policyAbsoluteBudgetCap) {
    return {
      ok: false,
      error: `Budget locale non valido: massimo ${policyAbsoluteBudgetCap} EUR/giorno.`,
    };
  }

  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${env.adAccountId}`);
  url.searchParams.set('fields', 'account_id,name,account_status,currency,timezone_name');
  url.searchParams.set('access_token', env.accessToken);

  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload.error?.message || 'Errore Meta API.',
    };
  }

  const mismatches = [
    payload.id === policy.account.id ? null : `account id ${payload.id}`,
    payload.name === policy.account.name ? null : `account name ${payload.name}`,
    payload.currency === policy.account.currency ? null : `currency ${payload.currency}`,
    payload.timezone_name === policy.account.timezone ? null : `timezone ${payload.timezone_name}`,
  ].filter(Boolean);

  return {
    ok: mismatches.length === 0,
    account: {
      id: payload.id,
      name: payload.name,
      status: payload.account_status,
      currency: payload.currency,
      timezone: payload.timezone_name,
    },
    safety: {
      graphApiVersion: GRAPH_API_VERSION,
      policyPath: POLICY_PATH,
      dailyBudgetCapEur: budgetCap,
      maxDailyBudgetEur: policy.budget.maxDailyBudgetEur,
      absoluteMaxDailyBudgetEur: policyAbsoluteBudgetCap,
      maxCampaignBudgetEur: policy.budget.maxCampaignBudgetEur,
      absoluteMaxCampaignBudgetEur: policy.budget.absoluteMaxCampaignBudgetEur,
      defaultMode: policy.access.defaultMode,
      tokenPresent: true,
      tokenPrinted: false,
      readOnly: policy.access?.allowCreate !== true,
      createPausedOnly: policy.access?.allowCreate === true && policy.access?.allowPublish !== true,
    },
    mismatches,
  };
}

function normalizeMoneyCents(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return numericValue / 100;
}

function readLeadCount(actions = []) {
  if (!Array.isArray(actions)) {
    return 0;
  }

  return actions
    .filter((action) => ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'].includes(action.action_type))
    .reduce((total, action) => total + Number(action.value || 0), 0);
}

function clampPolicyBudget(value, policy) {
  const absoluteMaxDailyBudgetEur = Number(
    policy.budget.absoluteMaxDailyBudgetEur || policy.budget.maxConfigurableDailyBudgetEur || policy.budget.maxDailyBudgetEur,
  );
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return Number(policy.budget.initialDailyBudgetEur || policy.budget.maxDailyBudgetEur || 1);
  }

  return Math.min(Math.max(Math.round(numericValue), 1), absoluteMaxDailyBudgetEur);
}

function readCreativeText(ad) {
  const creative = ad.creative || {};
  const storySpec = creative.object_story_spec || {};
  const linkData = storySpec.link_data || {};
  const videoData = storySpec.video_data || {};
  const callToAction = linkData.call_to_action || videoData.call_to_action || {};
  const callToActionValue = callToAction.value || {};

  return {
    primaryText: linkData.message || videoData.message || creative.body || '',
    headline: linkData.name || videoData.title || creative.title || ad.name || 'Annuncio Meta',
    description: linkData.description || creative.body || '',
    callToAction: callToAction.type || 'LEARN_MORE',
    destinationUrl: linkData.link || callToActionValue.link || defaultCampaignPlan.campaign.destinationUrl,
  };
}

export async function fetchMetaCampaignOverview() {
  const env = getMetaEnv();
  const policy = readPolicy();
  const required = ['adAccountId', 'accessToken'];
  const missing = required.filter((key) => !env[key]?.trim());

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Configurazione mancante: ${missing.join(', ')}`,
    };
  }

  const fields = [
    'id',
    'name',
    'status',
    'effective_status',
    'objective',
    'daily_budget',
    'lifetime_budget',
    'budget_remaining',
    'start_time',
    'stop_time',
    'created_time',
    'updated_time',
    'insights.date_preset(last_30d){spend,impressions,clicks,ctr,cpc,actions}',
  ].join(',');

  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${env.adAccountId}/campaigns`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('limit', '100');
  url.searchParams.set('access_token', env.accessToken);

  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload.error?.message || 'Errore Meta API.',
    };
  }

  const campaigns = (payload.data || [])
    .filter((campaign) => !['ARCHIVED', 'DELETED'].includes(campaign.effective_status))
    .map((campaign) => {
      const insights = campaign.insights?.data?.[0] || {};
      const spend = Number(insights.spend || 0);
      const clicks = Number(insights.clicks || 0);
      const impressions = Number(insights.impressions || 0);
      const leads = readLeadCount(insights.actions);

      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        effectiveStatus: campaign.effective_status,
        objective: campaign.objective,
        dailyBudgetEur: normalizeMoneyCents(campaign.daily_budget),
        lifetimeBudgetEur: normalizeMoneyCents(campaign.lifetime_budget),
        budgetRemainingEur: normalizeMoneyCents(campaign.budget_remaining),
        startTime: campaign.start_time || null,
        stopTime: campaign.stop_time || null,
        createdTime: campaign.created_time || null,
        updatedTime: campaign.updated_time || null,
        insights: {
          datePreset: 'last_30d',
          spend,
          impressions,
          clicks,
          ctr: Number(insights.ctr || 0),
          cpc: Number(insights.cpc || 0),
          leads,
        },
      };
    });

  const totals = campaigns.reduce(
    (summary, campaign) => ({
      spend: summary.spend + campaign.insights.spend,
      impressions: summary.impressions + campaign.insights.impressions,
      clicks: summary.clicks + campaign.insights.clicks,
      leads: summary.leads + campaign.insights.leads,
      activeCampaigns: summary.activeCampaigns + (campaign.effectiveStatus === 'ACTIVE' ? 1 : 0),
    }),
    { spend: 0, impressions: 0, clicks: 0, leads: 0, activeCampaigns: 0 },
  );

  return {
    ok: true,
    account: {
      id: policy.account.id,
      name: policy.account.name,
      currency: policy.account.currency,
      timezone: policy.account.timezone,
    },
    campaigns,
    totals: {
      ...totals,
      ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
      cpc: totals.clicks > 0 ? totals.spend / totals.clicks : 0,
    },
    fetchedAt: new Date().toISOString(),
    readOnly: true,
  };
}

export async function fetchMetaCampaignPlan(campaignId) {
  const env = getMetaEnv();
  const policy = readPolicy();

  if (!/^\d+$/.test(String(campaignId || ''))) {
    return {
      ok: false,
      error: 'ID campagna non valido.',
    };
  }

  const required = ['accessToken'];
  const missing = required.filter((key) => !env[key]?.trim());

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Configurazione mancante: ${missing.join(', ')}`,
    };
  }

  const fields = [
    'id',
    'name',
    'status',
    'effective_status',
    'objective',
    'daily_budget',
    'lifetime_budget',
    'start_time',
    'stop_time',
    'created_time',
    'updated_time',
    'adsets.limit(50){id,name,status,effective_status,optimization_goal,billing_event,targeting,start_time,end_time}',
    'ads.limit(50){id,name,status,effective_status,creative{id,name,title,body,object_story_spec},created_time,updated_time}',
  ].join(',');

  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${campaignId}`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('access_token', env.accessToken);

  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload.error?.message || 'Errore Meta API.',
    };
  }

  const importedDailyBudget = normalizeMoneyCents(payload.daily_budget) || policy.budget.initialDailyBudgetEur;
  const adSets = payload.adsets?.data?.length
    ? payload.adsets.data.map((adSet) => ({
        name: adSet.name,
        status: 'PAUSED',
        optimizationGoal: adSet.optimization_goal || 'LEAD_GENERATION',
        billingEvent: adSet.billing_event || 'IMPRESSIONS',
        targetingDraft: adSet.targeting || defaultCampaignPlan.adSets[0].targetingDraft,
        scheduleReference: adSet.start_time || adSet.end_time ? `${adSet.start_time || 'inizio non definito'} - ${adSet.end_time || 'fine non definita'}` : 'Importata da Meta',
        metaSource: {
          id: adSet.id,
          status: adSet.status,
          effectiveStatus: adSet.effective_status,
        },
      }))
    : defaultCampaignPlan.adSets;

  const ads = payload.ads?.data?.length
    ? payload.ads.data.map((ad) => ({
        name: ad.name,
        status: 'PAUSED',
        format: 'single_image_or_video',
        ...readCreativeText(ad),
        metaSource: {
          id: ad.id,
          status: ad.status,
          effectiveStatus: ad.effective_status,
          creativeId: ad.creative?.id,
        },
      }))
    : defaultCampaignPlan.ads;

  const now = new Date().toISOString();
  const plan = {
    ...structuredClone(defaultCampaignPlan),
    generatedAt: now,
    updatedAt: now,
    account: {
      id: policy.account.id,
      name: policy.account.name,
      currency: policy.account.currency,
      timezone: policy.account.timezone,
    },
    campaign: {
      ...defaultCampaignPlan.campaign,
      name: payload.name || defaultCampaignPlan.campaign.name,
      objective: payload.objective || defaultCampaignPlan.campaign.objective,
      status: 'PAUSED',
      dailyBudgetEur: clampPolicyBudget(importedDailyBudget, policy),
      destinationUrl: defaultCampaignPlan.campaign.destinationUrl,
      metaSource: {
        id: payload.id,
        status: payload.status,
        effectiveStatus: payload.effective_status,
        createdTime: payload.created_time,
        updatedTime: payload.updated_time,
        dailyBudgetEur: normalizeMoneyCents(payload.daily_budget),
        lifetimeBudgetEur: normalizeMoneyCents(payload.lifetime_budget),
      },
    },
    adSets,
    ads,
    mediaAssets: [],
    budgetGuard: {
      maxDailyBudgetEur: Number(policy.budget.maxDailyBudgetEur),
      absoluteMaxDailyBudgetEur: Number(policy.budget.absoluteMaxDailyBudgetEur || policy.budget.maxDailyBudgetEur),
      maxCampaignBudgetEur: Number(policy.budget.maxCampaignBudgetEur || 500),
      absoluteMaxCampaignBudgetEur: Number(policy.budget.absoluteMaxCampaignBudgetEur || policy.budget.maxCampaignBudgetEur || 500),
      updatedAt: now,
    },
    approval: {
      approved: false,
      resetAt: now,
      resetReason: `Campagna Meta ${payload.id} importata per modifica: serve nuova approvazione fisica.`,
      allowsMetaPublish: false,
      requiresSeparateMetaCreateConfirmation: true,
    },
    source: {
      type: 'meta_campaign_import',
      campaignId: payload.id,
      importedAt: now,
      readOnlyImport: true,
    },
  };

  return {
    ok: true,
    plan,
    campaign: {
      id: payload.id,
      name: payload.name,
      status: payload.status,
      effectiveStatus: payload.effective_status,
    },
    readOnly: true,
  };
}

export async function fetchMetaBillingOverview() {
  const env = getMetaEnv();
  const policy = readPolicy();
  const required = ['adAccountId', 'accessToken'];
  const missing = required.filter((key) => !env[key]?.trim());

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Configurazione mancante: ${missing.join(', ')}`,
    };
  }

  const fields = [
    'account_id',
    'name',
    'account_status',
    'currency',
    'timezone_name',
    'balance',
    'amount_spent',
    'spend_cap',
    'funding_source',
    'disable_reason',
    'business',
  ].join(',');

  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${env.adAccountId}`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('access_token', env.accessToken);

  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload.error?.message || 'Errore Meta API.',
    };
  }

  const billingUrl = `https://business.facebook.com/billing_hub/accounts/details/?asset_id=${encodeURIComponent(policy.account.id.replace('act_', ''))}`;

  return {
    ok: true,
    account: {
      id: payload.id || policy.account.id,
      accountId: payload.account_id || policy.account.id.replace('act_', ''),
      name: payload.name || policy.account.name,
      status: payload.account_status,
      currency: payload.currency || policy.account.currency,
      timezone: payload.timezone_name || policy.account.timezone,
      disableReason: payload.disable_reason || null,
      businessName: payload.business?.name || null,
    },
    billing: {
      fundingSourcePresent: Boolean(payload.funding_source),
      fundingSourceLabel: payload.funding_source ? 'Metodo configurato in Meta' : null,
      balanceEur: normalizeMoneyCents(payload.balance),
      amountSpentEur: normalizeMoneyCents(payload.amount_spent),
      spendCapEur: normalizeMoneyCents(payload.spend_cap),
      billingUrl,
      paymentDetailsAvailableInMeta: true,
    },
    fetchedAt: new Date().toISOString(),
    readOnly: true,
  };
}
