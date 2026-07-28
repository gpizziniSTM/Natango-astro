import { defaultGoogleCampaignPlan } from './defaultGoogleCampaignPlan.js';
import { getGoogleAdsEnv, runGoogleAdsAtomicMutate, runGoogleAdsQuery } from './googleAdsConfig.js';

export const GOOGLE_CAMPAIGN_UPDATE_TARGETS = {
  campaignId: '24061339564',
  budgetId: '15736137483',
  adIds: ['817948227302', '817948227305', '817948227308'],
};

const EXPECTED_OLD_START = '2026-08-10 00:00:00';
const EXPECTED_OLD_DAILY_BUDGET_MICROS = 8_000_000;
const NEW_START = '20260722 00:00:00';
const NEW_DAILY_BUDGET_MICROS = 3_000_000;

function buildUpdateOperations() {
  const env = getGoogleAdsEnv();
  const customerRoot = `customers/${env.customerId}`;
  const ad = defaultGoogleCampaignPlan.responsiveSearchAd;

  return [
    {
      campaignOperation: {
        update: {
          resourceName: `${customerRoot}/campaigns/${GOOGLE_CAMPAIGN_UPDATE_TARGETS.campaignId}`,
          startDateTime: NEW_START,
        },
        updateMask: 'startDateTime',
      },
    },
    {
      campaignBudgetOperation: {
        update: {
          resourceName: `${customerRoot}/campaignBudgets/${GOOGLE_CAMPAIGN_UPDATE_TARGETS.budgetId}`,
          amountMicros: String(NEW_DAILY_BUDGET_MICROS),
        },
        updateMask: 'amountMicros',
      },
    },
    ...GOOGLE_CAMPAIGN_UPDATE_TARGETS.adIds.map((adId) => ({
      adOperation: {
        update: {
          resourceName: `${customerRoot}/ads/${adId}`,
          responsiveSearchAd: {
            headlines: ad.headlines.map((text) => ({ text })),
            descriptions: ad.descriptions.map((text) => ({ text })),
          },
        },
        updateMask: 'responsiveSearchAd.headlines,responsiveSearchAd.descriptions',
      },
    })),
  ];
}

async function validateUpdatePreconditions() {
  const campaignId = GOOGLE_CAMPAIGN_UPDATE_TARGETS.campaignId;
  const [campaignResponse, adResponse] = await Promise.all([
    runGoogleAdsQuery([
      'SELECT campaign.id, campaign.status, campaign.start_date_time, campaign_budget.id, campaign_budget.amount_micros',
      'FROM campaign',
      `WHERE campaign.id = ${campaignId}`,
    ].join(' ')),
    runGoogleAdsQuery([
      'SELECT ad_group_ad.status, ad_group_ad.ad.id, ad_group_ad.ad.type',
      'FROM ad_group_ad',
      `WHERE campaign.id = ${campaignId}`,
    ].join(' ')),
  ]);
  const row = campaignResponse.results?.[0] || {};
  const campaign = row.campaign || {};
  const budget = row.campaignBudget || {};
  const ads = (adResponse.results || []).map(({ adGroupAd }) => ({
    id: String(adGroupAd.ad?.id || ''),
    status: adGroupAd.status,
    type: adGroupAd.ad?.type,
  }));
  const errors = [];

  if (String(campaign.id || '') !== campaignId) errors.push('Campagna Google autorizzata non trovata.');
  if (campaign.status !== 'PAUSED') errors.push('La campagna non e in pausa.');
  if (campaign.startDateTime !== EXPECTED_OLD_START) errors.push('Data iniziale della campagna diversa da quella approvata.');
  if (String(budget.id || '') !== GOOGLE_CAMPAIGN_UPDATE_TARGETS.budgetId) errors.push('Budget della campagna diverso da quello approvato.');
  if (Number(budget.amountMicros || 0) !== EXPECTED_OLD_DAILY_BUDGET_MICROS) errors.push('Budget giornaliero iniziale diverso da 8 EUR.');
  if (ads.length !== GOOGLE_CAMPAIGN_UPDATE_TARGETS.adIds.length) errors.push('Numero di annunci diverso da quello approvato.');
  for (const adId of GOOGLE_CAMPAIGN_UPDATE_TARGETS.adIds) {
    const current = ads.find((item) => item.id === adId);
    if (!current || current.status !== 'PAUSED' || current.type !== 'RESPONSIVE_SEARCH_AD') {
      errors.push(`Annuncio ${adId} assente, non responsive o non in pausa.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export async function mutatePausedGoogleCampaignUpdate({ validateOnly = true } = {}) {
  const preconditions = await validateUpdatePreconditions();
  if (!preconditions.ok) {
    return {
      ok: false,
      validateOnly,
      errors: preconditions.errors,
      safety: { writeCallsMade: false, campaignEnableCallsMade: false },
    };
  }

  const result = await runGoogleAdsAtomicMutate(buildUpdateOperations(), { validateOnly });
  return {
    ...result,
    update: {
      campaignId: GOOGLE_CAMPAIGN_UPDATE_TARGETS.campaignId,
      startDate: '2026-07-22',
      dailyBudgetEur: 3,
      courseTime: '20:00-21:00',
      adsUpdated: GOOGLE_CAMPAIGN_UPDATE_TARGETS.adIds.length,
    },
  };
}
