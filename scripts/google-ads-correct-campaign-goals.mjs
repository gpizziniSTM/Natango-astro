import { readFile } from 'node:fs/promises';
import { runGoogleAdsAtomicMutate, runGoogleAdsQuery } from '../src/lib/googleAdsConfig.js';

const execute = process.argv.includes('--execute');
const approval = JSON.parse(await readFile('google-dry-runs/campaign-goal-correction-approval.json', 'utf8'));
const target = {
  accountId: '6934226615',
  campaignId: '24061339564',
  campaignName: 'Natango | Principianti Assoluti Roma | Settembre 2026',
};
const expectedGoals = [
  { category: 'SUBMIT_LEAD_FORM', origin: 'WEBSITE', biddable: true },
  { category: 'SUBMIT_LEAD_FORM', origin: 'GOOGLE_HOSTED', biddable: false },
  { category: 'OUTBOUND_CLICK', origin: 'WEBSITE', biddable: false },
];

const approvalMatches =
  approval.approved === true &&
  approval.scope === 'correct_single_google_campaign_conversion_goals' &&
  approval.accountId === target.accountId &&
  approval.campaignId === target.campaignId &&
  approval.campaignName === target.campaignName &&
  approval.allowsCampaignGoalUpdate === true &&
  approval.allowsBudgetChange === false &&
  approval.allowsCampaignStatusChange === false &&
  JSON.stringify(approval.expectedGoals) === JSON.stringify(expectedGoals);

if (!approvalMatches) {
  console.error(JSON.stringify({ ok: false, error: 'Approvazione obiettivi campagna assente o non coerente.' }, null, 2));
  process.exit(1);
}

async function readState() {
  const campaignResponse = await runGoogleAdsQuery([
    'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type',
    'FROM campaign',
    `WHERE campaign.id = ${target.campaignId}`,
  ].join(' '));
  const goalsResponse = await runGoogleAdsQuery([
    'SELECT campaign_conversion_goal.resource_name, campaign_conversion_goal.campaign,',
    'campaign_conversion_goal.category, campaign_conversion_goal.origin, campaign_conversion_goal.biddable',
    'FROM campaign_conversion_goal',
    `WHERE campaign.id = ${target.campaignId}`,
  ].join(' '));
  const actionsResponse = await runGoogleAdsQuery([
    'SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.category,',
    'conversion_action.origin, conversion_action.primary_for_goal',
    'FROM conversion_action',
    "WHERE conversion_action.name = 'Natango | Lead modulo sito | Settembre 2026'",
  ].join(' '));

  const campaign = campaignResponse.results?.[0]?.campaign || null;
  const goals = (goalsResponse.results || []).map(({ campaignConversionGoal }) => ({
    resourceName: campaignConversionGoal.resourceName,
    category: campaignConversionGoal.category,
    origin: campaignConversionGoal.origin,
    biddable: campaignConversionGoal.biddable === true,
  }));
  const leadAction = actionsResponse.results?.[0]?.conversionAction || null;

  return { campaign, goals, leadAction };
}

function goalKey(goal) {
  return `${goal.category}~${goal.origin}`;
}

function validatePreconditions(state) {
  const errors = [];
  const campaign = state.campaign;

  if (!campaign) errors.push('Campagna non trovata.');
  if (String(campaign?.id || '') !== target.campaignId) errors.push('ID campagna inatteso.');
  if (campaign?.name !== target.campaignName) errors.push('Nome campagna inatteso.');
  if (campaign?.status !== 'ENABLED') errors.push('La campagna non e attiva.');
  if (campaign?.advertisingChannelType !== 'SEARCH') errors.push('Il tipo di campagna e inatteso.');
  if (campaign?.biddingStrategyType !== 'MANUAL_CPC') errors.push('La strategia di offerta non e MANUAL_CPC.');

  if (!state.leadAction) errors.push('Conversione lead Natango non trovata.');
  if (state.leadAction?.status !== 'ENABLED') errors.push('La conversione lead Natango non e attiva.');
  if (state.leadAction?.category !== 'SUBMIT_LEAD_FORM') errors.push('Categoria conversione lead inattesa.');
  if (state.leadAction?.origin !== 'WEBSITE') errors.push('Origine conversione lead inattesa.');
  if (state.leadAction?.primaryForGoal !== true) errors.push('La conversione lead non e primaria.');

  const byKey = new Map(state.goals.map((goal) => [goalKey(goal), goal]));
  for (const expected of expectedGoals) {
    if (!byKey.has(goalKey(expected))) errors.push(`Obiettivo campagna non trovato: ${goalKey(expected)}.`);
  }

  return errors;
}

function buildOperations(state) {
  const byKey = new Map(state.goals.map((goal) => [goalKey(goal), goal]));

  return expectedGoals.map((expected) => ({
    campaignConversionGoalOperation: {
      update: {
        resourceName: byKey.get(goalKey(expected)).resourceName,
        biddable: expected.biddable,
      },
      updateMask: 'biddable',
    },
  }));
}

const before = await readState();
const errors = validatePreconditions(before);

if (errors.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    validateOnly: !execute,
    errors,
    safety: { writeCallsMade: false, campaignGoalWritesMade: false },
  }, null, 2));
  process.exit(1);
}

const operations = buildOperations(before);
const mutation = await runGoogleAdsAtomicMutate(operations, { validateOnly: !execute });
const after = execute ? await readState() : null;
const verified = execute
  ? expectedGoals.every((expected) =>
      after.goals.some((goal) => goalKey(goal) === goalKey(expected) && goal.biddable === expected.biddable))
  : null;

console.log(JSON.stringify({
  ok: mutation.ok && (verified !== false),
  validateOnly: !execute,
  campaign: {
    id: target.campaignId,
    name: target.campaignName,
    status: before.campaign.status,
    biddingStrategyType: before.campaign.biddingStrategyType,
  },
  before: before.goals.map(({ resourceName: _resourceName, ...goal }) => goal),
  requested: expectedGoals,
  after: after?.goals.map(({ resourceName: _resourceName, ...goal }) => goal) || null,
  verified,
  safety: {
    writeCallsMade: execute,
    campaignGoalWritesMade: execute ? operations.length : 0,
    budgetChangesMade: false,
    campaignStatusChangesMade: false,
    adChangesMade: false,
    keywordChangesMade: false,
  },
}, null, 2));

if (verified === false) process.exitCode = 1;
