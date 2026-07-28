import type { APIRoute } from 'astro';
import { getGoogleCampaignPlanFingerprint, readGoogleAdsPolicy, validateGoogleCampaignPlan } from '../../../lib/googleAdsPlan.js';
import { readGoogleDashboardPlan, writeGoogleDashboardPlan } from '../../../lib/googleDashboardStorage.js';

export const prerender = false;

export const POST: APIRoute = async () => {
  const policy = readGoogleAdsPolicy();
  const plan = await readGoogleDashboardPlan();
  const errors = validateGoogleCampaignPlan(plan, policy);

  if (errors.length > 0) return Response.json({ ok: false, errors }, { status: 400 });

  const approval = {
    approved: true,
    approvedAt: new Date().toISOString(),
    approvedBy: 'admin',
    approvalType: 'physical_dashboard_click',
    scope: 'dry_run_plan_only',
    planFingerprint: getGoogleCampaignPlanFingerprint(plan),
    allowsGoogleCreate: false,
    allowsGoogleEnable: false,
    requiresSeparateCreateApproval: true,
    requiresSeparateEnableApproval: true,
  };
  const nextPlan = {
    ...plan,
    updatedAt: new Date().toISOString(),
    approval,
    actionLog: [
      ...(plan.actionLog || []),
      {
        action: 'approve_google_dry_run',
        result: 'ok',
        detail: 'Approvato solo il piano locale. Nessuna scrittura Google eseguita.',
        createdAt: new Date().toISOString(),
      },
    ],
  };

  await writeGoogleDashboardPlan(nextPlan);
  return Response.json({ ok: true, approval, plan: nextPlan });
};
