import type { APIRoute } from 'astro';
import { getDashboardValidation, readPolicy, validateCampaignPlan } from '../../../lib/metaAdsConfig.js';
import { readDashboardPlan, writeDashboardPlan } from '../../../lib/metaDashboardStorage.js';

export const prerender = false;

export const POST: APIRoute = async () => {
  const policy = readPolicy();
  const plan = await readDashboardPlan();
  const errors = validateCampaignPlan(plan, policy);
  const validation = getDashboardValidation(plan, policy);

  if (errors.length > 0 || !validation.ready) {
    return Response.json(
      {
        ok: false,
        errors: errors.length > 0 ? errors : validation.checks.filter((check) => !check.ok).map((check) => check.detail),
      },
      { status: 400 },
    );
  }

  const approval = {
    approved: true,
    approvedAt: new Date().toISOString(),
    approvedBy: 'admin',
    approvalType: 'physical_dashboard_click',
    scope: policy.access?.allowCreate ? 'meta_create_paused_only' : 'dry_run_plan_only',
    allowsMetaPublish: false,
    requiresSeparateMetaCreateConfirmation: true,
    validation,
  };
  const nextPlan = {
    ...plan,
    updatedAt: new Date().toISOString(),
    approval,
  };

  await writeDashboardPlan(nextPlan);

  return Response.json({ ok: true, approval, plan: nextPlan });
};
