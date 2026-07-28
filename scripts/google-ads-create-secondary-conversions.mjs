import { readFile } from 'node:fs/promises';
import { runGoogleAdsAtomicMutate, runGoogleAdsQuery } from '../src/lib/googleAdsConfig.js';

const execute = process.argv.includes('--execute');
const approval = JSON.parse(await readFile('google-dry-runs/secondary-conversions-approval.json', 'utf8'));
const target = {
  accountId: '6934226615',
  campaignId: '24061339564',
};
const requestedActions = [
  {
    name: 'Natango | Clic WhatsApp sito',
    category: 'CONTACT',
    type: 'WEBPAGE',
  },
  {
    name: 'Natango | Clic telefono sito',
    category: 'PHONE_CALL_LEAD',
    type: 'WEBPAGE',
  },
];

const approvalMatches =
  approval.approved === true &&
  approval.scope === 'create_secondary_google_site_conversions' &&
  approval.accountId === target.accountId &&
  approval.campaignId === target.campaignId &&
  approval.allowsNewSecondaryConversionActions === true &&
  approval.allowsCampaignGoalUpdates === true &&
  approval.allowsPrimaryGoalChanges === false &&
  approval.allowsBudgetChange === false &&
  approval.allowsCampaignStatusChange === false &&
  JSON.stringify(approval.actions) === JSON.stringify(requestedActions);

if (!approvalMatches) {
  console.error(JSON.stringify({ ok: false, error: 'Approvazione conversioni secondarie assente o non coerente.' }, null, 2));
  process.exit(1);
}

function extractTag(action) {
  const snippets = action?.tagSnippets || [];
  const text = snippets.map((snippet) => `${snippet.globalSiteTag || ''}\n${snippet.eventSnippet || ''}`).join('\n');
  const sendTo = text.match(/AW-\d+\/[A-Za-z0-9_-]+/)?.[0] || null;

  return {
    adsId: sendTo?.split('/')[0] || null,
    conversionLabel: sendTo?.split('/')[1] || null,
    hasEventSnippet: Boolean(sendTo),
  };
}

async function readActions() {
  const response = await runGoogleAdsQuery([
    'SELECT conversion_action.resource_name, conversion_action.id, conversion_action.name, conversion_action.status,',
    'conversion_action.type, conversion_action.category, conversion_action.origin, conversion_action.primary_for_goal,',
    'conversion_action.include_in_conversions_metric, conversion_action.tag_snippets',
    'FROM conversion_action',
    'ORDER BY conversion_action.id',
  ].join(' '));

  return (response.results || [])
    .map(({ conversionAction }) => conversionAction)
    .filter((action) => requestedActions.some((expected) => expected.name === action.name));
}

async function readGoals() {
  const response = await runGoogleAdsQuery([
    'SELECT campaign_conversion_goal.resource_name, campaign_conversion_goal.category,',
    'campaign_conversion_goal.origin, campaign_conversion_goal.biddable',
    'FROM campaign_conversion_goal',
    `WHERE campaign.id = ${target.campaignId}`,
  ].join(' '));

  return (response.results || []).map(({ campaignConversionGoal }) => ({
    resourceName: campaignConversionGoal.resourceName,
    category: campaignConversionGoal.category,
    origin: campaignConversionGoal.origin,
    biddable: campaignConversionGoal.biddable === true,
  }));
}

function buildCreateOperations(existingActions) {
  const existingNames = new Set(existingActions.map((action) => action.name));

  return requestedActions
    .filter((action) => !existingNames.has(action.name))
    .map((action) => ({
      conversionActionOperation: {
        create: {
          name: action.name,
          category: action.category,
          type: action.type,
          status: 'ENABLED',
          primaryForGoal: false,
          countingType: 'ONE_PER_CLICK',
          clickThroughLookbackWindowDays: 30,
          viewThroughLookbackWindowDays: 1,
        },
      },
    }));
}

function actionErrors(actions) {
  const errors = [];
  for (const expected of requestedActions) {
    const action = actions.find((item) => item.name === expected.name);
    if (!action) {
      errors.push(`Conversione mancante: ${expected.name}.`);
      continue;
    }
    if (action.status !== 'ENABLED') errors.push(`${expected.name} non e attiva.`);
    if (action.primaryForGoal !== false) errors.push(`${expected.name} non e secondaria.`);
    if (action.category !== expected.category) errors.push(`${expected.name} ha una categoria inattesa.`);
    if (action.type !== expected.type) errors.push(`${expected.name} ha un tipo inatteso.`);
    if (!extractTag(action).hasEventSnippet) errors.push(`${expected.name} non ha un'etichetta di tracciamento.`);
  }
  return errors;
}

async function waitForGoals() {
  const needed = new Set(requestedActions.map((action) => `${action.category}~WEBSITE`));
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const goals = await readGoals();
    if ([...needed].every((key) => goals.some((goal) => `${goal.category}~${goal.origin}` === key))) return goals;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return readGoals();
}

const existingBefore = await readActions();
const unexpectedExisting = existingBefore.filter((action) => {
  const expected = requestedActions.find((item) => item.name === action.name);
  return action.status !== 'ENABLED' || action.primaryForGoal !== false || action.category !== expected?.category || action.type !== expected?.type;
});

if (unexpectedExisting.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    error: 'Esistono conversioni omonime con configurazione inattesa.',
    actions: unexpectedExisting.map((action) => ({ id: String(action.id), name: action.name, status: action.status })),
    safety: { writeCallsMade: false },
  }, null, 2));
  process.exit(1);
}

const createOperations = buildCreateOperations(existingBefore);
if (!execute) {
  const validation = createOperations.length > 0
    ? await runGoogleAdsAtomicMutate(createOperations, { validateOnly: true })
    : { ok: true, validateOnly: true };
  console.log(JSON.stringify({
    ok: validation.ok,
    validateOnly: true,
    accountId: target.accountId,
    campaignId: target.campaignId,
    existingActions: existingBefore.map((action) => ({ id: String(action.id), name: action.name })),
    actionsToCreate: createOperations.length,
    requestedActions,
    requestedCampaignGoals: requestedActions.map((action) => ({ category: action.category, origin: 'WEBSITE', biddable: false })),
    safety: { writeCallsMade: false },
  }, null, 2));
  process.exit(0);
}

if (createOperations.length > 0) {
  await runGoogleAdsAtomicMutate(createOperations, { validateOnly: false });
}

const actionsAfterCreate = await readActions();
const goalsBefore = await waitForGoals();
const goalOperations = requestedActions.map((action) => {
  const goal = goalsBefore.find((item) => item.category === action.category && item.origin === 'WEBSITE');
  if (!goal) throw new Error(`Obiettivo campagna non creato da Google: ${action.category}~WEBSITE.`);
  return {
    campaignConversionGoalOperation: {
      update: { resourceName: goal.resourceName, biddable: false },
      updateMask: 'biddable',
    },
  };
});
await runGoogleAdsAtomicMutate(goalOperations, { validateOnly: false });

const actionsAfter = await readActions();
const goalsAfter = await readGoals();
const errors = actionErrors(actionsAfter);
for (const expected of requestedActions) {
  const goal = goalsAfter.find((item) => item.category === expected.category && item.origin === 'WEBSITE');
  if (!goal || goal.biddable !== false) errors.push(`Obiettivo secondario non verificato: ${expected.category}~WEBSITE.`);
}

console.log(JSON.stringify({
  ok: errors.length === 0,
  validateOnly: false,
  errors,
  actions: actionsAfter.map((action) => ({
    id: String(action.id),
    name: action.name,
    status: action.status,
    primaryForGoal: action.primaryForGoal,
    includedInConversions: action.includeInConversionsMetric,
    category: action.category,
    origin: action.origin,
    tracking: extractTag(action),
  })),
  campaignGoals: goalsAfter
    .filter((goal) => requestedActions.some((action) => action.category === goal.category && goal.origin === 'WEBSITE'))
    .map(({ resourceName: _resourceName, ...goal }) => goal),
  safety: {
    writeCallsMade: true,
    secondaryConversionActionsCreated: createOperations.length,
    campaignGoalWritesMade: goalOperations.length,
    primaryGoalChangesMade: false,
    budgetChangesMade: false,
    campaignStatusChangesMade: false,
  },
}, null, 2));

if (errors.length > 0) process.exitCode = 1;
