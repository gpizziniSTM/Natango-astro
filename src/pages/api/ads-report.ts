import type { APIRoute } from 'astro';
import crypto from 'crypto';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  return handleReport(request);
};

export const POST: APIRoute = async ({ request }) => {
  return handleReport(request);
};

async function handleReport(request: Request) {
  const url = new URL(request.url);
  const authHeader = request.headers.get('x-api-key') || url.searchParams.get('api_key');
  const secretKey = process.env.NATANGO_ADS_API_KEY || 'natango_ads_secret_key_2026';

  if (authHeader !== secretKey) {
    return new Response(JSON.stringify({ error: true, message: 'Non autorizzato: API Key errata' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const range = url.searchParams.get('range') || 'last_7d';

  const metaData = await fetchMetaAds(range);
  const googleData = await fetchGoogleAds(range);

  let combinedSpend = 0;
  let combinedImpressions = 0;
  let combinedClicks = 0;
  let combinedConversions = 0;

  if (!metaData.error && metaData.summary) {
    combinedSpend += metaData.summary.total_spend_eur || 0;
    combinedImpressions += metaData.summary.total_impressions || 0;
    combinedClicks += metaData.summary.total_clicks || 0;
    for (const c of metaData.campaigns || []) {
      combinedConversions += c.conversions || 0;
    }
  }

  if (!googleData.error && googleData.summary) {
    combinedSpend += googleData.summary.total_spend_eur || 0;
    combinedImpressions += googleData.summary.total_impressions || 0;
    combinedClicks += googleData.summary.total_clicks || 0;
    combinedConversions += googleData.summary.total_conversions || 0;
  }

  const overallCtr = combinedImpressions > 0 ? Number(((combinedClicks / combinedImpressions) * 100).toFixed(2)) : 0;
  const overallCpc = combinedClicks > 0 ? Number((combinedSpend / combinedClicks).toFixed(2)) : 0;
  const costPerConv = combinedConversions > 0 ? Number((combinedSpend / combinedConversions).toFixed(2)) : 0;

  const responsePayload = {
    date_preset: range,
    summary: {
      total_spend_eur: Number(combinedSpend.toFixed(2)),
      total_impressions: combinedImpressions,
      total_clicks: combinedClicks,
      total_conversions: Number(combinedConversions.toFixed(1)),
      overall_ctr_pct: overallCtr,
      overall_cpc_eur: overallCpc,
      cost_per_conversion_eur: costPerConv
    },
    meta_ads: metaData,
    google_ads: googleData
  };

  return new Response(JSON.stringify(responsePayload, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

// -------------------------------------------------------------
// META ADS MARKETING API FETCH
// -------------------------------------------------------------
async function fetchMetaAds(range: string) {
  const token = process.env.META_ADS_ACCESS_TOKEN;
  let accountId = process.env.META_ADS_ACCOUNT_ID;

  if (!token || !accountId) {
    return { error: true, message: 'Credenziali Meta Ads non impostate nelle variabili d\'ambiente' };
  }

  if (!accountId.startsWith('act_')) {
    accountId = `act_${accountId}`;
  }

  const apiVersion = process.env.META_ADS_API_VERSION || 'v20.0';
  const fields = 'campaign_id,campaign_name,spend,impressions,clicks,cpc,cpm,ctr,actions';
  const url = `https://graph.facebook.com/${apiVersion}/${accountId}/insights?level=campaign&date_preset=${range}&fields=${fields}&limit=100&access_token=${token}`;

  try {
    const res = await fetch(url);
    const json = await res.json();

    if (json.error) {
      return { error: true, message: json.error.message || 'Errore Meta Ads API' };
    }

    const data = json.data || [];
    let totalSpend = 0;
    let totalImpressions = 0;
    let totalClicks = 0;
    const campaigns: any[] = [];

    for (const row of data) {
      const spend = parseFloat(row.spend || '0');
      const impressions = parseInt(row.impressions || '0', 10);
      const clicks = parseInt(row.clicks || '0', 10);
      const ctr = parseFloat(row.ctr || '0');
      const cpc = parseFloat(row.cpc || '0');

      totalSpend += spend;
      totalImpressions += impressions;
      totalClicks += clicks;

      let conversions = 0;
      const actions = row.actions || [];
      for (const act of actions) {
        if (['lead', 'purchase', 'complete_registration', 'offsite_conversion.fb_pixel_lead'].includes(act.action_type)) {
          conversions += parseInt(act.value || '0', 10);
        }
      }

      campaigns.push({
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        spend_eur: Number(spend.toFixed(2)),
        impressions,
        clicks,
        ctr_pct: Number(ctr.toFixed(2)),
        cpc_eur: Number(cpc.toFixed(2)),
        conversions,
        cost_per_conversion_eur: conversions > 0 ? Number((spend / conversions).toFixed(2)) : 0
      });
    }

    return {
      error: false,
      date_preset: range,
      summary: {
        total_spend_eur: Number(totalSpend.toFixed(2)),
        total_impressions: totalImpressions,
        total_clicks: totalClicks,
        overall_ctr_pct: totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0,
        overall_cpc_eur: totalClicks > 0 ? Number((totalSpend / totalClicks).toFixed(2)) : 0
      },
      campaigns
    };
  } catch (err: any) {
    return { error: true, message: `Errore chiamata Meta Ads: ${err.message}` };
  }
}

// -------------------------------------------------------------
// GOOGLE ADS REST API FETCH WITH SERVICE ACCOUNT JWT
// -------------------------------------------------------------
async function fetchGoogleAds(range: string) {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '');
  const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, '');
  const saJsonPath = process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON;
  const saJsonRaw = process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON_CONTENT;

  if (!devToken || !customerId) {
    return { error: true, message: 'Credenziali Google Ads non impostate nelle variabili d\'ambiente' };
  }

  try {
    let serviceAccount: any = null;

    if (saJsonRaw) {
      serviceAccount = JSON.parse(saJsonRaw);
    } else if (saJsonPath) {
      const fs = await import('fs');
      if (fs.existsSync(saJsonPath)) {
        serviceAccount = JSON.parse(fs.readFileSync(saJsonPath, 'utf8'));
      }
    }

    if (!serviceAccount) {
      return { error: true, message: 'Service Account JSON di Google Ads non trovato' };
    }

    // Generazione Access Token via OAuth2 Service Account JWT assertion
    const accessToken = await getGoogleOAuth2Token(serviceAccount);
    if (!accessToken) {
      return { error: true, message: 'Impossibile generare Access Token Google Ads' };
    }

    const dateMap: Record<string, string> = {
      today: 'TODAY',
      yesterday: 'YESTERDAY',
      last_7d: 'LAST_7_DAYS',
      last_30d: 'LAST_30_DAYS',
      this_month: 'THIS_MONTH',
      last_month: 'LAST_MONTH'
    };
    const gaqlDate = dateMap[range.toLowerCase()] || 'LAST_7_DAYS';

    const gaql = `
      SELECT 
        campaign.id, 
        campaign.name, 
        campaign.status, 
        metrics.cost_micros, 
        metrics.impressions, 
        metrics.clicks, 
        metrics.ctr, 
        metrics.average_cpc, 
        metrics.conversions, 
        metrics.cost_per_conversion
      FROM campaign 
      WHERE segments.date DURING ${gaqlDate}
    `;

    const apiVersion = process.env.GOOGLE_ADS_API_VERSION || 'v18';
    const url = `https://googleads.googleapis.com/${apiVersion}/customers/${customerId}/googleAds:search`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': devToken,
      'Content-Type': 'application/json'
    };
    if (loginCustomerId) {
      headers['login-customer-id'] = loginCustomerId;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: gaql })
    });

    if (!res.ok) {
      const errText = await res.text();
      return { error: true, message: `Errore Google Ads API (${res.status}): ${errText}` };
    }

    const json = await res.json();
    const batches = Array.isArray(json) ? json : [json];
    const campaigns: any[] = [];
    let totalCostMicros = 0;
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalConversions = 0;

    for (const batch of batches) {
      const results = batch.results || [];
      for (const row of results) {
        const c = row.campaign || {};
        const m = row.metrics || {};

        const costMicros = parseInt(m.costMicros || '0', 10);
        const spendEur = Number((costMicros / 1000000).toFixed(2));
        const impressions = parseInt(m.impressions || '0', 10);
        const clicks = parseInt(m.clicks || '0', 10);
        const ctr = Number((parseFloat(m.ctr || '0') * 100).toFixed(2));
        const cpc = Number((parseInt(m.averageCpc || '0', 10) / 1000000).toFixed(2));
        const conversions = Number(parseFloat(m.conversions || '0').toFixed(1));
        const costPerConv = conversions > 0 ? Number((parseInt(m.costPerConversion || '0', 10) / 1000000).toFixed(2)) : 0;

        if (c.status === 'REMOVED' && costMicros === 0) {
          continue;
        }

        totalCostMicros += costMicros;
        totalImpressions += impressions;
        totalClicks += clicks;
        totalConversions += conversions;

        campaigns.push({
          id: String(c.id),
          name: c.name,
          status: c.status,
          spend_eur: spendEur,
          impressions,
          clicks,
          ctr_pct: ctr,
          cpc_eur: cpc,
          conversions,
          cost_per_conversion_eur: costPerConv
        });
      }
    }

    const totalSpendEur = Number((totalCostMicros / 1000000).toFixed(2));
    return {
      error: false,
      date_preset: range,
      summary: {
        total_spend_eur: totalSpendEur,
        total_impressions: totalImpressions,
        total_clicks: totalClicks,
        total_conversions: Number(totalConversions.toFixed(1)),
        overall_ctr_pct: totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0,
        overall_cpc_eur: totalClicks > 0 ? Number((totalSpendEur / totalClicks).toFixed(2)) : 0
      },
      campaigns
    };
  } catch (err: any) {
    return { error: true, message: `Errore chiamata Google Ads: ${err.message}` };
  }
}

// Genera un JWT assertion per Service Account Google senza dipendenze esterne
async function getGoogleOAuth2Token(serviceAccount: any): Promise<string | null> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/adwords',
    aud: serviceAccount.token_uri || 'https://oauth2.googleapis.com/token',
    exp,
    iat
  };

  const encodeBase64Url = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const unsignedToken = `${encodeBase64Url(header)}.${encodeBase64Url(claimSet)}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  const signature = signer.sign(serviceAccount.private_key, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const jwt = `${unsignedToken}.${signature}`;

  const res = await fetch(serviceAccount.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  if (!res.ok) {
    return null;
  }

  const json = await res.json();
  return json.access_token || null;
}
