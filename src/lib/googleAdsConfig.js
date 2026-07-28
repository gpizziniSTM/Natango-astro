import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const GOOGLE_ADS_API_VERSION = 'v24';
export const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function readEnvFile(path) {
  if (!path || !existsSync(path)) return {};

  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return index === -1 ? [line, ''] : [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

export function getGoogleAdsEnv() {
  const astroEnv = import.meta.env || {};
  const runtimeEnv = process.env || {};
  const privateEnvPath =
    astroEnv.GOOGLE_ADS_ENV_PATH ||
    runtimeEnv.GOOGLE_ADS_ENV_PATH ||
    join(homedir(), '.config', 'natango', 'google-ads.env');
  const privateEnv = readEnvFile(privateEnvPath);

  return {
    developerToken:
      astroEnv.GOOGLE_ADS_DEVELOPER_TOKEN ||
      runtimeEnv.GOOGLE_ADS_DEVELOPER_TOKEN ||
      privateEnv.GOOGLE_ADS_DEVELOPER_TOKEN,
    customerId: digits(
      astroEnv.GOOGLE_ADS_CUSTOMER_ID || runtimeEnv.GOOGLE_ADS_CUSTOMER_ID || privateEnv.GOOGLE_ADS_CUSTOMER_ID,
    ),
    loginCustomerId: digits(
      astroEnv.GOOGLE_ADS_LOGIN_CUSTOMER_ID ||
        runtimeEnv.GOOGLE_ADS_LOGIN_CUSTOMER_ID ||
        privateEnv.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    ),
    serviceAccountJson:
      astroEnv.GOOGLE_ADS_SERVICE_ACCOUNT_JSON ||
      runtimeEnv.GOOGLE_ADS_SERVICE_ACCOUNT_JSON ||
      privateEnv.GOOGLE_ADS_SERVICE_ACCOUNT_JSON,
    privateEnvPath,
  };
}

function readServiceAccount(path) {
  if (!path || !existsSync(path)) {
    throw new Error('File del service account Google Ads non trovato.');
  }

  const credentials = JSON.parse(readFileSync(path, 'utf8'));

  if (credentials.type !== 'service_account' || !credentials.client_email || !credentials.private_key) {
    throw new Error('Credenziali service account Google Ads non valide.');
  }

  return credentials;
}

async function getServiceAccountAccessToken(credentials) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({
    alg: 'RS256',
    typ: 'JWT',
    ...(credentials.private_key_id ? { kid: credentials.private_key_id } : {}),
  }));
  const claims = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: GOOGLE_ADS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsignedAssertion = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedAssertion);
  signer.end();
  const assertion = `${unsignedAssertion}.${signer.sign(credentials.private_key, 'base64url')}`;
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const response = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', body });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.access_token) {
    throw new Error(`Autenticazione Google non riuscita (${payload.error || response.status}).`);
  }

  return payload.access_token;
}

async function googleAdsRequest(path, { accessToken, developerToken, loginCustomerId, method = 'GET', body }) {
  const response = await fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': developerToken,
      ...(loginCustomerId ? { 'login-customer-id': loginCustomerId } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const googleAdsFailure = payload.error?.details?.find?.((detail) => Array.isArray(detail.errors));
    const firstGoogleAdsError = googleAdsFailure?.errors?.[0];
    const fieldPath = firstGoogleAdsError?.location?.fieldPathElements
      ?.map((item) => item.fieldName)
      .filter(Boolean)
      .join('.');
    const message = firstGoogleAdsError?.message || payload.error?.message || `HTTP ${response.status}`;
    const requestId = response.headers.get('request-id') || response.headers.get('google-ads-request-id');
    throw new Error(`Google Ads API: ${message}${fieldPath ? ` [campo ${fieldPath}]` : ''}${requestId ? ` [request ${requestId}]` : ''}`);
  }

  return payload;
}

export async function runGoogleAdsHealthCheck() {
  const env = getGoogleAdsEnv();
  const missing = [
    ['developer token', env.developerToken],
    ['customer ID', env.customerId],
    ['login customer ID', env.loginCustomerId],
    ['service account JSON', env.serviceAccountJson],
  ].filter(([, value]) => !value).map(([label]) => label);

  if (missing.length > 0) {
    return { ok: false, error: `Configurazione mancante: ${missing.join(', ')}.` };
  }

  try {
    const credentials = readServiceAccount(env.serviceAccountJson);
    const accessToken = await getServiceAccountAccessToken(credentials);
    const accessible = await googleAdsRequest('customers:listAccessibleCustomers', {
      accessToken,
      developerToken: env.developerToken,
    });
    const hierarchyResponse = await googleAdsRequest(`customers/${env.loginCustomerId}/googleAds:search`, {
      accessToken,
      developerToken: env.developerToken,
      loginCustomerId: env.loginCustomerId,
      method: 'POST',
      body: {
        query: [
          'SELECT',
          'customer_client.id,',
          'customer_client.descriptive_name,',
          'customer_client.level,',
          'customer_client.manager,',
          'customer_client.status',
          'FROM customer_client',
          'WHERE customer_client.level <= 1',
        ].join(' '),
      },
    });
    const hierarchy = (hierarchyResponse.results || []).map(({ customerClient }) => ({
      id: String(customerClient.id),
      name: customerClient.descriptiveName,
      level: Number(customerClient.level),
      manager: customerClient.manager,
      status: customerClient.status,
    }));
    const targetLinkedToManager = hierarchy.some((item) => item.id === env.customerId);

    if (!targetLinkedToManager) {
      return {
        ok: false,
        error: 'L account Natango non risulta collegato direttamente al manager Google Ads configurato.',
        apiVersion: GOOGLE_ADS_API_VERSION,
        accessMode: 'read_only_healthcheck',
        manager: {
          id: env.loginCustomerId,
          directlyAccessible: (accessible.resourceNames || []).includes(`customers/${env.loginCustomerId}`),
        },
        hierarchy,
        safety: {
          writeCallsMade: false,
          secretsIncluded: false,
          credentialsSource: 'private_file_outside_repository',
        },
      };
    }
    const accountResponse = await googleAdsRequest(`customers/${env.customerId}/googleAds:search`, {
      accessToken,
      developerToken: env.developerToken,
      loginCustomerId: env.loginCustomerId,
      method: 'POST',
      body: {
        query: [
          'SELECT',
          'customer.id,',
          'customer.descriptive_name,',
          'customer.currency_code,',
          'customer.time_zone,',
          'customer.manager,',
          'customer.test_account,',
          'customer.status',
          'FROM customer',
          'LIMIT 1',
        ].join(' '),
      },
    });
    const customer = accountResponse.results?.[0]?.customer;

    if (!customer) {
      return { ok: false, error: 'Lettura account Natango riuscita ma senza dati account.' };
    }

    const directlyAccessible = accessible.resourceNames || [];
    const managerResource = `customers/${env.loginCustomerId}`;
    const checks = {
      managerDirectlyAccessible: directlyAccessible.includes(managerResource),
      targetCustomerMatches: String(customer.id) === env.customerId,
      targetIsNotManager: customer.manager === false,
      targetIsNotTestAccount: customer.testAccount === false,
    };

    return {
      ok: Object.values(checks).every(Boolean),
      apiVersion: GOOGLE_ADS_API_VERSION,
      accessMode: 'read_only_healthcheck',
      account: {
        id: String(customer.id),
        name: customer.descriptiveName,
        currency: customer.currencyCode,
        timezone: customer.timeZone,
        status: customer.status,
      },
      manager: {
        id: env.loginCustomerId,
        directlyAccessible: checks.managerDirectlyAccessible,
        targetLinked: targetLinkedToManager,
      },
      checks,
      safety: {
        writeCallsMade: false,
        secretsIncluded: false,
        credentialsSource: 'private_file_outside_repository',
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Health check Google Ads non riuscito.',
      safety: { writeCallsMade: false, secretsIncluded: false },
    };
  }
}

function extractTrackingCandidate(tagSnippets = []) {
  const snippetText = tagSnippets
    .flatMap((snippet) => [snippet.globalSiteTag, snippet.eventSnippet])
    .filter(Boolean)
    .join('\n');
  const adsId = snippetText.match(/AW-\d+/)?.[0] || null;
  const sendTo = snippetText.match(/AW-\d+\/[A-Za-z0-9_-]+/)?.[0] || null;

  return {
    adsId,
    conversionLabel: sendTo ? sendTo.split('/')[1] : null,
    hasTagSnippet: snippetText.length > 0,
  };
}

export async function runGoogleAdsAccountAudit() {
  const env = getGoogleAdsEnv();
  const missing = [
    ['developer token', env.developerToken],
    ['customer ID', env.customerId],
    ['login customer ID', env.loginCustomerId],
    ['service account JSON', env.serviceAccountJson],
  ].filter(([, value]) => !value).map(([label]) => label);

  if (missing.length > 0) {
    return { ok: false, error: `Configurazione mancante: ${missing.join(', ')}.` };
  }

  try {
    const credentials = readServiceAccount(env.serviceAccountJson);
    const accessToken = await getServiceAccountAccessToken(credentials);
    const requestOptions = {
      accessToken,
      developerToken: env.developerToken,
      loginCustomerId: env.loginCustomerId,
      method: 'POST',
    };
    const [campaignResponse, conversionResponse, trackingResponse] = await Promise.all([
      googleAdsRequest(`customers/${env.customerId}/googleAds:search`, {
        ...requestOptions,
        body: {
          query: [
            'SELECT',
            'campaign.id,',
            'campaign.name,',
            'campaign.status,',
            'campaign.advertising_channel_type,',
            'campaign_budget.amount_micros',
            'FROM campaign',
            'ORDER BY campaign.id',
          ].join(' '),
        },
      }),
      googleAdsRequest(`customers/${env.customerId}/googleAds:search`, {
        ...requestOptions,
        body: {
          query: [
            'SELECT',
            'conversion_action.id,',
            'conversion_action.name,',
            'conversion_action.status,',
            'conversion_action.type,',
            'conversion_action.category,',
            'conversion_action.origin,',
            'conversion_action.primary_for_goal,',
            'conversion_action.include_in_conversions_metric,',
            'conversion_action.tag_snippets',
            'FROM conversion_action',
            'ORDER BY conversion_action.id',
          ].join(' '),
        },
      }),
      googleAdsRequest(`customers/${env.customerId}/googleAds:search`, {
        ...requestOptions,
        body: {
          query: [
            'SELECT',
            'customer.id,',
            'customer.conversion_tracking_setting.conversion_tracking_status,',
            'customer.conversion_tracking_setting.conversion_tracking_id,',
            'customer.conversion_tracking_setting.cross_account_conversion_tracking_id',
            'FROM customer',
            'LIMIT 1',
          ].join(' '),
        },
      }),
    ]);

    const campaigns = (campaignResponse.results || []).map(({ campaign, campaignBudget }) => ({
      id: String(campaign.id),
      name: campaign.name,
      status: campaign.status,
      channelType: campaign.advertisingChannelType,
      dailyBudgetEur: campaignBudget?.amountMicros ? Number(campaignBudget.amountMicros) / 1_000_000 : null,
    }));
    const conversionActions = (conversionResponse.results || []).map(({ conversionAction }) => ({
      id: String(conversionAction.id),
      name: conversionAction.name,
      status: conversionAction.status,
      type: conversionAction.type,
      category: conversionAction.category,
      origin: conversionAction.origin,
      primaryForGoal: conversionAction.primaryForGoal,
      includedInConversions: conversionAction.includeInConversionsMetric,
      tracking: extractTrackingCandidate(conversionAction.tagSnippets),
    }));
    const conversionTracking = trackingResponse.results?.[0]?.customer?.conversionTrackingSetting || {};

    return {
      ok: true,
      apiVersion: GOOGLE_ADS_API_VERSION,
      accessMode: 'read_only_account_audit',
      accountId: env.customerId,
      conversionTracking: {
        status: conversionTracking.conversionTrackingStatus || 'UNKNOWN',
        conversionTrackingId: conversionTracking.conversionTrackingId
          ? String(conversionTracking.conversionTrackingId)
          : null,
        crossAccountConversionTrackingId: conversionTracking.crossAccountConversionTrackingId
          ? String(conversionTracking.crossAccountConversionTrackingId)
          : null,
      },
      campaigns,
      conversionActions,
      safety: {
        writeCallsMade: false,
        secretsIncluded: false,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Audit Google Ads non riuscito.',
      safety: { writeCallsMade: false, secretsIncluded: false },
    };
  }
}

export const GOOGLE_LEAD_CONVERSION_NAME = 'Natango | Lead modulo sito | Settembre 2026';
export const GOOGLE_OUTBOUND_ACTION_IDS_TO_DEMOTE = ['7423246452', '7426032442', '7426066037'];

function buildConversionSetupOperations(customerId) {
  return [
    {
      create: {
        name: GOOGLE_LEAD_CONVERSION_NAME,
        category: 'SUBMIT_LEAD_FORM',
        type: 'WEBPAGE',
        status: 'ENABLED',
        primaryForGoal: true,
        countingType: 'ONE_PER_CLICK',
        clickThroughLookbackWindowDays: 30,
        viewThroughLookbackWindowDays: 1,
      },
    },
    ...GOOGLE_OUTBOUND_ACTION_IDS_TO_DEMOTE.map((conversionActionId) => ({
      update: {
        resourceName: `customers/${customerId}/conversionActions/${conversionActionId}`,
        primaryForGoal: false,
      },
      updateMask: 'primaryForGoal',
    })),
  ];
}

function validateConversionSetupPreconditions(audit) {
  if (!audit.ok) return [audit.error || 'Audit account non riuscito.'];

  const errors = [];
  const existingLead = audit.conversionActions.find(
    (action) => action.name === GOOGLE_LEAD_CONVERSION_NAME && action.status !== 'REMOVED',
  );
  if (existingLead) errors.push(`La conversione ${GOOGLE_LEAD_CONVERSION_NAME} esiste già.`);

  for (const expectedId of GOOGLE_OUTBOUND_ACTION_IDS_TO_DEMOTE) {
    const action = audit.conversionActions.find((item) => item.id === expectedId);
    if (!action) {
      errors.push(`Conversione da aggiornare non trovata: ${expectedId}.`);
      continue;
    }
    if (action.status !== 'ENABLED' || action.primaryForGoal !== true || action.category !== 'OUTBOUND_CLICK') {
      errors.push(`Stato inatteso per ${action.name} (${expectedId}).`);
    }
  }

  return errors;
}

export async function mutateGoogleAdsConversionSetup({ validateOnly = true } = {}) {
  const env = getGoogleAdsEnv();
  const audit = await runGoogleAdsAccountAudit();
  const preconditionErrors = validateConversionSetupPreconditions(audit);

  if (preconditionErrors.length > 0) {
    return {
      ok: false,
      validateOnly,
      errors: preconditionErrors,
      safety: { writeCallsMade: false, campaignWritesMade: false },
    };
  }

  try {
    const credentials = readServiceAccount(env.serviceAccountJson);
    const accessToken = await getServiceAccountAccessToken(credentials);
    const response = await googleAdsRequest(`customers/${env.customerId}/conversionActions:mutate`, {
      accessToken,
      developerToken: env.developerToken,
      loginCustomerId: env.loginCustomerId,
      method: 'POST',
      body: {
        operations: buildConversionSetupOperations(env.customerId),
        partialFailure: false,
        validateOnly,
        responseContentType: 'MUTABLE_RESOURCE',
      },
    });

    return {
      ok: true,
      validateOnly,
      results: response.results || [],
      safety: {
        writeCallsMade: validateOnly ? false : true,
        campaignWritesMade: false,
        campaignEnableCallsMade: false,
      },
    };
  } catch (error) {
    return {
      ok: false,
      validateOnly,
      error: error instanceof Error ? error.message : 'Configurazione conversioni Google Ads non riuscita.',
      safety: {
        writeCallsMade: false,
        campaignWritesMade: false,
        campaignEnableCallsMade: false,
      },
    };
  }
}

export async function resolveGoogleAdsTargetingConstants(locationNames = []) {
  const env = getGoogleAdsEnv();

  try {
    const credentials = readServiceAccount(env.serviceAccountJson);
    const accessToken = await getServiceAccountAccessToken(credentials);
    const requestOptions = {
      accessToken,
      developerToken: env.developerToken,
      loginCustomerId: env.loginCustomerId,
      method: 'POST',
    };
    const [geoResponse, languageResponse] = await Promise.all([
      googleAdsRequest('geoTargetConstants:suggest', {
        ...requestOptions,
        body: {
          locale: 'it',
          countryCode: 'IT',
          locationNames: { names: locationNames },
        },
      }),
      googleAdsRequest(`customers/${env.customerId}/googleAds:search`, {
        ...requestOptions,
        body: {
          query: [
            'SELECT',
            'language_constant.resource_name,',
            'language_constant.name,',
            'language_constant.code',
            'FROM language_constant',
            "WHERE language_constant.code = 'it'",
          ].join(' '),
        },
      }),
    ]);

    return {
      ok: true,
      locations: (geoResponse.geoTargetConstantSuggestions || []).map((suggestion) => ({
        searchTerm: suggestion.searchTerm,
        reach: Number(suggestion.reach || 0),
        resourceName: suggestion.geoTargetConstant?.resourceName,
        name: suggestion.geoTargetConstant?.name,
        countryCode: suggestion.geoTargetConstant?.countryCode,
        targetType: suggestion.geoTargetConstant?.targetType,
        status: suggestion.geoTargetConstant?.status,
        canonicalName: suggestion.geoTargetConstant?.canonicalName,
      })),
      language: languageResponse.results?.[0]?.languageConstant || null,
      safety: { writeCallsMade: false },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Risoluzione targeting Google Ads non riuscita.',
      safety: { writeCallsMade: false },
    };
  }
}

export async function runGoogleAdsQuery(query) {
  const env = getGoogleAdsEnv();
  const credentials = readServiceAccount(env.serviceAccountJson);
  const accessToken = await getServiceAccountAccessToken(credentials);

  return googleAdsRequest(`customers/${env.customerId}/googleAds:search`, {
    accessToken,
    developerToken: env.developerToken,
    loginCustomerId: env.loginCustomerId,
    method: 'POST',
    body: { query },
  });
}

export async function runGoogleAdsAtomicMutate(mutateOperations, { validateOnly = true } = {}) {
  const env = getGoogleAdsEnv();
  const credentials = readServiceAccount(env.serviceAccountJson);
  const accessToken = await getServiceAccountAccessToken(credentials);
  const response = await googleAdsRequest(`customers/${env.customerId}/googleAds:mutate`, {
    accessToken,
    developerToken: env.developerToken,
    loginCustomerId: env.loginCustomerId,
    method: 'POST',
    body: {
      mutateOperations,
      partialFailure: false,
      validateOnly,
      responseContentType: 'MUTABLE_RESOURCE',
    },
  });

  return {
    ok: true,
    validateOnly,
    mutateOperationResponses: response.mutateOperationResponses || [],
    safety: {
      writeCallsMade: validateOnly ? false : true,
      campaignCreatedPaused: validateOnly ? false : true,
      campaignEnableCallsMade: false,
    },
  };
}
