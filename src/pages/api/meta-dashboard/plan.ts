import type { APIRoute } from 'astro';
import { getBudgetLimits, readPolicy, validateCampaignPlan } from '../../../lib/metaAdsConfig.js';
import { readDashboardPlan, writeDashboardPlan } from '../../../lib/metaDashboardStorage.js';

export const prerender = false;

function creationFields(plan: any) {
  return JSON.stringify({
    campaign: plan.campaign,
    budgetGuard: plan.budgetGuard,
    adSets: plan.adSets,
    ads: plan.ads,
    tracking: plan.tracking,
    mediaAssets: (plan.mediaAssets ?? []).map((asset: any) => ({
      id: asset.id,
      storedPath: asset.storedPath,
      mimeType: asset.mimeType,
      size: asset.size,
    })),
  });
}

export const GET: APIRoute = async () => {
  const plan = await readDashboardPlan();

  return Response.json({ ok: true, plan });
};

export const POST: APIRoute = async ({ request }) => {
  const plan = await request.json();
  const storedPlan = await readDashboardPlan();
  const policy = readPolicy();
  const errors = validateCampaignPlan(plan, policy);
  const budgetLimits = getBudgetLimits(plan, policy);

  if (errors.length > 0) {
    return Response.json({ ok: false, errors }, { status: 400 });
  }

  const creationChanged = creationFields(plan) !== creationFields(storedPlan);
  const nextPlan = {
    ...plan,
    generatedAt: plan.generatedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dryRun: true,
    writeCallsAllowed: false,
    safetyChecks: {
      ...plan.safetyChecks,
      noMetaWriteCallsMade: !plan.metaDraft?.campaignId,
      tokenIncludedInOutput: false,
      budgetWithinPolicy: Number(plan.campaign.dailyBudgetEur) <= budgetLimits.maxDailyBudgetEur,
      requiresHumanApprovalBeforeMetaCreate: true,
    },
    approval: creationChanged
      ? {
          ...(plan.approval ?? {}),
          approved: false,
          approvedAt: null,
          approvedBy: null,
          approvalType: null,
          resetAt: new Date().toISOString(),
          resetReason: 'Piano modificato: serve una nuova approvazione fisica.',
          allowsMetaPublish: false,
          requiresSeparateMetaCreateConfirmation: true,
        }
      : plan.approval,
    startRequest: creationChanged ? null : plan.startRequest,
  };

  await writeDashboardPlan(nextPlan);

  return Response.json({ ok: true, plan: nextPlan });
};
