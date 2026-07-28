import { defaultGoogleCampaignPlan } from './defaultGoogleCampaignPlan.js';
import {
  GOOGLE_LEAD_CONVERSION_NAME,
  runGoogleAdsAccountAudit,
  runGoogleAdsAtomicMutate,
  runGoogleAdsQuery,
} from './googleAdsConfig.js';
import { GOOGLE_PAUSED_CAMPAIGN_NAME } from './googleAdsCampaignCreate.js';
import { GOOGLE_CAMPAIGN_UPDATE_TARGETS } from './googleAdsCampaignUpdate.js';

const EXPECTED_AD_GROUP_IDS = ['204240938528', '204240938568', '204240938608'];

async function readActivationState() {
  const campaignId = GOOGLE_CAMPAIGN_UPDATE_TARGETS.campaignId;
  const campaignFilter = `campaign.id = ${campaignId}`;
  const [audit, campaignResponse, adGroupResponse, keywordResponse, adResponse, criterionResponse] = await Promise.all([
    runGoogleAdsAccountAudit(),
    runGoogleAdsQuery([
      'SELECT campaign.resource_name, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,',
      'campaign.start_date_time, campaign.end_date_time, campaign_budget.id, campaign_budget.amount_micros',
      'FROM campaign',
      `WHERE ${campaignFilter}`,
    ].join(' ')),
    runGoogleAdsQuery([
      'SELECT ad_group.resource_name, ad_group.id, ad_group.name, ad_group.status',
      'FROM ad_group',
      `WHERE ${campaignFilter}`,
      'ORDER BY ad_group.id',
    ].join(' ')),
    runGoogleAdsQuery([
      'SELECT ad_group_criterion.resource_name, ad_group_criterion.status,',
      'ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type',
      'FROM ad_group_criterion',
      `WHERE ${campaignFilter} AND ad_group_criterion.type = KEYWORD`,
    ].join(' ')),
    runGoogleAdsQuery([
      'SELECT ad_group_ad.resource_name, ad_group_ad.status, ad_group_ad.ad.id, ad_group_ad.ad.type,',
      'ad_group_ad.ad.final_urls, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status',
      'FROM ad_group_ad',
      `WHERE ${campaignFilter}`,
    ].join(' ')),
    runGoogleAdsQuery([
      'SELECT campaign_criterion.type, campaign_criterion.status, campaign_criterion.negative,',
      'campaign_criterion.ad_schedule.day_of_week, campaign_criterion.ad_schedule.start_hour,',
      'campaign_criterion.ad_schedule.start_minute, campaign_criterion.ad_schedule.end_hour,',
      'campaign_criterion.ad_schedule.end_minute',
      'FROM campaign_criterion',
      `WHERE ${campaignFilter}`,
    ].join(' ')),
  ]);

  return {
    audit,
    campaignRow: campaignResponse.results?.[0] || {},
    adGroups: (adGroupResponse.results || []).map(({ adGroup }) => adGroup),
    keywords: (keywordResponse.results || []).map(({ adGroupCriterion }) => adGroupCriterion),
    ads: (adResponse.results || []).map(({ adGroupAd }) => adGroupAd),
    criteria: (criterionResponse.results || []).map(({ campaignCriterion }) => campaignCriterion),
  };
}

function validateActivationState(state) {
  const errors = [];
  const campaign = state.campaignRow.campaign || {};
  const budget = state.campaignRow.campaignBudget || {};
  const expectedKeywords = new Set(defaultGoogleCampaignPlan.adGroups.flatMap((group) =>
    group.keywords.map((keyword) => `${keyword.text}|${keyword.matchType}`)
  ));
  const actualKeywords = new Set(state.keywords.map((criterion) =>
    `${criterion.keyword?.text}|${criterion.keyword?.matchType}`
  ));
  const schedules = state.criteria.filter((criterion) => criterion.type === 'AD_SCHEDULE');

  if (!state.audit.ok) errors.push(state.audit.error || 'Audit account Google Ads non riuscito.');
  if (String(campaign.id || '') !== GOOGLE_CAMPAIGN_UPDATE_TARGETS.campaignId) errors.push('Campagna autorizzata non trovata.');
  if (campaign.name !== GOOGLE_PAUSED_CAMPAIGN_NAME) errors.push('Nome campagna inatteso.');
  if (campaign.status !== 'PAUSED') errors.push('La campagna non e in pausa.');
  if (campaign.advertisingChannelType !== 'SEARCH') errors.push('La campagna non e Search.');
  if (!campaign.startDateTime?.startsWith('2026-07-22 ')) errors.push('Data iniziale inattesa.');
  if (campaign.endDateTime !== '2026-10-31 23:59:59') errors.push('Data finale inattesa.');
  if (String(budget.id || '') !== GOOGLE_CAMPAIGN_UPDATE_TARGETS.budgetId) errors.push('Budget associato inatteso.');
  if (Number(budget.amountMicros || 0) !== 3_000_000) errors.push('Budget giornaliero diverso da 3 EUR.');

  if (state.adGroups.length !== 3) errors.push('Numero di gruppi annunci inatteso.');
  for (const adGroupId of EXPECTED_AD_GROUP_IDS) {
    const adGroup = state.adGroups.find((item) => String(item.id) === adGroupId);
    if (!adGroup || adGroup.status !== 'PAUSED') errors.push(`Gruppo annunci ${adGroupId} assente o non in pausa.`);
  }

  if (state.keywords.length !== 15 || state.keywords.some((item) => item.status !== 'PAUSED')) {
    errors.push('Le 15 parole chiave non sono tutte in pausa.');
  }
  if (actualKeywords.size !== expectedKeywords.size || [...expectedKeywords].some((item) => !actualKeywords.has(item))) {
    errors.push('Elenco parole chiave diverso dal piano approvato.');
  }

  if (state.ads.length !== 3) errors.push('Numero di annunci inatteso.');
  for (const adId of GOOGLE_CAMPAIGN_UPDATE_TARGETS.adIds) {
    const ad = state.ads.find((item) => String(item.ad?.id) === adId);
    if (!ad || ad.status !== 'PAUSED' || ad.ad?.type !== 'RESPONSIVE_SEARCH_AD') {
      errors.push(`Annuncio ${adId} assente, non responsive o non in pausa.`);
      continue;
    }
    if (ad.policySummary?.approvalStatus !== 'APPROVED' || ad.policySummary?.reviewStatus !== 'REVIEWED') {
      errors.push(`Annuncio ${adId} non completamente approvato.`);
    }
    if (!ad.ad?.finalUrls?.includes('https://www.natango.org/corso-settembre')) {
      errors.push(`Destinazione inattesa per annuncio ${adId}.`);
    }
  }

  const leadConversion = state.audit.conversionActions?.find((action) =>
    action.name === GOOGLE_LEAD_CONVERSION_NAME && action.status === 'ENABLED' && action.primaryForGoal === true
  );
  if (!leadConversion) errors.push('Conversione lead primaria non pronta.');

  if (schedules.length !== 7 || schedules.some((schedule) =>
    Number(schedule.adSchedule?.startHour) !== 7 ||
    schedule.adSchedule?.startMinute !== 'ZERO' ||
    Number(schedule.adSchedule?.endHour) !== 23 ||
    schedule.adSchedule?.endMinute !== 'ZERO'
  )) {
    errors.push('Fascia pubblicitaria diversa da 07:00-23:00 su tutti i giorni.');
  }

  return { ok: errors.length === 0, errors };
}

function buildActivationOperations(state) {
  const campaignResourceName = state.campaignRow.campaign.resourceName;

  return [
    ...state.adGroups.map((adGroup) => ({
      adGroupOperation: {
        update: { resourceName: adGroup.resourceName, status: 'ENABLED' },
        updateMask: 'status',
      },
    })),
    ...state.keywords.map((criterion) => ({
      adGroupCriterionOperation: {
        update: { resourceName: criterion.resourceName, status: 'ENABLED' },
        updateMask: 'status',
      },
    })),
    ...state.ads.map((adGroupAd) => ({
      adGroupAdOperation: {
        update: { resourceName: adGroupAd.resourceName, status: 'ENABLED' },
        updateMask: 'status',
      },
    })),
    {
      campaignOperation: {
        update: { resourceName: campaignResourceName, status: 'ENABLED' },
        updateMask: 'status',
      },
    },
  ];
}

export async function mutateGoogleCampaignActivation({ validateOnly = true } = {}) {
  const state = await readActivationState();
  const validation = validateActivationState(state);
  if (!validation.ok) {
    return {
      ok: false,
      validateOnly,
      errors: validation.errors,
      safety: { writeCallsMade: false, campaignEnableCallsMade: false },
    };
  }

  try {
    const result = await runGoogleAdsAtomicMutate(buildActivationOperations(state), { validateOnly });
    return {
      ...result,
      activation: {
        campaignId: GOOGLE_CAMPAIGN_UPDATE_TARGETS.campaignId,
        campaignCount: 1,
        adGroupCount: state.adGroups.length,
        keywordCount: state.keywords.length,
        adCount: state.ads.length,
        dailyBudgetEur: 3,
      },
      safety: {
        writeCallsMade: !validateOnly,
        campaignEnableCallsMade: !validateOnly,
        atomicPartialFailureDisabled: true,
      },
    };
  } catch (error) {
    return {
      ok: false,
      validateOnly,
      error: error instanceof Error ? error.message : 'Attivazione campagna non riuscita.',
      safety: { writeCallsMade: false, campaignEnableCallsMade: false },
    };
  }
}
