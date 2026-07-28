import type { APIRoute } from 'astro';
import {
  getDashboardValidation,
  readPolicy,
  runMetaHealthCheck,
  validateCampaignPlan,
} from '../../../lib/metaAdsConfig.js';
import { createPausedMetaDraft } from '../../../lib/metaCampaignCreate.js';
import { readDashboardPlan, writeDashboardPlan } from '../../../lib/metaDashboardStorage.js';

export const prerender = false;
export const maxDuration = 60;

function appendAction(plan: any, action: string, result: string, detail: string) {
  return [
    {
      action,
      result,
      detail,
      createdAt: new Date().toISOString(),
    },
    ...(Array.isArray(plan.actionLog) ? plan.actionLog : []),
  ].slice(0, 50);
}

export const POST: APIRoute = async ({ request }) => {
  const { action } = await request.json().catch(() => ({ action: null }));
  const policy = readPolicy();
  const plan = await readDashboardPlan();
  const errors = validateCampaignPlan(plan, policy);
  const validation = getDashboardValidation(plan, policy);

  if (errors.length > 0) {
    return Response.json({ ok: false, errors }, { status: 400 });
  }

  if (action === 'control') {
    const healthcheck = await runMetaHealthCheck();
    const nextPlan = {
      ...plan,
      updatedAt: new Date().toISOString(),
      lastControl: {
        checkedAt: new Date().toISOString(),
        validation,
        healthcheck,
      },
      actionLog: appendAction(
        plan,
        'control',
        healthcheck.ok && validation.ready ? 'ok' : 'warn',
        healthcheck.ok ? 'Controllo piano e Meta completato.' : healthcheck.error || 'Controllo Meta non riuscito.',
      ),
    };

    await writeDashboardPlan(nextPlan);

    return Response.json({ ok: true, plan: nextPlan, healthcheck, validation });
  }

  if (action === 'pause') {
    const nextPlan = {
      ...plan,
      updatedAt: new Date().toISOString(),
      campaign: {
        ...plan.campaign,
        status: 'PAUSED',
      },
      adSets: plan.adSets.map((adSet: any) => ({ ...adSet, status: 'PAUSED' })),
      ads: plan.ads.map((ad: any) => ({ ...ad, status: 'PAUSED' })),
      actionLog: appendAction(plan, 'pause', 'ok', 'Tutti gli elementi del piano locale sono in pausa.'),
    };

    await writeDashboardPlan(nextPlan);

    return Response.json({ ok: true, plan: nextPlan });
  }

  if (action === 'request_start') {
    if (!validation.ready) {
      return Response.json(
        {
          ok: false,
          errors: validation.checks.filter((check) => !check.ok).map((check) => `${check.label}: ${check.detail}`),
        },
        { status: 400 },
      );
    }

    if (plan.approval?.approved !== true) {
      return Response.json({ ok: false, errors: ['Serve prima approvazione fisica del piano.'] }, { status: 400 });
    }

    const nextPlan = {
      ...plan,
      updatedAt: new Date().toISOString(),
      startRequest: {
        requestedAt: new Date().toISOString(),
        requestedBy: 'admin',
        status: 'ready_for_meta_draft_creation',
        allowsPublish: false,
      },
      actionLog: appendAction(
        plan,
        'request_start',
        'ok',
        'Richiesta avvio registrata. Prossimo step: creazione bozza Meta in PAUSED.',
      ),
    };

    await writeDashboardPlan(nextPlan);

    return Response.json({ ok: true, plan: nextPlan });
  }

  if (action === 'create_meta_draft') {
    try {
      const nextPlan = await createPausedMetaDraft(plan, policy, async (progressPlan: any) => {
        const persistedPlan = {
          ...progressPlan,
          updatedAt: new Date().toISOString(),
        };
        await writeDashboardPlan(persistedPlan);
        return persistedPlan;
      });
      const completedPlan = {
        ...nextPlan,
        actionLog: appendAction(
          nextPlan,
          'create_meta_draft',
          'ok',
          `Bozza Meta ${nextPlan.metaDraft?.campaignId} creata interamente in PAUSED.`,
        ),
      };
      await writeDashboardPlan(completedPlan);
      return Response.json({ ok: true, plan: completedPlan, metaDraft: completedPlan.metaDraft });
    } catch (error) {
      const currentPlan = await readDashboardPlan();
      const message = error instanceof Error ? error.message : 'Creazione bozza Meta non riuscita.';
      const failedPlan = {
        ...currentPlan,
        actionLog: appendAction(currentPlan, 'create_meta_draft', 'warn', message),
      };
      await writeDashboardPlan(failedPlan);
      return Response.json({ ok: false, errors: [message], plan: failedPlan }, { status: 400 });
    }
  }

  return Response.json({ ok: false, errors: ['Azione non riconosciuta.'] }, { status: 400 });
};
