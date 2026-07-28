import { createHash, randomUUID } from 'node:crypto';
import { GRAPH_API_VERSION, getBudgetLimits, getMetaEnv, getDashboardValidation } from './metaAdsConfig.js';
import { readDashboardMedia } from './metaDashboardStorage.js';

const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

function cents(value) {
  return Math.round(Number(value) * 100);
}

function metaError(payload, fallback) {
  const message = payload?.error?.error_user_msg || payload?.error?.message || fallback;
  const code = payload?.error?.code ? ` (Meta ${payload.error.code})` : '';
  return new Error(`${message}${code}`);
}

async function metaPost(path, fields, accessToken) {
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      body.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  }

  body.set('access_token', accessToken);
  const response = await fetch(`${GRAPH_BASE_URL}/${path}`, { method: 'POST', body });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.error) {
    throw metaError(payload, 'Scrittura Meta non riuscita.');
  }

  return payload;
}

async function metaGet(path, fields, accessToken) {
  const url = new URL(`${GRAPH_BASE_URL}/${path}`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('access_token', accessToken);
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.error) {
    throw metaError(payload, 'Lettura Meta non riuscita.');
  }

  return payload;
}

async function uploadMedia(asset, bytes, adAccountId, accessToken) {
  const form = new FormData();
  const isVideo = asset.mimeType?.startsWith('video/');
  const endpoint = isVideo ? 'advideos' : 'adimages';
  form.set('access_token', accessToken);
  form.set('source', new Blob([bytes], { type: asset.mimeType }), asset.originalName);

  if (isVideo) {
    form.set('title', asset.originalName);
  }

  const response = await fetch(`${GRAPH_BASE_URL}/${adAccountId}/${endpoint}`, { method: 'POST', body: form });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.error) {
    throw metaError(payload, `Caricamento di ${asset.originalName} non riuscito.`);
  }

  if (isVideo) {
    return { kind: 'video', id: String(payload.id) };
  }

  const image = Object.values(payload.images || {})[0];

  if (!image?.hash) {
    throw new Error(`Meta non ha restituito l'hash per ${asset.originalName}.`);
  }

  return { kind: 'image', hash: image.hash };
}

async function waitForVideo(videoId, accessToken) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const video = await metaGet(videoId, 'status,picture', accessToken);
    const status = video.status?.video_status;

    if (status === 'ready') {
      return video;
    }

    if (status === 'error') {
      throw new Error('Meta non e riuscita a elaborare il video.');
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error('Il video e ancora in elaborazione su Meta. Riprova tra un minuto: la bozza verra ripresa senza duplicati.');
}

function buildTargeting(adSet, policy) {
  const placements = adSet.targetingDraft?.placements || [];
  const usesFacebook = placements.some((placement) => placement.startsWith('facebook_'));
  const usesInstagram = placements.some((placement) => placement.startsWith('instagram_'));
  const publisherPlatforms = [usesFacebook ? 'facebook' : null, usesInstagram ? 'instagram' : null].filter(Boolean);
  const latitude = Number(policy.targeting.romeCenterLatitude);
  const longitude = Number(policy.targeting.romeCenterLongitude);
  const radius = Number(policy.targeting.romeRadiusKm || 12);
  const geoLocations = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? {
        custom_locations: [
          {
            latitude,
            longitude,
            radius,
            distance_unit: 'kilometer',
          },
        ],
        location_types: policy.targeting.locationTypes || ['home'],
      }
    : {
        cities: [
          {
            key: String(policy.targeting.romeCityKey),
            radius,
            distance_unit: 'kilometer',
          },
        ],
        location_types: policy.targeting.locationTypes || ['home'],
      };
  const targeting = {
    geo_locations: geoLocations,
    age_min: Number(adSet.targetingDraft?.ageMin || 25),
    age_max: Number(adSet.targetingDraft?.ageMax || 65),
    publisher_platforms: publisherPlatforms.length ? publisherPlatforms : ['facebook'],
  };

  const facebookPositionMap = {
    facebook_feed: 'feed',
  };
  const instagramPositionMap = {
    instagram_feed: 'stream',
    instagram_stories: 'story',
    instagram_reels: 'reels',
  };
  const facebookPositions = placements.map((placement) => facebookPositionMap[placement]).filter(Boolean);
  const instagramPositions = placements.map((placement) => instagramPositionMap[placement]).filter(Boolean);

  if (facebookPositions.length) targeting.facebook_positions = facebookPositions;
  if (instagramPositions.length) targeting.instagram_positions = instagramPositions;
  return targeting;
}

function assertCreationAllowed(plan, policy) {
  const validation = getDashboardValidation(plan, policy);
  const limits = getBudgetLimits(plan, policy);
  const expectedTotal = Number(plan.campaign.dailyBudgetEur) * Number(plan.campaign.durationDays);

  if (policy.access?.allowCreate !== true || policy.access?.allowPublish === true) {
    throw new Error('La policy non consente la creazione protetta in pausa.');
  }

  if (!validation.ready) {
    throw new Error(validation.checks.filter((check) => !check.ok).map((check) => check.detail).join(' '));
  }

  const acceptedApprovalTypes = ['physical_dashboard_click', 'explicit_user_chat_confirmation'];
  if (plan.approval?.approved !== true || !acceptedApprovalTypes.includes(plan.approval?.approvalType)) {
    throw new Error('Serve una nuova approvazione fisica del piano.');
  }

  if (plan.startRequest?.status !== 'ready_for_meta_draft_creation') {
    throw new Error('Premi prima Avvio per registrare la richiesta di creazione.');
  }

  if (Number(plan.campaign.dailyBudgetEur) > limits.maxDailyBudgetEur || expectedTotal > limits.maxCampaignBudgetEur) {
    throw new Error('Budget o durata superano i limiti approvati.');
  }

  if (plan.campaign.status !== 'PAUSED' || plan.adSets.some((item) => item.status !== 'PAUSED') || plan.ads.some((item) => item.status !== 'PAUSED')) {
    throw new Error('Campagna, pubblico e annunci devono essere tutti in pausa.');
  }

  if (!policy.identity?.pageId || !policy.targeting?.romeCityKey) {
    throw new Error('Pagina Facebook o localita Roma non configurate.');
  }

  if (!policy.transparency?.dsaBeneficiary || !policy.transparency?.dsaPayor) {
    throw new Error('Beneficiario o pagatore DSA non configurati.');
  }
}

function selectedAsset(plan, ad) {
  const asset = plan.mediaAssets?.find((item) => item.id === ad.mediaAssetId);
  if (!asset) throw new Error(`Media mancante per l'annuncio ${ad.name}.`);
  return asset;
}

export async function createPausedMetaDraft(initialPlan, policy, persist) {
  assertCreationAllowed(initialPlan, policy);
  const env = getMetaEnv();

  if (!env.adAccountId || !env.accessToken) {
    throw new Error('Configurazione Meta incompleta.');
  }

  let plan = structuredClone(initialPlan);
  const now = new Date();
  const creationKey = plan.metaDraft?.creationKey || randomUUID().split('-')[0];
  plan.metaDraft = {
    creationKey,
    status: plan.metaDraft?.status || 'creating',
    createdAt: plan.metaDraft?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
    campaignId: plan.metaDraft?.campaignId || null,
    adSetIds: plan.metaDraft?.adSetIds || [],
    media: plan.metaDraft?.media || {},
    creativeIds: plan.metaDraft?.creativeIds || [],
    adIds: plan.metaDraft?.adIds || [],
    allObjectsPaused: true,
    allowsPublish: false,
  };
  plan = await persist(plan);

  try {
    if (!plan.metaDraft.campaignId) {
      const campaign = await metaPost(`${env.adAccountId}/campaigns`, {
        name: `${plan.campaign.name.trim()} | Bozza ${creationKey}`,
        objective: plan.campaign.objective,
        buying_type: 'AUCTION',
        is_adset_budget_sharing_enabled: false,
        special_ad_categories: plan.campaign.specialAdCategories || [],
        status: 'PAUSED',
      }, env.accessToken);
      plan.metaDraft.campaignId = String(campaign.id);
      plan.metaDraft.updatedAt = new Date().toISOString();
      plan = await persist(plan);
    }

    for (let index = 0; index < plan.adSets.length; index += 1) {
      if (plan.metaDraft.adSetIds[index]) continue;
      const adSet = plan.adSets[index];
      const endTime = new Date(Date.now() + Number(plan.campaign.durationDays) * 24 * 60 * 60 * 1000).toISOString();
      const created = await metaPost(`${env.adAccountId}/adsets`, {
        name: `${adSet.name.replace(/\s*\|\s*Dry Run$/i, '')} | Bozza ${creationKey}`,
        campaign_id: plan.metaDraft.campaignId,
        daily_budget: cents(plan.campaign.dailyBudgetEur),
        billing_event: adSet.billingEvent || 'IMPRESSIONS',
        optimization_goal: 'OFFSITE_CONVERSIONS',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        destination_type: 'WEBSITE',
        dsa_beneficiary: policy.transparency.dsaBeneficiary,
        dsa_payor: policy.transparency.dsaPayor,
        promoted_object: {
          pixel_id: plan.tracking.pixelId,
          custom_event_type: 'LEAD',
        },
        targeting: buildTargeting(adSet, policy),
        end_time: endTime,
        status: 'PAUSED',
      }, env.accessToken);
      plan.metaDraft.adSetIds[index] = String(created.id);
      plan.metaDraft.updatedAt = new Date().toISOString();
      plan = await persist(plan);
    }

    for (let index = 0; index < plan.ads.length; index += 1) {
      const ad = plan.ads[index];
      const asset = selectedAsset(plan, ad);
      let uploaded = plan.metaDraft.media[asset.id];

      if (!uploaded) {
        const media = await readDashboardMedia(asset);
        if (!media) throw new Error(`File non trovato: ${asset.originalName}.`);
        const fingerprint = createHash('sha256').update(media.bytes).digest('hex');
        uploaded = Object.values(plan.metaDraft.media).find((item) => item.fingerprint === fingerprint);

        if (!uploaded) {
          uploaded = { ...(await uploadMedia(asset, media.bytes, env.adAccountId, env.accessToken)), fingerprint };
        }

        plan.metaDraft.media[asset.id] = uploaded;
        plan.metaDraft.updatedAt = new Date().toISOString();
        plan = await persist(plan);
      }

      if (!plan.metaDraft.creativeIds[index]) {
        const callToAction = { type: ad.callToAction || 'LEARN_MORE', value: { link: ad.destinationUrl } };
        const storySpec = {
          page_id: policy.identity.pageId,
          ...(policy.identity.instagramUserId ? { instagram_user_id: policy.identity.instagramUserId } : {}),
        };

        if (uploaded.kind === 'video') {
          const video = await waitForVideo(uploaded.id, env.accessToken);
          storySpec.video_data = {
            video_id: uploaded.id,
            message: ad.primaryText,
            title: ad.headline,
            link_description: ad.description,
            call_to_action: callToAction,
            ...(video.picture ? { image_url: video.picture } : {}),
          };
        } else {
          storySpec.link_data = {
            image_hash: uploaded.hash,
            link: ad.destinationUrl,
            message: ad.primaryText,
            name: ad.headline,
            description: ad.description,
            call_to_action: callToAction,
          };
        }

        const creative = await metaPost(`${env.adAccountId}/adcreatives`, {
          name: `${ad.name.replace(/\s*\|\s*Dry Run$/i, '')} | Creativita ${creationKey}`,
          object_story_spec: storySpec,
        }, env.accessToken);
        plan.metaDraft.creativeIds[index] = String(creative.id);
        plan.metaDraft.updatedAt = new Date().toISOString();
        plan = await persist(plan);
      }

      if (!plan.metaDraft.adIds[index]) {
        const createdAd = await metaPost(`${env.adAccountId}/ads`, {
          name: `${ad.name.replace(/\s*\|\s*Dry Run$/i, '')} | Bozza ${creationKey}`,
          adset_id: plan.metaDraft.adSetIds[Math.min(index, plan.metaDraft.adSetIds.length - 1)],
          creative: { creative_id: plan.metaDraft.creativeIds[index] },
          status: 'PAUSED',
        }, env.accessToken);
        plan.metaDraft.adIds[index] = String(createdAd.id);
        plan.metaDraft.updatedAt = new Date().toISOString();
        plan = await persist(plan);
      }
    }

    plan.metaDraft.status = 'completed_paused';
    plan.metaDraft.completedAt = new Date().toISOString();
    plan.metaDraft.updatedAt = plan.metaDraft.completedAt;
    plan.startRequest.status = 'meta_draft_created_paused';
    return persist(plan);
  } catch (error) {
    plan.metaDraft.status = 'error_paused';
    plan.metaDraft.lastError = error instanceof Error ? error.message : 'Errore durante la creazione Meta.';
    plan.metaDraft.updatedAt = new Date().toISOString();
    await persist(plan);
    throw error;
  }
}
