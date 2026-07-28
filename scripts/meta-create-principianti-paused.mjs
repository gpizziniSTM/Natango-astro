import { readFileSync } from 'node:fs';
import { createPausedMetaDraft } from '../src/lib/metaCampaignCreate.js';
import { readPolicy } from '../src/lib/metaAdsConfig.js';
import { readDashboardPlan, writeDashboardPlan } from '../src/lib/metaDashboardStorage.js';

const now = new Date().toISOString();
const existingPlan = await readDashboardPlan();

if (existingPlan.metaDraft?.campaignId && existingPlan.metaDraft?.status === 'completed_paused') {
  console.log(JSON.stringify({
    status: existingPlan.metaDraft.status,
    campaignId: existingPlan.metaDraft.campaignId,
    adSetIds: existingPlan.metaDraft.adSetIds,
    creativeIds: existingPlan.metaDraft.creativeIds,
    adIds: existingPlan.metaDraft.adIds,
    allObjectsPaused: existingPlan.metaDraft.allObjectsPaused,
    reusedExistingDraft: true,
  }, null, 2));
  process.exit(0);
}

const videoAsset = {
  id: 'cc3f3f8b-1044-46d9-910e-9455b7e0d3da',
  originalName: 'Locandina principianti 2026.mp4',
  storedPath: 'meta-assets/cc3f3f8b-1044-46d9-910e-9455b7e0d3da.mp4',
  size: 6537663,
  mimeType: 'video/mp4',
  uploadedAt: now,
  status: 'local_only',
  storage: 'local',
};

readFileSync(videoAsset.storedPath);

const plan = {
  generatedAt: now,
  updatedAt: now,
  dryRun: true,
  writeCallsAllowed: false,
  policyPath: 'config/meta-ads-policy.json',
  account: {
    id: 'act_1088446485620774',
    name: 'Francesca Del Buono - Natango',
    currency: 'EUR',
    timezone: 'Europe/Rome',
  },
  campaign: {
    name: 'Natango | Corsi Tango Argentino Roma | Principianti',
    objective: 'OUTCOME_LEADS',
    status: 'PAUSED',
    specialAdCategories: [],
    dailyBudgetEur: 5,
    durationDays: 10,
    destinationUrl: 'https://www.natango.org/corso-settembre',
  },
  budgetGuard: {
    maxDailyBudgetEur: 5,
    absoluteMaxDailyBudgetEur: 50,
    maxCampaignBudgetEur: 50,
    absoluteMaxCampaignBudgetEur: 500,
  },
  adSets: [{
    name: 'Roma +12 km | Principianti e interessati al tango',
    status: 'PAUSED',
    optimizationGoal: 'LEAD_GENERATION',
    billingEvent: 'IMPRESSIONS',
    targetingDraft: {
      geoLocations: { cities: ['Roma'] },
      ageMin: 25,
      ageMax: 65,
      placements: ['facebook_feed', 'instagram_feed', 'instagram_stories', 'instagram_reels'],
    },
  }],
  ads: [
    {
      name: 'Abbraccio, tecnica, musicalità | Principianti Assoluti',
      status: 'PAUSED',
      format: 'single_video',
      primaryText: 'Scopri il tango argentino con Francesca Del Buono: studio dell’abbraccio, connessione con il partner e improvvisazione in pista.',
      headline: 'Prova una lezione da Natango',
      description: 'Sedi a Roma: Tango Loft e Gotan Club.',
      callToAction: 'CONTACT_US',
      destinationUrl: 'https://www.natango.org/corso-settembre',
      mediaAssetId: videoAsset.id,
    },
    {
      name: 'Promo mese gratuito | Principianti Primi Passi',
      status: 'PAUSED',
      format: 'single_video',
      primaryText: 'Vuoi iniziare tango argentino a Roma? Da Natango trovi un ambiente accogliente, didattica professionale ed il primo mese gratuito!',
      headline: 'Tango argentino a Roma',
      description: 'Corsi per principianti assoluti e livelli intermedi.',
      callToAction: 'CONTACT_US',
      destinationUrl: 'https://www.natango.org/corso-settembre',
      mediaAssetId: videoAsset.id,
    },
  ],
  mediaAssets: [videoAsset],
  safetyChecks: {
    noMetaWriteCallsMade: true,
    tokenIncludedInOutput: false,
    budgetWithinPolicy: true,
    requiresHumanApprovalBeforeMetaCreate: true,
  },
  tracking: {
    pixelId: '3144834565717555',
    pixelName: 'Natango Website Pixel',
    activeEvents: ['PageView', 'Lead'],
    leadEventName: 'Lead',
    preferredLeadPath: 'website_lead_form',
  },
  approval: {
    approved: true,
    approvedAt: now,
    approvedBy: 'user',
    approvalType: 'explicit_user_chat_confirmation',
    scope: 'meta_create_paused_only',
    allowsMetaPublish: false,
  },
  startRequest: {
    requestedAt: now,
    requestedBy: 'user',
    status: 'ready_for_meta_draft_creation',
    allowsPublish: false,
  },
  actionLog: [],
};

await writeDashboardPlan(plan);
const result = await createPausedMetaDraft(plan, readPolicy(), writeDashboardPlan);
console.log(JSON.stringify({
  status: result.metaDraft.status,
  campaignId: result.metaDraft.campaignId,
  adSetIds: result.metaDraft.adSetIds,
  creativeIds: result.metaDraft.creativeIds,
  adIds: result.metaDraft.adIds,
  allObjectsPaused: result.metaDraft.allObjectsPaused,
}, null, 2));
