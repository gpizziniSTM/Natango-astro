import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const POLICY_PATH = 'config/meta-ads-policy.json';
const OUTPUT_PATH = 'meta-dry-runs/campaign-plan.json';
const SITE_URL = 'https://www.natango.org/';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readLocalEnv(path = '.env') {
  const text = readFileSync(path, 'utf8');

  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return index === -1 ? [line, ''] : [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

const policy = readJson(POLICY_PATH);
const env = readLocalEnv();
const schedule = readJson('src/content/schedule/table.json');
const settings = readJson('src/content/settings/general.json');
const dailyBudgetEur = Number(env.META_DAILY_BUDGET_CAP_EUR || policy.budget.initialDailyBudgetEur);

if (!Number.isFinite(dailyBudgetEur) || dailyBudgetEur <= 0 || dailyBudgetEur > policy.budget.maxDailyBudgetEur) {
  console.error(`Daily budget must be greater than 0 and no more than ${policy.budget.maxDailyBudgetEur} EUR.`);
  process.exit(1);
}

if (policy.access.allowCreate || policy.access.allowUpdate || policy.access.allowPublish) {
  console.error('Policy is not in dry-run safe mode. Refusing to generate a campaign plan.');
  process.exit(1);
}

const beginnerLesson = schedule.lessons.find((lesson) => lesson.courseName.includes('Principianti'));

const plan = {
  generatedAt: new Date().toISOString(),
  dryRun: true,
  writeCallsAllowed: false,
  policyPath: POLICY_PATH,
  account: {
    id: policy.account.id,
    name: policy.account.name,
    currency: policy.account.currency,
    timezone: policy.account.timezone,
  },
  campaign: {
    name: 'Natango | Corsi Tango Argentino Roma | Dry Run',
    objective: 'OUTCOME_LEADS',
    status: 'PAUSED',
    specialAdCategories: [],
    dailyBudgetEur,
    destinationUrl: SITE_URL,
  },
  tracking: {
    pixelId: policy.tracking.pixelId,
    pixelName: policy.tracking.pixelName,
    activeEvents: policy.tracking.events,
    leadEventName: policy.tracking.leadEventName,
    preferredLeadPath: 'website_lead_form',
    testPaths: ['website_lead_form', 'meta_instant_form'],
  },
  adSets: [
    {
      name: 'Roma | Principianti e interessati al tango | Dry Run',
      status: 'PAUSED',
      optimizationGoal: 'LEAD_GENERATION',
      billingEvent: 'IMPRESSIONS',
      targetingDraft: {
        geoLocations: {
          cities: ['Roma'],
        },
        ageMin: 25,
        ageMax: 65,
        placements: ['facebook_feed', 'instagram_feed', 'instagram_stories', 'instagram_reels'],
      },
      scheduleReference: beginnerLesson
        ? `${beginnerLesson.day} ${beginnerLesson.time}, ${beginnerLesson.location}`
        : null,
    },
  ],
  ads: [
    {
      name: 'Lezione di prova gratuita | Dry Run',
      status: 'PAUSED',
      format: 'single_image_or_video',
      primaryText:
        'Vuoi iniziare tango argentino a Roma? Da Natango trovi un ambiente accogliente, didattica professionale e una lezione di prova gratuita sempre disponibile.',
      headline: 'Tango argentino a Roma',
      description: 'Corsi per principianti assoluti e livelli intermedi.',
      callToAction: 'LEARN_MORE',
      destinationUrl: SITE_URL,
    },
    {
      name: 'Abbraccio, tecnica, musicalita | Dry Run',
      status: 'PAUSED',
      format: 'single_image_or_video',
      primaryText:
        'Scopri il tango argentino con Francesca Del Buono: studio dell’abbraccio, connessione con il partner e improvvisazione in pista.',
      headline: 'Prova una lezione da Natango',
      description: 'Sedi a Roma: Tango Loft e Gotan Club.',
      callToAction: 'CONTACT_US',
      destinationUrl: SITE_URL,
    },
  ],
  contact: {
    email: settings.email,
    phone: settings.phone,
    whatsappText: settings.whatsappText,
  },
  safetyChecks: {
    noMetaWriteCallsMade: true,
    tokenIncludedInOutput: false,
    budgetWithinPolicy: dailyBudgetEur <= policy.budget.maxDailyBudgetEur,
    requiresHumanApprovalBeforeMetaCreate: true,
  },
};

mkdirSync('meta-dry-runs', { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(plan, null, 2)}\n`);

console.log(`Dry-run campaign plan written to ${OUTPUT_PATH}`);
console.log(
  JSON.stringify(
    {
      dryRun: plan.dryRun,
      account: plan.account.id,
      dailyBudgetEur: plan.campaign.dailyBudgetEur,
      campaignStatus: plan.campaign.status,
      adSetCount: plan.adSets.length,
      adCount: plan.ads.length,
      writeCallsAllowed: plan.writeCallsAllowed,
      tokenIncludedInOutput: plan.safetyChecks.tokenIncludedInOutput,
    },
    null,
    2,
  ),
);
