import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { defaultGoogleCampaignPlan } from './defaultGoogleCampaignPlan.js';

export const GOOGLE_ADS_POLICY_PATH = 'config/google-ads-policy.json';

export function readGoogleAdsPolicy() {
  if (!existsSync(GOOGLE_ADS_POLICY_PATH)) {
    throw new Error(`Policy Google Ads mancante: ${GOOGLE_ADS_POLICY_PATH}.`);
  }

  return JSON.parse(readFileSync(GOOGLE_ADS_POLICY_PATH, 'utf8'));
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

export function validateGoogleCampaignPlan(plan = defaultGoogleCampaignPlan, policy = readGoogleAdsPolicy()) {
  const errors = [];
  const campaign = plan.campaign || {};
  const budget = policy.budget || {};

  if (plan.dryRun !== true || plan.writeCallsAllowed !== false) {
    errors.push('Il piano deve restare in dry-run con scritture disabilitate.');
  }

  if (plan.account?.id !== policy.account?.id || plan.account?.managerId !== policy.account?.managerId) {
    errors.push('Account cliente o manager non coerenti con la policy.');
  }

  if (!['DRAFT', 'PAUSED'].includes(campaign.status)) {
    errors.push('La campagna deve essere DRAFT o PAUSED.');
  }

  if (campaign.advertisingChannelType !== 'SEARCH') {
    errors.push('Il piano iniziale deve usare esclusivamente il canale SEARCH.');
  }

  if (!isIsoDate(campaign.startDate) || !isIsoDate(campaign.endDate) || campaign.startDate > campaign.endDate) {
    errors.push('Intervallo date campagna non valido.');
  }

  if (campaign.openDay !== policy.course?.openDay || campaign.firstRegularLesson !== policy.course?.firstRegularLesson) {
    errors.push('Date open day o prima lezione non coerenti con la policy.');
  }

  if (Number(campaign.averageDailyBudgetEur) > Number(budget.absoluteMaxDailyEur)) {
    errors.push(`Budget giornaliero sopra il limite di ${budget.absoluteMaxDailyEur} EUR.`);
  }

  if (Number(campaign.initialAuthorizedTotalEur) !== Number(budget.initialAuthorizedTotalEur)) {
    errors.push('Budget iniziale non coerente con la policy.');
  }

  if (Number(campaign.conditionalMaxTotalEur) > Number(budget.absoluteMaxTotalEur)) {
    errors.push(`Budget complessivo sopra il limite assoluto di ${budget.absoluteMaxTotalEur} EUR.`);
  }

  if (campaign.networks?.displayNetwork !== false || campaign.networks?.searchPartners !== false) {
    errors.push('Display Network e Search Partners devono restare disabilitati nel test iniziale.');
  }

  if (!Array.isArray(plan.adGroups) || plan.adGroups.length === 0) {
    errors.push('Serve almeno un gruppo di annunci.');
  }

  for (const adGroup of plan.adGroups || []) {
    if (adGroup.status !== 'PAUSED') errors.push(`Il gruppo ${adGroup.name} deve essere in pausa.`);
    if (!adGroup.keywords?.length) errors.push(`Il gruppo ${adGroup.name} non contiene parole chiave.`);
  }

  const ad = plan.responsiveSearchAd || {};
  if (ad.status !== 'PAUSED') errors.push('L annuncio responsive deve essere in pausa.');
  if ((ad.headlines || []).length < 3) errors.push('Servono almeno 3 titoli per l annuncio responsive.');
  if ((ad.descriptions || []).length < 2) errors.push('Servono almeno 2 descrizioni per l annuncio responsive.');

  for (const headline of ad.headlines || []) {
    if (headline.length > 30) errors.push(`Titolo oltre 30 caratteri: ${headline}`);
  }

  for (const description of ad.descriptions || []) {
    if (description.length > 90) errors.push(`Descrizione oltre 90 caratteri: ${description}`);
  }

  const serialized = JSON.stringify(plan);
  if (/GOOGLE_ADS_DEVELOPER_TOKEN|private_key|BEGIN PRIVATE KEY/.test(serialized)) {
    errors.push('Il piano contiene un riferimento a credenziali o chiavi private.');
  }

  if (plan.approval?.allowsGoogleCreate !== false || plan.approval?.allowsGoogleEnable !== false) {
    errors.push('Il piano non deve autorizzare creazione o attivazione.');
  }

  return errors;
}

export function getGoogleCampaignPlanFingerprint(plan) {
  const {
    generatedAt,
    updatedAt,
    validation,
    approval,
    actionLog,
    ...approvalRelevantPlan
  } = structuredClone(plan);

  return createHash('sha256').update(JSON.stringify(approvalRelevantPlan)).digest('hex');
}

export function createValidatedGoogleDryRun(previousPlan = null) {
  const policy = readGoogleAdsPolicy();
  const plan = structuredClone(defaultGoogleCampaignPlan);
  const errors = validateGoogleCampaignPlan(plan, policy);
  const planFingerprint = getGoogleCampaignPlanFingerprint(plan);
  const previousApproval = previousPlan?.approval;
  const preserveApproval = Boolean(
    previousApproval?.approved === true &&
    previousApproval?.scope === 'dry_run_plan_only' &&
    previousApproval?.allowsGoogleCreate === false &&
    previousApproval?.allowsGoogleEnable === false &&
    previousApproval?.planFingerprint === planFingerprint
  );

  return {
    ok: errors.length === 0,
    errors,
    plan: {
      ...plan,
      generatedAt: new Date().toISOString(),
      ...(preserveApproval ? {
        approval: previousApproval,
        actionLog: previousPlan.actionLog || [],
        updatedAt: previousPlan.updatedAt,
      } : {}),
      validation: {
        checkedAt: new Date().toISOString(),
        readyForHumanReview: errors.length === 0,
        readyForGoogleCreate: false,
      },
    },
  };
}
