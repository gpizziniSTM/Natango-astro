import { defaultGoogleCampaignPlan } from './defaultGoogleCampaignPlan.js';
import {
  GOOGLE_LEAD_CONVERSION_NAME,
  getGoogleAdsEnv,
  runGoogleAdsAccountAudit,
  runGoogleAdsAtomicMutate,
  runGoogleAdsQuery,
} from './googleAdsConfig.js';

export const GOOGLE_PAUSED_CAMPAIGN_NAME = 'Natango | Principianti Assoluti Roma | Settembre 2026';
export const GOOGLE_PAUSED_BUDGET_NAME = 'Natango | Budget Principianti Settembre 2026';
export const GOOGLE_TARGETING_CONSTANTS = {
  language: 'languageConstants/1004',
  castelliCities: [
    { name: 'Frascati', resourceName: 'geoTargetConstants/1008731' },
    { name: 'Grottaferrata', resourceName: 'geoTargetConstants/9050622' },
    { name: 'Marino', resourceName: 'geoTargetConstants/9050644' },
    { name: 'Albano Laziale', resourceName: 'geoTargetConstants/9050539' },
  ],
};

function microEur(value) {
  return String(Math.round(Number(value) * 1_000_000));
}

function buildCampaignCriterionOperations(campaignResourceName) {
  const locationOperations = GOOGLE_TARGETING_CONSTANTS.castelliCities.map((location) => ({
    campaignCriterionOperation: {
      create: {
        campaign: campaignResourceName,
        location: { geoTargetConstant: location.resourceName },
      },
    },
  }));
  const scheduleOperations = defaultGoogleCampaignPlan.targeting.adSchedule.days.map((dayOfWeek) => ({
    campaignCriterionOperation: {
      create: {
        campaign: campaignResourceName,
        adSchedule: {
          dayOfWeek,
          startHour: defaultGoogleCampaignPlan.targeting.adSchedule.startHour,
          startMinute: 'ZERO',
          endHour: defaultGoogleCampaignPlan.targeting.adSchedule.endHour,
          endMinute: 'ZERO',
        },
      },
    },
  }));
  const negativeKeywordOperations = defaultGoogleCampaignPlan.campaignNegativeKeywords.map((text) => ({
    campaignCriterionOperation: {
      create: {
        campaign: campaignResourceName,
        negative: true,
        keyword: { text, matchType: 'BROAD' },
      },
    },
  }));

  return [
    {
      campaignCriterionOperation: {
        create: {
          campaign: campaignResourceName,
          language: { languageConstant: GOOGLE_TARGETING_CONSTANTS.language },
        },
      },
    },
    {
      campaignCriterionOperation: {
        create: {
          campaign: campaignResourceName,
          proximity: {
            address: {
              streetAddress: 'Via del Mandrione 109',
              cityName: 'Roma',
              countryCode: 'IT',
            },
            radius: 15,
            radiusUnits: 'KILOMETERS',
          },
        },
      },
    },
    ...locationOperations,
    ...scheduleOperations,
    ...negativeKeywordOperations,
  ];
}

export function buildPausedCampaignMutateOperations() {
  const env = getGoogleAdsEnv();
  const customerRoot = `customers/${env.customerId}`;
  const budgetResourceName = `${customerRoot}/campaignBudgets/-1`;
  const campaignResourceName = `${customerRoot}/campaigns/-2`;
  const adGroupResourceNames = defaultGoogleCampaignPlan.adGroups.map((_, index) => `${customerRoot}/adGroups/${-3 - index}`);
  const finalUrl = 'https://www.natango.org/corso-settembre';
  const ad = defaultGoogleCampaignPlan.responsiveSearchAd;

  const adGroupOperations = defaultGoogleCampaignPlan.adGroups.map((adGroup, index) => ({
    adGroupOperation: {
      create: {
        resourceName: adGroupResourceNames[index],
        campaign: campaignResourceName,
        name: adGroup.name,
        status: 'PAUSED',
        type: 'SEARCH_STANDARD',
        cpcBidMicros: microEur(adGroup.defaultMaxCpcEur),
      },
    },
  }));
  const keywordOperations = defaultGoogleCampaignPlan.adGroups.flatMap((adGroup, adGroupIndex) =>
    adGroup.keywords.map((keyword) => ({
      adGroupCriterionOperation: {
        create: {
          adGroup: adGroupResourceNames[adGroupIndex],
          status: 'PAUSED',
          keyword: {
            text: keyword.text,
            matchType: keyword.matchType,
          },
        },
      },
    })),
  );
  const adOperations = defaultGoogleCampaignPlan.adGroups.map((_, index) => ({
    adGroupAdOperation: {
      create: {
        adGroup: adGroupResourceNames[index],
        status: 'PAUSED',
        ad: {
          finalUrls: [finalUrl],
          responsiveSearchAd: {
            headlines: ad.headlines.map((text) => ({ text })),
            descriptions: ad.descriptions.map((text) => ({ text })),
            path1: ad.path1,
            path2: ad.path2,
          },
        },
      },
    },
  }));

  return [
    {
      campaignBudgetOperation: {
        create: {
          resourceName: budgetResourceName,
          name: GOOGLE_PAUSED_BUDGET_NAME,
          amountMicros: microEur(defaultGoogleCampaignPlan.campaign.averageDailyBudgetEur),
          deliveryMethod: 'STANDARD',
          explicitlyShared: false,
        },
      },
    },
    {
      campaignOperation: {
        create: {
          resourceName: campaignResourceName,
          name: GOOGLE_PAUSED_CAMPAIGN_NAME,
          status: 'PAUSED',
          advertisingChannelType: 'SEARCH',
          manualCpc: {},
          campaignBudget: budgetResourceName,
          networkSettings: {
            targetGoogleSearch: true,
            targetSearchNetwork: false,
            targetContentNetwork: false,
            targetPartnerSearchNetwork: false,
          },
          geoTargetTypeSetting: {
            positiveGeoTargetType: 'PRESENCE',
            negativeGeoTargetType: 'PRESENCE',
          },
          containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
          startDateTime: '20260722 00:00:00',
          endDateTime: '20261031 23:59:59',
          finalUrlSuffix: defaultGoogleCampaignPlan.campaign.trackingUrlSuffix,
        },
      },
    },
    ...buildCampaignCriterionOperations(campaignResourceName),
    ...adGroupOperations,
    ...keywordOperations,
    ...adOperations,
  ];
}

export async function validatePausedCampaignCreatePreconditions() {
  const [audit, existingCampaignResponse] = await Promise.all([
    runGoogleAdsAccountAudit(),
    runGoogleAdsQuery([
      'SELECT campaign.id, campaign.name, campaign.status',
      'FROM campaign',
      `WHERE campaign.name = '${GOOGLE_PAUSED_CAMPAIGN_NAME}'`,
      'LIMIT 1',
    ].join(' ')),
  ]);
  const errors = [];

  if (!audit.ok) errors.push(audit.error || 'Audit account non riuscito.');
  if ((existingCampaignResponse.results || []).length > 0) errors.push('La campagna autorizzata esiste già.');

  const leadConversion = audit.conversionActions?.find(
    (action) => action.name === GOOGLE_LEAD_CONVERSION_NAME && action.status === 'ENABLED',
  );
  if (!leadConversion?.primaryForGoal) errors.push('La conversione lead primaria non è pronta.');

  const operations = buildPausedCampaignMutateOperations();
  const campaignCreates = operations.filter((operation) => operation.campaignOperation?.create);
  const unsafeEnabledObjects = JSON.stringify(operations).match(/"status":"ENABLED"/g) || [];
  if (campaignCreates.length !== 1) errors.push('Il piano deve creare esattamente una campagna.');
  if (unsafeEnabledObjects.length > 0) errors.push('Il piano contiene oggetti pubblicitari abilitati.');

  return { ok: errors.length === 0, errors, operationCount: operations.length };
}

export async function mutatePausedGoogleCampaign({ validateOnly = true } = {}) {
  const preconditions = await validatePausedCampaignCreatePreconditions();
  if (!preconditions.ok) {
    return {
      ok: false,
      validateOnly,
      errors: preconditions.errors,
      safety: { writeCallsMade: false, campaignEnableCallsMade: false },
    };
  }

  try {
    return await runGoogleAdsAtomicMutate(buildPausedCampaignMutateOperations(), { validateOnly });
  } catch (error) {
    return {
      ok: false,
      validateOnly,
      error: error instanceof Error ? error.message : 'Creazione campagna Google Ads non riuscita.',
      safety: { writeCallsMade: false, campaignEnableCallsMade: false },
    };
  }
}
