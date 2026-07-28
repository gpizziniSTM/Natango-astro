import { runGoogleAdsQuery } from '../src/lib/googleAdsConfig.js';

const campaignId = '24061339564';
const expectEnabled = process.argv.includes('--enabled');
const expectedServingStatus = expectEnabled ? 'ENABLED' : 'PAUSED';
const campaignFilter = `campaign.id = ${campaignId}`;
const [campaignResponse, adGroupResponse, keywordResponse, adResponse, criterionResponse] = await Promise.all([
  runGoogleAdsQuery([
    'SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status, campaign.primary_status_reasons, campaign.advertising_channel_type,',
    'campaign.start_date_time, campaign.end_date_time, campaign.final_url_suffix,',
    'campaign.network_settings.target_google_search, campaign.network_settings.target_search_network,',
    'campaign.network_settings.target_content_network, campaign.network_settings.target_partner_search_network,',
    'campaign.geo_target_type_setting.positive_geo_target_type, campaign.geo_target_type_setting.negative_geo_target_type,',
    'campaign_budget.id, campaign_budget.name, campaign_budget.amount_micros',
    'FROM campaign',
    `WHERE ${campaignFilter}`,
  ].join(' ')),
  runGoogleAdsQuery([
    'SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros',
    'FROM ad_group',
    `WHERE ${campaignFilter}`,
    'ORDER BY ad_group.id',
  ].join(' ')),
  runGoogleAdsQuery([
    'SELECT ad_group.id, ad_group.name, ad_group_criterion.status,',
    'ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type',
    'FROM ad_group_criterion',
    `WHERE ${campaignFilter} AND ad_group_criterion.type = KEYWORD`,
    'ORDER BY ad_group.id, ad_group_criterion.criterion_id',
  ].join(' ')),
  runGoogleAdsQuery([
    'SELECT ad_group.id, ad_group.name, ad_group_ad.status, ad_group_ad.ad.id,',
    'ad_group_ad.ad.type, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.descriptions,',
    'ad_group_ad.policy_summary.approval_status,',
    'ad_group_ad.policy_summary.review_status',
    'FROM ad_group_ad',
    `WHERE ${campaignFilter}`,
    'ORDER BY ad_group.id',
  ].join(' ')),
  runGoogleAdsQuery([
    'SELECT campaign_criterion.type, campaign_criterion.status, campaign_criterion.negative,',
    'campaign_criterion.keyword.text, campaign_criterion.location.geo_target_constant,',
    'campaign_criterion.proximity.radius, campaign_criterion.proximity.radius_units,',
    'campaign_criterion.language.language_constant, campaign_criterion.ad_schedule.day_of_week,',
    'campaign_criterion.ad_schedule.start_hour, campaign_criterion.ad_schedule.start_minute,',
    'campaign_criterion.ad_schedule.end_hour, campaign_criterion.ad_schedule.end_minute',
    'FROM campaign_criterion',
    `WHERE ${campaignFilter}`,
  ].join(' ')),
]);

const campaignRow = campaignResponse.results?.[0] || {};
const adGroups = (adGroupResponse.results || []).map(({ adGroup }) => ({
  id: String(adGroup.id),
  name: adGroup.name,
  status: adGroup.status,
  cpcBidEur: Number(adGroup.cpcBidMicros || 0) / 1_000_000,
}));
const keywords = (keywordResponse.results || []).map(({ adGroup, adGroupCriterion }) => ({
  adGroupId: String(adGroup.id),
  adGroupName: adGroup.name,
  status: adGroupCriterion.status,
  text: adGroupCriterion.keyword?.text,
  matchType: adGroupCriterion.keyword?.matchType,
}));
const ads = (adResponse.results || []).map(({ adGroup, adGroupAd }) => ({
  adGroupId: String(adGroup.id),
  adGroupName: adGroup.name,
  id: String(adGroupAd.ad?.id),
  status: adGroupAd.status,
  type: adGroupAd.ad?.type,
  finalUrls: adGroupAd.ad?.finalUrls,
  descriptions: (adGroupAd.ad?.responsiveSearchAd?.descriptions || []).map((item) => item.text),
  approvalStatus: adGroupAd.policySummary?.approvalStatus || 'UNKNOWN',
  reviewStatus: adGroupAd.policySummary?.reviewStatus || 'UNKNOWN',
}));
const criteria = (criterionResponse.results || []).map(({ campaignCriterion }) => ({
  type: campaignCriterion.type,
  status: campaignCriterion.status,
  negative: campaignCriterion.negative,
  keyword: campaignCriterion.keyword?.text || null,
  location: campaignCriterion.location?.geoTargetConstant || null,
  proximityRadius: campaignCriterion.proximity?.radius || null,
  proximityUnits: campaignCriterion.proximity?.radiusUnits || null,
  language: campaignCriterion.language?.languageConstant || null,
  scheduleDay: campaignCriterion.adSchedule?.dayOfWeek || null,
  scheduleStartHour: campaignCriterion.adSchedule?.startHour ?? null,
  scheduleStartMinute: campaignCriterion.adSchedule?.startMinute ?? null,
  scheduleEndHour: campaignCriterion.adSchedule?.endHour ?? null,
  scheduleEndMinute: campaignCriterion.adSchedule?.endMinute ?? null,
}));
const campaign = campaignRow.campaign || {};
const budget = campaignRow.campaignBudget || {};
const checks = {
  campaignExpectedStatus: campaign.status === expectedServingStatus,
  searchOnly: campaign.advertisingChannelType === 'SEARCH' &&
    campaign.networkSettings?.targetGoogleSearch === true &&
    campaign.networkSettings?.targetSearchNetwork === false &&
    campaign.networkSettings?.targetContentNetwork === false &&
    campaign.networkSettings?.targetPartnerSearchNetwork === false,
  startDateToday: campaign.startDateTime?.startsWith('2026-07-22 '),
  dailyBudgetThreeEur: Number(budget.amountMicros || 0) === 3_000_000,
  threeAdGroupsExpectedStatus: adGroups.length === 3 && adGroups.every((item) => item.status === expectedServingStatus),
  fifteenKeywordsExpectedStatus: keywords.length === 15 && keywords.every((item) => item.status === expectedServingStatus),
  threeResponsiveAdsExpectedStatus: ads.length === 3 && ads.every((item) => item.status === expectedServingStatus && item.type === 'RESPONSIVE_SEARCH_AD'),
  correctedCourseTimeInAds: ads.length === 3 && ads.every((item) =>
    item.descriptions.includes('Open day il 21 settembre al Tango Loft. Lunedi 20:00-21:00. Prenota il tuo posto.')
  ),
  presenceOnly: campaign.geoTargetTypeSetting?.positiveGeoTargetType === 'PRESENCE',
  targetingPresent: criteria.some((item) => item.type === 'PROXIMITY') &&
    criteria.filter((item) => item.type === 'LOCATION').length === 4 &&
    criteria.filter((item) => item.type === 'AD_SCHEDULE').length === 7 &&
    criteria.filter((item) => item.negative && item.type === 'KEYWORD').length === 10,
  adScheduleSevenToTwentyThree: criteria.filter((item) => item.type === 'AD_SCHEDULE').length === 7 &&
    criteria.filter((item) => item.type === 'AD_SCHEDULE').every((item) =>
      Number(item.scheduleStartHour) === 7 &&
      item.scheduleStartMinute === 'ZERO' &&
      Number(item.scheduleEndHour) === 23 &&
      item.scheduleEndMinute === 'ZERO'
    ),
};

const result = {
  ok: Object.values(checks).every(Boolean),
  accessMode: 'read_only_created_campaign_audit',
  expectedServingStatus,
  campaign: {
    id: String(campaign.id),
    name: campaign.name,
    status: campaign.status,
    primaryStatus: campaign.primaryStatus,
    primaryStatusReasons: campaign.primaryStatusReasons || [],
    channelType: campaign.advertisingChannelType,
    startDateTime: campaign.startDateTime,
    endDateTime: campaign.endDateTime,
    dailyBudgetEur: Number(budget.amountMicros || 0) / 1_000_000,
  },
  counts: {
    adGroups: adGroups.length,
    keywords: keywords.length,
    ads: ads.length,
    campaignCriteria: criteria.length,
  },
  adGroups,
  ads,
  checks,
  safety: { writeCallsMade: false, campaignEnableCallsMade: false },
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
