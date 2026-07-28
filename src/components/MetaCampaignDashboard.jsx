import { useEffect, useMemo, useRef, useState } from 'react';
import { upload } from '@vercel/blob/client';

function formatCurrency(value) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

function clonePlan(plan) {
  return JSON.parse(JSON.stringify(plan));
}

function resetBudgetApproval(approval, reason) {
  return {
    ...(approval ?? {}),
    approved: false,
    approvedAt: null,
    approvedBy: null,
    approvalType: null,
    resetAt: new Date().toISOString(),
    resetReason: reason,
    allowsMetaPublish: false,
    requiresSeparateMetaCreateConfirmation: true,
  };
}

function clampBudget(value, limit) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 1;
  }

  return Math.min(Math.max(Math.round(numericValue), 1), limit);
}

function clampDurationDays(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 1;
  }

  return Math.min(Math.max(Math.round(numericValue), 1), 90);
}

function getAbsoluteBudgetLimit(policy) {
  return Number(policy.budget.absoluteMaxDailyBudgetEur || policy.budget.maxConfigurableDailyBudgetEur || policy.budget.maxDailyBudgetEur);
}

function getAbsoluteCampaignBudgetLimit(policy) {
  return Number(policy.budget.absoluteMaxCampaignBudgetEur || policy.budget.maxCampaignBudgetEur || 500);
}

function getBudgetLimit(plan, policy) {
  return clampBudget(plan.budgetGuard?.maxDailyBudgetEur ?? policy.budget.maxDailyBudgetEur, getAbsoluteBudgetLimit(policy));
}

function getCampaignBudgetLimit(plan, policy) {
  return clampBudget(
    plan.budgetGuard?.maxCampaignBudgetEur ?? policy.budget.maxCampaignBudgetEur ?? getAbsoluteCampaignBudgetLimit(policy),
    getAbsoluteCampaignBudgetLimit(policy),
  );
}

function safeExtension(fileName, mimeType) {
  const extension = fileName.includes('.') ? `.${fileName.split('.').pop().toLowerCase()}` : '';

  if (['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov'].includes(extension)) {
    return extension;
  }

  const byMime = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
  };

  return byMime[mimeType] || '';
}

function mediaUrl(item) {
  const params = new URLSearchParams();

  if (item.storedPath) {
    params.set('path', item.storedPath);
  }

  if (item.mimeType) {
    params.set('type', item.mimeType);
  }

  if (item.originalName) {
    params.set('name', item.originalName);
  }

  return `/api/meta-dashboard/media/${item.id}${params.size ? `?${params.toString()}` : ''}`;
}

function validatePlanForDashboard(plan, policy) {
  const adsWithText = plan.ads?.filter((ad) => ad.primaryText?.trim() && ad.headline?.trim()) ?? [];
  const mediaCount = plan.mediaAssets?.length ?? 0;
  const budgetLimit = getBudgetLimit(plan, policy);
  const checks = [
    {
      label: 'Account Meta',
      ok: plan.account?.id === policy.account.id,
      detail: plan.account?.id === policy.account.id ? policy.account.name : 'Account non corrispondente',
    },
    {
      label: 'Budget',
      ok: Number(plan.campaign?.dailyBudgetEur) <= budgetLimit,
      detail: `${formatCurrency(plan.campaign?.dailyBudgetEur ?? 0)} / giorno`,
    },
    {
      label: 'Stato campagna',
      ok: plan.campaign?.status === 'PAUSED' || plan.campaign?.status === 'DRAFT',
      detail: plan.campaign?.status || 'Mancante',
    },
    {
      label: 'Testi annunci',
      ok: adsWithText.length === plan.ads?.length && adsWithText.length > 0,
      detail: `${adsWithText.length}/${plan.ads?.length ?? 0} completi`,
    },
    {
      label: 'Media',
      ok: mediaCount > 0,
      detail: mediaCount > 0 ? `${mediaCount} asset caricati` : 'Nessun media caricato',
    },
    {
      label: 'Modalita sicura',
      ok: plan.dryRun === true && plan.writeCallsAllowed === false,
      detail: plan.writeCallsAllowed
        ? 'Scritture non protette'
        : policy.access?.allowCreate
          ? 'Solo creazione in PAUSED; attivazione bloccata'
          : 'Dry-run, scritture bloccate',
    },
    {
      label: 'Segreti',
      ok: plan.safetyChecks?.tokenIncludedInOutput === false,
      detail: 'Token non incluso nel piano',
    },
    {
      label: 'Pixel',
      ok: plan.tracking?.pixelId === policy.tracking?.pixelId && plan.tracking?.activeEvents?.includes('Lead'),
      detail: plan.tracking?.pixelId ? `Pixel ${plan.tracking.pixelId}, Lead attivo` : 'Pixel non configurato',
    },
  ];

  return {
    checks,
    ready: checks.every((check) => check.ok),
  };
}

export default function MetaCampaignDashboard({ initialPlan, policy, defaultPlan }) {
  const [plan, setPlan] = useState(() => clonePlan(initialPlan));
  const [selectedAdIndex, setSelectedAdIndex] = useState(0);
  const [mediaItems, setMediaItems] = useState(() => initialPlan.mediaAssets ?? []);
  const [selectedMediaId, setSelectedMediaId] = useState(() => initialPlan.ads?.[0]?.mediaAssetId ?? initialPlan.mediaAssets?.[0]?.id ?? null);
  const [isUploading, setIsUploading] = useState(false);
  const [isMediaLibraryOpen, setIsMediaLibraryOpen] = useState(false);
  const [billing, setBilling] = useState(null);
  const [billingError, setBillingError] = useState('');
  const [isBillingLoading, setIsBillingLoading] = useState(false);
  const [isCreatingMetaDraft, setIsCreatingMetaDraft] = useState(false);
  const [saveState, setSaveState] = useState('idle');
  const [lastSavedSignature, setLastSavedSignature] = useState(() => JSON.stringify(initialPlan));
  const planImportInputRef = useRef(null);
  const [activity, setActivity] = useState([
    {
      label: 'Piano dry-run generato',
      detail: `${initialPlan.ads.length} creativita, ${initialPlan.adSets.length} pubblico`,
      tone: 'ok',
    },
  ]);

  const selectedAd = plan.ads[selectedAdIndex] ?? plan.ads[0];
  const selectedMedia = mediaItems.find((item) => item.id === selectedMediaId) ?? null;
  const absoluteBudgetLimit = getAbsoluteBudgetLimit(policy);
  const budgetLimit = getBudgetLimit(plan, policy);
  const absoluteCampaignBudgetLimit = getAbsoluteCampaignBudgetLimit(policy);
  const campaignBudgetLimit = getCampaignBudgetLimit(plan, policy);
  const budgetWithinPolicy = plan.campaign.dailyBudgetEur <= budgetLimit;
  const allPaused =
    plan.campaign.status === 'PAUSED' &&
    plan.adSets.every((adSet) => adSet.status === 'PAUSED') &&
    plan.ads.every((ad) => ad.status === 'PAUSED');
  const validation = useMemo(() => validatePlanForDashboard(plan, policy), [plan, policy]);
  const isDirty = useMemo(() => JSON.stringify(plan) !== lastSavedSignature, [lastSavedSignature, plan]);

  const safetyScore = useMemo(() => {
    return [
      plan.dryRun,
      plan.writeCallsAllowed === false,
      budgetWithinPolicy,
      allPaused,
      plan.safetyChecks.tokenIncludedInOutput === false,
    ].filter(Boolean).length;
  }, [allPaused, budgetWithinPolicy, plan]);

  const isApproved = plan.approval?.approved === true;

  function updateCampaign(key, value) {
    setPlan((current) => ({
      ...current,
      campaign: {
        ...current.campaign,
        [key]: value,
      },
    }));
  }

  function updateBudget(value) {
    const nextBudget = clampBudget(value, budgetLimit);

    setPlan((current) => {
      if (Number(current.campaign.dailyBudgetEur) === nextBudget) {
        return current;
      }

      return {
        ...current,
        campaign: {
          ...current.campaign,
          dailyBudgetEur: nextBudget,
        },
        approval: resetBudgetApproval(
          current.approval,
          'Budget giornaliero modificato: serve una nuova approvazione fisica.',
        ),
      };
    });
    setSaveState('idle');
  }

  function updateCampaignBudgetLimit(value) {
    const nextLimit = clampBudget(value, absoluteCampaignBudgetLimit);

    setPlan((current) => {
      if (getCampaignBudgetLimit(current, policy) === nextLimit) {
        return current;
      }

      return {
        ...current,
        budgetGuard: {
          ...(current.budgetGuard ?? {}),
          maxDailyBudgetEur: getBudgetLimit(current, policy),
          absoluteMaxDailyBudgetEur: absoluteBudgetLimit,
          maxCampaignBudgetEur: nextLimit,
          absoluteMaxCampaignBudgetEur: absoluteCampaignBudgetLimit,
          updatedAt: new Date().toISOString(),
        },
        approval: resetBudgetApproval(
          current.approval,
          'Tetto totale campagna modificato: serve una nuova approvazione fisica.',
        ),
      };
    });
    setSaveState('idle');
  }

  function updateAd(key, value) {
    setPlan((current) => ({
      ...current,
      ads: current.ads.map((ad, index) => (index === selectedAdIndex ? { ...ad, [key]: value } : ad)),
    }));
  }

  function selectAd(index) {
    const nextAd = plan.ads[index] ?? plan.ads[0];
    setSelectedAdIndex(index);
    setSelectedMediaId(nextAd?.mediaAssetId ?? mediaItems[0]?.id ?? null);
  }

  function selectMedia(asset) {
    setSelectedMediaId(asset.id);
    setPlan((current) => ({
      ...current,
      ads: current.ads.map((ad, index) => (index === selectedAdIndex ? { ...ad, mediaAssetId: asset.id } : ad)),
    }));
    setIsMediaLibraryOpen(false);
    addActivity('Media selezionato', `${asset.originalName} associato all'annuncio ${selectedAdIndex + 1}`, 'ok');
  }

  function updateTracking(key, value) {
    setPlan((current) => ({
      ...current,
      tracking: {
        pixelId: policy.tracking?.pixelId,
        pixelName: policy.tracking?.pixelName,
        activeEvents: policy.tracking?.events ?? [],
        leadEventName: policy.tracking?.leadEventName ?? 'Lead',
        preferredLeadPath: 'website_lead_form',
        testPaths: ['website_lead_form', 'meta_instant_form'],
        ...current.tracking,
        [key]: value,
      },
    }));
  }

  function addActivity(label, detail, tone = 'info') {
    setActivity((current) => [{ label, detail, tone }, ...current].slice(0, 6));
  }

  function formatMoneyDetail(value) {
    if (value === null || value === undefined) {
      return 'n.d.';
    }

    return formatCurrency(value);
  }

  function formatSpendCap(value) {
    if (value === null || value === undefined) {
      return 'n.d.';
    }

    if (Number(value) === 0) {
      return 'Nessun limite account';
    }

    return formatCurrency(value);
  }

  async function loadBilling() {
    setIsBillingLoading(true);
    setBillingError('');

    try {
      const response = await fetch(`/api/meta-dashboard/billing?t=${Date.now()}`, {
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Lettura fatturazione non riuscita.');
      }

      setBilling(payload);
    } catch (error) {
      setBillingError(error.message);
    } finally {
      setIsBillingLoading(false);
    }
  }

  function makeEditablePlan(sourcePlan, resetReason) {
    const now = new Date().toISOString();
    const nextPlan = clonePlan(sourcePlan);
    const nextBudgetLimit = getBudgetLimit(nextPlan, policy);

    return {
      ...nextPlan,
      generatedAt: nextPlan.generatedAt || now,
      updatedAt: now,
      dryRun: true,
      writeCallsAllowed: false,
      account: {
        ...policy.account,
        ...(nextPlan.account ?? {}),
        id: policy.account.id,
      },
      campaign: {
        ...(nextPlan.campaign ?? {}),
        status: nextPlan.campaign?.status === 'DRAFT' ? 'DRAFT' : 'PAUSED',
        dailyBudgetEur: clampBudget(nextPlan.campaign?.dailyBudgetEur ?? policy.budget.initialDailyBudgetEur, nextBudgetLimit),
        durationDays: clampDurationDays(nextPlan.campaign?.durationDays ?? 10),
      },
      budgetGuard: {
        ...(nextPlan.budgetGuard ?? {}),
        maxDailyBudgetEur: nextBudgetLimit,
        absoluteMaxDailyBudgetEur: getAbsoluteBudgetLimit(policy),
        maxCampaignBudgetEur: getCampaignBudgetLimit(nextPlan, policy),
        absoluteMaxCampaignBudgetEur: getAbsoluteCampaignBudgetLimit(policy),
        updatedAt: now,
      },
      adSets: Array.isArray(nextPlan.adSets) ? nextPlan.adSets.map((adSet) => ({ ...adSet, status: 'PAUSED' })) : [],
      ads: Array.isArray(nextPlan.ads) ? nextPlan.ads.map((ad) => ({ ...ad, status: 'PAUSED' })) : [],
      mediaAssets: Array.isArray(nextPlan.mediaAssets) ? nextPlan.mediaAssets : [],
      tracking: {
        pixelId: policy.tracking?.pixelId,
        pixelName: policy.tracking?.pixelName,
        activeEvents: policy.tracking?.events ?? [],
        leadEventName: policy.tracking?.leadEventName ?? 'Lead',
        preferredLeadPath: 'website_lead_form',
        testPaths: ['website_lead_form', 'meta_instant_form'],
        ...(nextPlan.tracking ?? {}),
      },
      approval: {
        approved: false,
        resetAt: now,
        resetReason,
        allowsMetaPublish: false,
        requiresSeparateMetaCreateConfirmation: true,
      },
      safetyChecks: {
        ...(nextPlan.safetyChecks ?? {}),
        noMetaWriteCallsMade: true,
        tokenIncludedInOutput: false,
        budgetWithinPolicy: true,
        requiresHumanApprovalBeforeMetaCreate: true,
      },
    };
  }

  function applyPlanDraft(nextPlan, label, detail) {
    setPlan(nextPlan);
    setMediaItems(nextPlan.mediaAssets ?? []);
    setSelectedAdIndex(0);
    setSelectedMediaId(nextPlan.ads?.[0]?.mediaAssetId ?? nextPlan.mediaAssets?.[0]?.id ?? null);
    addActivity(label, detail, 'ok');
  }

  function startNewCampaign() {
    if (!window.confirm('Creare una nuova campagna e svuotare il piano corrente nella dashboard? Il cambio sara permanente solo dopo Salva.')) {
      return;
    }

    applyNewCampaignDraft();
  }

  function applyNewCampaignDraft() {
    const nextPlan = makeEditablePlan(
      {
        ...(defaultPlan ?? initialPlan),
        mediaAssets: mediaItems,
        actionLog: [],
      },
      'Nuova campagna creata dalla dashboard: serve nuova approvazione fisica.',
    );
    nextPlan.ads = nextPlan.ads.map((ad) => {
      const { mediaAssetId, ...adWithoutMedia } = ad;
      return adWithoutMedia;
    });

    applyPlanDraft(nextPlan, 'Nuova campagna', 'Piano pulito pronto da modificare. Premi Salva per renderlo permanente.');
  }

  async function loadMetaCampaignDraft(campaignId) {
    try {
      addActivity('Carico campagna Meta', `ID ${campaignId}`, 'info');

      const response = await fetch(`/api/meta-campaigns/${encodeURIComponent(campaignId)}/plan?t=${Date.now()}`, {
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Import campagna Meta non riuscito.');
      }

      const nextPlan = {
        ...payload.plan,
        mediaAssets: mediaItems,
      };

      applyPlanDraft(nextPlan, 'Campagna importata', `${payload.campaign?.name || campaignId} caricata in modifica. Premi Salva per renderla piano corrente.`);
    } catch (error) {
      addActivity('Import Meta fallito', error.message, 'warn');
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const campaignId = params.get('campaignId');

    loadBilling();

    if (campaignId) {
      loadMetaCampaignDraft(campaignId);
      return;
    }

    if (params.get('new') === '1') {
      applyNewCampaignDraft();
    }
  }, []);

  function openPlanImport() {
    planImportInputRef.current?.click();
  }

  async function importPlanJson(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text());
      const importedPlan = parsed.plan ?? parsed;

      if (!importedPlan?.campaign || !Array.isArray(importedPlan.ads) || !Array.isArray(importedPlan.adSets)) {
        throw new Error('Il JSON non sembra un piano campagna valido.');
      }

      const serializedPlan = JSON.stringify(importedPlan);

      if (/EA[A-Za-z0-9]{20,}/.test(serializedPlan) || serializedPlan.includes('META_ACCESS_TOKEN')) {
        throw new Error('Il JSON sembra contenere un token o un segreto: import bloccato.');
      }

      const nextPlan = makeEditablePlan(importedPlan, `Piano importato da ${file.name}: serve nuova approvazione fisica.`);
      applyPlanDraft(nextPlan, 'JSON caricato', `${file.name} importato nella dashboard. Premi Salva per renderlo permanente.`);
    } catch (error) {
      addActivity('Import JSON fallito', error.message, 'warn');
    } finally {
      event.target.value = '';
    }
  }

  async function reloadPlan() {
    try {
      const response = await fetch('/api/meta-dashboard/plan');
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.errors?.join(' ') || 'Impossibile ricaricare il piano.');
      }

      setPlan(clonePlan(payload.plan));
      setMediaItems(payload.plan.mediaAssets ?? []);
      setLastSavedSignature(JSON.stringify(payload.plan));
      setSaveState('idle');
      setSelectedAdIndex(0);
      setSelectedMediaId(payload.plan.ads?.[0]?.mediaAssetId ?? payload.plan.mediaAssets?.[0]?.id ?? null);
      addActivity('Piano ricaricato', 'Dati letti dallo storage dashboard', 'ok');
    } catch (error) {
      addActivity('Ricarica fallita', error.message, 'warn');
    }
  }

  async function savePlan() {
    setSaveState('saving');

    try {
      const response = await fetch('/api/meta-dashboard/plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(plan),
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.errors?.join(' ') || 'Impossibile salvare il piano.');
      }

      const savedPlan = clonePlan(payload.plan);
      setPlan(savedPlan);
      setMediaItems(payload.plan.mediaAssets ?? []);
      setLastSavedSignature(JSON.stringify(savedPlan));
      setSaveState('saved');
      addActivity('Piano salvato', 'File dry-run aggiornato con controlli policy', 'ok');
    } catch (error) {
      setSaveState('error');
      addActivity('Salvataggio fallito', error.message, 'warn');
    }
  }

  async function runHealthCheck() {
    try {
      const response = await fetch('/api/meta-dashboard/healthcheck', { method: 'POST' });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || payload.mismatches?.join(' ') || 'Health check non riuscito.');
      }

      addActivity('Health check ok', `${payload.account.name}, ${payload.account.currency}, ${payload.account.timezone}`, 'ok');
    } catch (error) {
      addActivity('Health check fallito', error.message, 'warn');
    }
  }

  async function runPlanAction(action) {
    try {
      const response = await fetch('/api/meta-dashboard/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.errors?.join(' ') || 'Azione non riuscita.');
      }

      setPlan(clonePlan(payload.plan));
      setMediaItems(payload.plan.mediaAssets ?? []);
      setLastSavedSignature(JSON.stringify(payload.plan));

      if (action === 'control') {
        const health = payload.healthcheck?.ok ? 'Meta ok' : 'Meta da verificare';
        addActivity('Controllo completato', `${health}; validazione ${payload.validation?.ready ? 'pronta' : 'incompleta'}`, payload.validation?.ready && payload.healthcheck?.ok ? 'ok' : 'warn');
      } else if (action === 'pause') {
        addActivity('Piano in pausa', 'Campagna, pubblico e annunci impostati su PAUSED', 'ok');
      } else if (action === 'request_start') {
        addActivity('Avvio richiesto', 'Pronto per creare una bozza Meta in PAUSED', 'ok');
      }
    } catch (error) {
      addActivity('Azione bloccata', error.message, 'warn');
    }
  }

  async function createMetaDraft() {
    const confirmed = window.confirm(
      'Creare ora su Meta la campagna, il pubblico e gli annunci? Tutti gli elementi verranno creati in PAUSA e non potranno spendere.',
    );

    if (!confirmed) return;
    setIsCreatingMetaDraft(true);

    try {
      const response = await fetch('/api/meta-dashboard/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_meta_draft' }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        if (payload.plan) {
          setPlan(clonePlan(payload.plan));
          setMediaItems(payload.plan.mediaAssets ?? []);
        }
        throw new Error(payload.errors?.join(' ') || 'Creazione della bozza Meta non riuscita.');
      }

      setPlan(clonePlan(payload.plan));
      setMediaItems(payload.plan.mediaAssets ?? []);
      setLastSavedSignature(JSON.stringify(payload.plan));
      addActivity('Bozza Meta creata', `Campagna ${payload.metaDraft.campaignId}, tutti gli elementi in pausa`, 'ok');
    } catch (error) {
      addActivity('Creazione Meta interrotta', `${error.message} Puoi riprovare senza duplicare gli elementi gia salvati.`, 'warn');
    } finally {
      setIsCreatingMetaDraft(false);
    }
  }

  async function approvePlan() {
    try {
      const response = await fetch('/api/meta-dashboard/approve', { method: 'POST' });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.errors?.join(' ') || 'Approvazione non riuscita.');
      }

      setPlan(clonePlan(payload.plan));
      setMediaItems(payload.plan.mediaAssets ?? []);
      setLastSavedSignature(JSON.stringify(payload.plan));
      addActivity('Piano approvato', 'Approvazione fisica salvata nel dry-run', 'ok');
    } catch (error) {
      addActivity('Approvazione bloccata', error.message, 'warn');
    }
  }

  async function handleMediaUpload(event) {
    const files = Array.from(event.target.files ?? []);

    if (files.length === 0) {
      return;
    }

    setIsUploading(true);

    try {
      const registeredAssets = [];
      let nextPlan = plan;

      for (const file of files) {
        const extension = safeExtension(file.name, file.type);

        if (!extension) {
          throw new Error(`Estensione non consentita: ${file.name}.`);
        }

        const id = crypto.randomUUID();
        const pathname = `dashboard/media/${id}${extension}`;
        const blob = await upload(pathname, file, {
          access: 'private',
          handleUploadUrl: '/api/meta-dashboard/media/client-upload',
          contentType: file.type,
          multipart: file.size > 4 * 1024 * 1024,
          clientPayload: JSON.stringify({
            id,
            originalName: file.name,
            size: file.size,
            mimeType: file.type,
            extension,
          }),
        });
        const asset = {
          id,
          originalName: file.name,
          storedPath: blob.pathname,
          extension,
          size: file.size,
          mimeType: file.type,
          uploadedAt: new Date().toISOString(),
          status: 'uploaded',
          storage: 'blob',
          url: blob.url,
        };
        const response = await fetch('/api/meta-dashboard/media/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ asset }),
        });
        const payload = await response.json();

        if (!response.ok || !payload.ok) {
          throw new Error(payload.errors?.join(' ') || 'Registrazione media non riuscita.');
        }

        registeredAssets.push(payload.asset);
        nextPlan = payload.plan;
      }

      if (registeredAssets[0]) {
        const syncedPlan = clonePlan(nextPlan);
        syncedPlan.ads = syncedPlan.ads.map((ad, index) =>
          index === selectedAdIndex ? { ...ad, mediaAssetId: registeredAssets[0].id } : ad,
        );
        setPlan(syncedPlan);
        setMediaItems(syncedPlan.mediaAssets ?? []);
        setSelectedMediaId(registeredAssets[0].id);
      } else {
        setPlan(clonePlan(nextPlan));
        setMediaItems(nextPlan.mediaAssets ?? []);
      }
      addActivity('Media salvati', `${registeredAssets.length} file caricati nella libreria`, 'ok');
    } catch (error) {
      addActivity('Upload fallito', error.message, 'warn');
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  }

  async function deleteMedia(asset) {
    const isSelectedByAds = plan.ads.some((ad) => ad.mediaAssetId === asset.id);
    const message = isSelectedByAds
      ? `Cancellare "${asset.originalName}" e rimuoverlo dagli annunci che lo usano?`
      : `Cancellare "${asset.originalName}" dalla libreria?`;

    if (!window.confirm(message)) {
      return;
    }

    try {
      const response = await fetch(`/api/meta-dashboard/media/${asset.id}`, { method: 'DELETE' });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.errors?.join(' ') || 'Cancellazione media non riuscita.');
      }

      const nextPlan = clonePlan(payload.plan);
      const nextMediaItems = nextPlan.mediaAssets ?? [];

      setPlan(nextPlan);
      setMediaItems(nextMediaItems);
      setSelectedMediaId((current) => (current === asset.id ? nextMediaItems[0]?.id ?? null : current));
      addActivity('Media cancellato', asset.originalName, 'ok');
    } catch (error) {
      addActivity('Cancellazione bloccata', error.message, 'warn');
    }
  }

  function exportPlan() {
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'natango-meta-campaign-plan-edited.json';
    link.click();
    URL.revokeObjectURL(url);
    addActivity('Piano esportato', 'JSON scaricato dal browser', 'ok');
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-topbar">
        <a href="/" className="brand">
          <img src="/wp-content/uploads/2025/11/logo-natango-no-sf.png" alt="Natango" />
          <span>Natango Ads</span>
        </a>
        <div className="topbar-actions">
          <a href="/meta-campaigns" className="secondary-button">
            <i className="fas fa-chart-line" aria-hidden="true"></i>
            Campagne
          </a>
          <button type="button" className="secondary-button" onClick={startNewCampaign}>
            <i className="fas fa-file-circle-plus" aria-hidden="true"></i>
            Nuova campagna
          </button>
          <button type="button" className="secondary-button" onClick={openPlanImport}>
            <i className="fas fa-file-import" aria-hidden="true"></i>
            Carica JSON
          </button>
          <input ref={planImportInputRef} type="file" accept="application/json,.json" hidden onChange={importPlanJson} />
          <form method="post" action="/api/meta-auth/logout">
            <button type="submit" className="icon-button" title="Esci">
              <i className="fas fa-right-from-bracket" aria-hidden="true"></i>
            </button>
          </form>
          <button type="button" className="icon-button" title="Ricarica piano" onClick={reloadPlan}>
            <i className="fas fa-rotate-left" aria-hidden="true"></i>
          </button>
          <button type="button" className="icon-button" title="Controllo salute" onClick={runHealthCheck}>
            <i className="fas fa-heart-pulse" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            className={`secondary-button save-button ${saveState === 'saved' && !isDirty ? 'saved' : ''} ${saveState === 'error' ? 'error' : ''}`}
            onClick={savePlan}
            disabled={saveState === 'saving'}
            aria-live="polite"
          >
            <i
              className={`fas ${saveState === 'saving' ? 'fa-circle-notch fa-spin' : saveState === 'saved' && !isDirty ? 'fa-check' : 'fa-floppy-disk'}`}
              aria-hidden="true"
            ></i>
            {saveState === 'saving'
              ? 'Salvataggio...'
              : saveState === 'error'
                ? 'Riprova'
                : saveState === 'saved' && !isDirty
                  ? 'Salvato'
                  : isDirty
                    ? 'Salva modifiche'
                    : 'Salva'}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={approvePlan}
            disabled={!validation.ready || isApproved || isDirty || saveState === 'saving'}
            title={isDirty ? 'Salva le modifiche prima di approvare il piano' : 'Approva fisicamente il piano salvato'}
          >
            <i className="fas fa-stamp" aria-hidden="true"></i>
            {isApproved ? 'Approvato' : 'Approva'}
          </button>
          <button type="button" className="secondary-button" onClick={exportPlan}>
            <i className="fas fa-download" aria-hidden="true"></i>
            Esporta
          </button>
        </div>
      </header>

      <section className="status-strip" aria-label="Stato campagna">
        <div>
          <span>Account</span>
          <strong>{plan.account.name}</strong>
          <small>{plan.account.id}</small>
        </div>
        <div>
          <span>Modalita</span>
          <strong>{plan.dryRun ? 'Dry run' : 'Operativa'}</strong>
          <small>{plan.writeCallsAllowed ? 'Scritture abilitate' : 'Scritture bloccate'}</small>
        </div>
        <div>
          <span>Budget giornaliero</span>
          <strong>{formatCurrency(plan.campaign.dailyBudgetEur)} / giorno</strong>
          <small>Tetto {formatCurrency(budgetLimit)}</small>
        </div>
        <div>
          <span>Tetto campagna</span>
          <strong>{formatCurrency(campaignBudgetLimit)}</strong>
          <small>Totale massimo periodo campagna</small>
        </div>
        <div>
          <span>Sicurezza</span>
          <strong>{isApproved ? 'Approvato' : `${safetyScore}/5`}</strong>
          <small>{isApproved ? 'Conferma fisica salvata' : allPaused ? 'Tutto in pausa' : 'Richiede controllo'}</small>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="panel campaign-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Campagna</span>
              <h1>{plan.campaign.name}</h1>
            </div>
            <span className={`pill ${budgetWithinPolicy && allPaused ? 'ok' : 'warn'}`}>
              {budgetWithinPolicy && allPaused ? 'Pronta' : 'Da verificare'}
            </span>
          </div>

          <label>
            Nome campagna
            <input value={plan.campaign.name} onChange={(event) => updateCampaign('name', event.target.value)} />
          </label>

          <div className="field-row">
            <label>
              Obiettivo
              <select value={plan.campaign.objective} onChange={(event) => updateCampaign('objective', event.target.value)}>
                <option value="OUTCOME_LEADS">Lead</option>
                <option value="OUTCOME_TRAFFIC">Traffico</option>
                <option value="OUTCOME_ENGAGEMENT">Interazione</option>
              </select>
            </label>
            <label>
              Stato
              <select value={plan.campaign.status} onChange={(event) => updateCampaign('status', event.target.value)}>
                <option value="PAUSED">Pausa</option>
                <option value="DRAFT">Bozza</option>
              </select>
            </label>
          </div>

          <div className="budget-control compact-budget-control">
            <div className="budget-control-header">
              <label htmlFor="campaign-duration">Durata campagna</label>
              <span className="pill">1-90 giorni</span>
            </div>
            <div className="budget-input-row">
              <button type="button" className="icon-button" onClick={() => updateCampaign('durationDays', clampDurationDays(plan.campaign.durationDays - 1))} title="Riduci durata">
                <i className="fas fa-minus" aria-hidden="true"></i>
              </button>
              <div className="budget-input-wrap">
                <span>Giorni</span>
                <input
                  id="campaign-duration"
                  type="number"
                  min="1"
                  max="90"
                  step="1"
                  value={plan.campaign.durationDays ?? 10}
                  onChange={(event) => updateCampaign('durationDays', clampDurationDays(event.target.value))}
                  onBlur={(event) => updateCampaign('durationDays', clampDurationDays(event.target.value))}
                />
              </div>
              <button type="button" className="icon-button" onClick={() => updateCampaign('durationDays', clampDurationDays((plan.campaign.durationDays ?? 10) + 1))} title="Aumenta durata">
                <i className="fas fa-plus" aria-hidden="true"></i>
              </button>
            </div>
            <div className="budget-footnote">
              <strong>{plan.campaign.durationDays ?? 10} giorni</strong>
              <span>Serve per pianificare il tetto complessivo della campagna.</span>
            </div>
          </div>

          <div className="budget-control">
            <div className="budget-control-header">
              <label htmlFor="daily-budget">Budget giornaliero</label>
              <span className={`pill ${budgetWithinPolicy ? 'ok' : 'warn'}`}>Max {formatCurrency(budgetLimit)}</span>
            </div>
            <div className="budget-input-row">
              <button type="button" className="icon-button" onClick={() => updateBudget(plan.campaign.dailyBudgetEur - 1)} title="Riduci budget">
                <i className="fas fa-minus" aria-hidden="true"></i>
              </button>
              <div className="budget-input-wrap">
                <span>EUR</span>
                <input
                  id="daily-budget"
                  type="number"
                  min="1"
                  max={budgetLimit}
                  step="1"
                  value={plan.campaign.dailyBudgetEur}
                  onChange={(event) => updateBudget(event.target.value)}
                  onBlur={(event) => updateBudget(event.target.value)}
                />
              </div>
              <button type="button" className="icon-button" onClick={() => updateBudget(plan.campaign.dailyBudgetEur + 1)} title="Aumenta budget">
                <i className="fas fa-plus" aria-hidden="true"></i>
              </button>
            </div>
            <input
              aria-label="Budget giornaliero slider"
              type="range"
              min="1"
              max={budgetLimit}
              step="1"
              value={plan.campaign.dailyBudgetEur}
              onChange={(event) => updateBudget(event.target.value)}
            />
            <div className="budget-footnote">
              <strong>{formatCurrency(plan.campaign.dailyBudgetEur)} / giorno</strong>
              <span>{budgetWithinPolicy ? 'Dentro le regole di sicurezza' : 'Sopra il limite consentito'}</span>
            </div>
          </div>

          <div className="budget-control budget-limit-control">
            <div className="budget-control-header">
              <label htmlFor="campaign-budget-limit">Tetto totale campagna</label>
              <span className="pill warn">Limite assoluto {formatCurrency(absoluteCampaignBudgetLimit)}</span>
            </div>
            <div className="budget-input-row">
              <button
                type="button"
                className="icon-button"
                onClick={() => updateCampaignBudgetLimit(campaignBudgetLimit - 10)}
                title="Riduci tetto campagna"
              >
                <i className="fas fa-minus" aria-hidden="true"></i>
              </button>
              <div className="budget-input-wrap">
                <span>EUR</span>
                <input
                  id="campaign-budget-limit"
                  type="number"
                  min="1"
                  max={absoluteCampaignBudgetLimit}
                  step="10"
                  value={campaignBudgetLimit}
                  onChange={(event) => updateCampaignBudgetLimit(event.target.value)}
                  onBlur={(event) => updateCampaignBudgetLimit(event.target.value)}
                />
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => updateCampaignBudgetLimit(campaignBudgetLimit + 10)}
                title="Aumenta tetto campagna"
              >
                <i className="fas fa-plus" aria-hidden="true"></i>
              </button>
            </div>
            <input
              aria-label="Tetto totale campagna slider"
              type="range"
              min="10"
              max={absoluteCampaignBudgetLimit}
              step="10"
              value={campaignBudgetLimit}
              onChange={(event) => updateCampaignBudgetLimit(event.target.value)}
            />
            <div className="budget-footnote">
              <strong>Totale {formatCurrency(campaignBudgetLimit)}</strong>
              <span>Limite complessivo previsto per tutti i giorni della campagna.</span>
            </div>
          </div>

          <div className="command-row">
            <button
              type="button"
              className="primary-button"
              onClick={() => runPlanAction('request_start')}
              disabled={!validation.ready || !isApproved}
              title={!isApproved ? 'Serve approvazione fisica prima della richiesta avvio' : 'Richiedi creazione bozza Meta'}
            >
              <i className="fas fa-play" aria-hidden="true"></i>
              Avvio
            </button>
            <button type="button" className="secondary-button" onClick={() => runPlanAction('pause')}>
              <i className="fas fa-pause" aria-hidden="true"></i>
              Pausa
            </button>
            <button type="button" className="secondary-button" onClick={() => runPlanAction('control')}>
              <i className="fas fa-rotate" aria-hidden="true"></i>
              Controllo
            </button>
            {plan.startRequest?.status === 'ready_for_meta_draft_creation' || plan.metaDraft ? (
              <button
                type="button"
                className="primary-button"
                onClick={createMetaDraft}
                disabled={isCreatingMetaDraft || plan.metaDraft?.status === 'completed_paused'}
                title="Crea su Meta senza attivare la campagna"
              >
                <i className={`fas ${isCreatingMetaDraft ? 'fa-circle-notch fa-spin' : 'fa-cloud-arrow-up'}`} aria-hidden="true"></i>
                {isCreatingMetaDraft
                  ? 'Creazione...'
                  : plan.metaDraft?.status === 'completed_paused'
                    ? 'Bozza Meta creata'
                    : plan.metaDraft?.status === 'error_paused'
                      ? 'Riprendi creazione'
                      : 'Crea bozza Meta'}
              </button>
            ) : null}
          </div>
          {plan.metaDraft?.campaignId ? (
            <div className={`approval-note ${plan.metaDraft.status === 'error_paused' ? 'warn-note' : ''}`}>
              <i className="fas fa-lock" aria-hidden="true"></i>
              <span>
                Campagna Meta {plan.metaDraft.campaignId}: {plan.metaDraft.status === 'completed_paused' ? 'creata e in pausa' : 'creazione parziale in pausa'}.
              </span>
            </div>
          ) : null}
        </div>

        <div className="panel">
          <div className="panel-heading compact">
            <div>
              <span className="eyebrow">Creativita</span>
              <h2>Testi annunci</h2>
            </div>
            <div className="segmented">
              {plan.ads.map((ad, index) => (
                <button
                  key={ad.name}
                  type="button"
                  className={selectedAdIndex === index ? 'active' : ''}
                  onClick={() => selectAd(index)}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          </div>

          <label>
            Nome annuncio
            <input value={selectedAd.name} onChange={(event) => updateAd('name', event.target.value)} />
          </label>
          <label>
            Testo principale
            <textarea rows="6" value={selectedAd.primaryText} onChange={(event) => updateAd('primaryText', event.target.value)} />
          </label>
          <label>
            Titolo
            <input value={selectedAd.headline} onChange={(event) => updateAd('headline', event.target.value)} />
          </label>
          <label>
            Call to action
            <select value={selectedAd.callToAction} onChange={(event) => updateAd('callToAction', event.target.value)}>
              <option value="LEARN_MORE">Scopri di piu</option>
              <option value="CONTACT_US">Contattaci</option>
              <option value="SIGN_UP">Iscriviti</option>
            </select>
          </label>
        </div>

        <div className="panel">
          <div className="panel-heading compact">
            <div>
              <span className="eyebrow">Media</span>
              <h2>Libreria asset</h2>
            </div>
            <div className="media-toolbar">
              <button type="button" className="secondary-button compact-control" onClick={() => setIsMediaLibraryOpen(true)}>
                <i className="fas fa-photo-film" aria-hidden="true"></i>
                Libreria
              </button>
              <label className="upload-button compact-control">
                <i className="fas fa-upload" aria-hidden="true"></i>
                {isUploading ? 'Salvo...' : 'Carica'}
                <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple onChange={handleMediaUpload} />
              </label>
            </div>
          </div>

          {selectedMedia ? (
            <div className="media-preview">
              {selectedMedia.mimeType?.startsWith('image/') ? (
                <img src={mediaUrl(selectedMedia)} alt={selectedMedia.originalName} />
              ) : (
                <video src={mediaUrl(selectedMedia)} preload="metadata" muted controls playsInline />
              )}
              <div>
                <strong>{selectedMedia.originalName}</strong>
                <span>Scelto per annuncio {selectedAdIndex + 1}</span>
                <a href={mediaUrl(selectedMedia)} target="_blank" rel="noreferrer">
                  <i className="fas fa-up-right-from-square" aria-hidden="true"></i>
                  Apri
                </a>
              </div>
            </div>
          ) : (
            <button type="button" className="empty-media empty-media-button" onClick={() => setIsMediaLibraryOpen(true)}>
              <i className="fas fa-photo-film" aria-hidden="true"></i>
              <strong>Nessun media scelto</strong>
              <span>Apri la libreria per scegliere un asset già caricato.</span>
            </button>
          )}
        </div>

        <div className="panel">
          <div className="panel-heading compact">
            <div>
              <span className="eyebrow">Pubblico</span>
              <h2>{plan.adSets[0].name}</h2>
            </div>
            <span className="pill ok">{plan.adSets[0].status}</span>
          </div>
          <dl className="metric-list">
            <div>
              <dt>Area</dt>
              <dd>{plan.adSets[0].targetingDraft.geoLocations.cities.join(', ')}</dd>
            </div>
            <div>
              <dt>Eta</dt>
              <dd>
                {plan.adSets[0].targetingDraft.ageMin}-{plan.adSets[0].targetingDraft.ageMax}
              </dd>
            </div>
            <div>
              <dt>Placements</dt>
              <dd>{plan.adSets[0].targetingDraft.placements.length}</dd>
            </div>
            <div>
              <dt>Orario corso</dt>
              <dd>{plan.adSets[0].scheduleReference}</dd>
            </div>
          </dl>
        </div>

        <div className="panel">
          <div className="panel-heading compact">
            <div>
              <span className="eyebrow">Tracking</span>
              <h2>Pixel e lead</h2>
            </div>
            <span className="pill ok">Attivo</span>
          </div>
          <dl className="metric-list">
            <div>
              <dt>Pixel</dt>
              <dd>{plan.tracking?.pixelName ?? policy.tracking?.pixelName}</dd>
            </div>
            <div>
              <dt>ID</dt>
              <dd>{plan.tracking?.pixelId ?? policy.tracking?.pixelId}</dd>
            </div>
            <div>
              <dt>Eventi</dt>
              <dd>{(plan.tracking?.activeEvents ?? policy.tracking?.events ?? []).join(', ')}</dd>
            </div>
          </dl>
          <label>
            Percorso lead preferito
            <select
              value={plan.tracking?.preferredLeadPath ?? 'website_lead_form'}
              onChange={(event) => updateTracking('preferredLeadPath', event.target.value)}
            >
              <option value="website_lead_form">Sito Natango + Pixel Lead</option>
              <option value="meta_instant_form">Modulo istantaneo Meta</option>
              <option value="ab_test">Test A/B sito vs modulo Meta</option>
            </select>
          </label>
        </div>

        <div className="panel">
          <div className="panel-heading compact">
            <div>
              <span className="eyebrow">Registro</span>
              <h2>Attivita</h2>
            </div>
          </div>
          <ol className="activity-list">
            {activity.map((item, index) => (
              <li key={`${item.label}-${index}`} className={item.tone}>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="panel">
          <div className="panel-heading compact">
            <div>
              <span className="eyebrow">Fatturazione</span>
              <h2>Chi paga</h2>
            </div>
            <button type="button" className="icon-button" onClick={loadBilling} disabled={isBillingLoading} title="Ricarica fatturazione">
              <i className={`fas ${isBillingLoading ? 'fa-circle-notch fa-spin' : 'fa-rotate'}`} aria-hidden="true"></i>
            </button>
          </div>
          <dl className="metric-list billing-list">
            <div>
              <dt>Account</dt>
              <dd>{billing?.account?.name ?? plan.account.name}</dd>
            </div>
            <div>
              <dt>Valuta</dt>
              <dd>{billing?.account?.currency ?? plan.account.currency}</dd>
            </div>
            <div>
              <dt>Business</dt>
              <dd>{billing?.account?.businessName ?? 'Verifica in Meta'}</dd>
            </div>
            <div>
              <dt>Metodo</dt>
              <dd>{billing?.billing?.fundingSourcePresent ? billing.billing.fundingSourceLabel : 'Verifica in Meta'}</dd>
            </div>
            <div>
              <dt>Spesa account</dt>
              <dd>{formatMoneyDetail(billing?.billing?.amountSpentEur)}</dd>
            </div>
            <div>
              <dt>Limite account</dt>
              <dd>{formatSpendCap(billing?.billing?.spendCapEur)}</dd>
            </div>
          </dl>
          {billingError ? (
            <div className="approval-note warn-note">
              <i className="fas fa-triangle-exclamation" aria-hidden="true"></i>
              <span>{billingError}</span>
            </div>
          ) : null}
          <a className="billing-link" href={billing?.billing?.billingUrl ?? 'https://business.facebook.com/billing_hub/'} target="_blank" rel="noreferrer">
            <i className="fas fa-arrow-up-right-from-square" aria-hidden="true"></i>
            Apri fatturazione Meta
          </a>
        </div>

        <div className="panel validation-panel">
          <div className="panel-heading compact">
            <div>
              <span className="eyebrow">Validazione</span>
              <h2>Piano campagna</h2>
            </div>
            <span className={`pill ${validation.ready ? 'ok' : 'warn'}`}>
              {isApproved ? 'Approvato' : validation.ready ? 'Pronto' : 'Incompleto'}
            </span>
          </div>
          <ul className="validation-list">
            {validation.checks.map((check) => (
              <li key={check.label} className={check.ok ? 'ok' : 'warn'}>
                <i className={`fas ${check.ok ? 'fa-check' : 'fa-triangle-exclamation'}`} aria-hidden="true"></i>
                <div>
                  <strong>{check.label}</strong>
                  <span>{check.detail}</span>
                </div>
              </li>
            ))}
          </ul>
          {isApproved && (
            <div className="approval-note">
              <i className="fas fa-lock" aria-hidden="true"></i>
              <span>Approvato il {new Date(plan.approval.approvedAt).toLocaleString('it-IT')}. Non autorizza pubblicazione automatica su Meta.</span>
            </div>
          )}
        </div>
      </section>

      {isMediaLibraryOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setIsMediaLibraryOpen(false)}>
          <section className="media-modal" role="dialog" aria-modal="true" aria-labelledby="media-library-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="eyebrow">Libreria asset</span>
                <h2 id="media-library-title">Scegli media per annuncio {selectedAdIndex + 1}</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setIsMediaLibraryOpen(false)} title="Chiudi libreria">
                <i className="fas fa-xmark" aria-hidden="true"></i>
              </button>
            </div>

            <div className="modal-actions">
              <label className="upload-button">
                <i className="fas fa-upload" aria-hidden="true"></i>
                {isUploading ? 'Salvo...' : 'Carica media'}
                <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple onChange={handleMediaUpload} />
              </label>
              <span>{mediaItems.length} asset disponibili</span>
            </div>

            <div className="media-grid media-grid-modal">
              {mediaItems.length === 0 ? (
                <div className="empty-media">
                  <i className="fas fa-photo-film" aria-hidden="true"></i>
                  <strong>Nessun media caricato</strong>
                  <span>Carica immagini o video per poterli associare agli annunci.</span>
                </div>
              ) : (
                mediaItems.map((item) => (
                  <article key={item.id} className={`media-card ${selectedMediaId === item.id ? 'active' : ''}`}>
                    <button type="button" className="media-thumb" onClick={() => selectMedia(item)} title="Scegli media">
                      {item.mimeType?.startsWith('image/') ? (
                        <img src={mediaUrl(item)} alt={item.originalName} />
                      ) : (
                        <span className="video-thumb">
                          <video src={mediaUrl(item)} preload="metadata" muted playsInline />
                          <i className="fas fa-play" aria-hidden="true"></i>
                        </span>
                      )}
                    </button>
                    <div className="media-meta">
                      <strong title={item.originalName}>{item.originalName}</strong>
                      <span>{Math.round((item.size ?? 0) / 1024)} KB</span>
                    </div>
                    <div className="media-actions">
                      <button type="button" className="icon-button" onClick={() => selectMedia(item)} title="Usa per annuncio">
                        <i className="fas fa-check" aria-hidden="true"></i>
                      </button>
                      <a className="icon-button" href={mediaUrl(item)} target="_blank" rel="noreferrer" title="Apri media">
                        <i className="fas fa-up-right-from-square" aria-hidden="true"></i>
                      </a>
                      <button type="button" className="icon-button danger" onClick={() => deleteMedia(item)} title="Cancella media">
                        <i className="fas fa-trash" aria-hidden="true"></i>
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
