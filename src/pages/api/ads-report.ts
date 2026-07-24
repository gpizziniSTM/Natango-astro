import type { APIRoute } from 'astro';
import { GoogleAdsApi } from 'google-ads-api';
import { JWT } from 'google-auth-library';

export const prerender = false;

interface CampaignReport {
  campaign_id?: string;
  id?: string;
  campaign_name?: string;
  name?: string;
  status?: string;
  spend_eur: number;
  impressions: number;
  clicks: number;
  ctr_pct: number;
  cpc_eur: number;
  conversions: number;
  cost_per_conversion_eur: number;
}

interface AdsSummary {
  total_spend_eur: number;
  total_impressions: number;
  total_clicks: number;
  total_conversions?: number;
  overall_ctr_pct: number;
  overall_cpc_eur: number;
  cost_per_conversion_eur?: number;
}

// Meta Ads Fetcher
async function fetchMetaAds(datePreset: string) {
  const token = process.env.META_ADS_ACCESS_TOKEN;
  const accountId = process.env.META_ADS_ACCOUNT_ID;

  if (!token || !accountId) {
    return { error: true, message: 'Credenziali Meta Ads non configurate' };
  }

  const cleanAccountId = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const url = `https://graph.facebook.com/v20.0/${cleanAccountId}/insights?fields=campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,actions&level=campaign&date_preset=${datePreset}&access_token=${token}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      return { error: true, message: `Errore Meta Ads API: ${data.error.message}` };
    }

    const campaigns: CampaignReport[] = (data.data || []).map((item: any) => {
      const spend = parseFloat(item.spend || '0');
      const impressions = parseInt(item.impressions || '0', 10);
      const clicks = parseInt(item.clicks || '0', 10);
      const ctr = parseFloat(item.ctr || '0');
      const cpc = parseFloat(item.cpc || '0');

      let conversions = 0;
      if (item.actions && Array.isArray(item.actions)) {
        for (const act of item.actions) {
          if (['lead', 'purchase', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.messaging_first_reply'].includes(act.action_type)) {
            conversions += parseFloat(act.value || '0');
          }
        }
      }

      return {
        campaign_id: item.campaign_id,
        campaign_name: item.campaign_name,
        spend_eur: Math.round(spend * 100) / 100,
        impressions,
        clicks,
        ctr_pct: Math.round(ctr * 100) / 100,
        cpc_eur: Math.round(cpc * 100) / 100,
        conversions: Math.round(conversions * 10) / 10,
        cost_per_conversion_eur: conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : 0
      };
    });

    const totalSpend = campaigns.reduce((acc, c) => acc + c.spend_eur, 0);
    const totalImpressions = campaigns.reduce((acc, c) => acc + c.impressions, 0);
    const totalClicks = campaigns.reduce((acc, c) => acc + c.clicks, 0);

    return {
      error: false,
      date_preset: datePreset,
      summary: {
        total_spend_eur: Math.round(totalSpend * 100) / 100,
        total_impressions: totalImpressions,
        total_clicks: totalClicks,
        overall_ctr_pct: totalImpressions > 0 ? Math.round((totalClicks / totalImpressions * 100) * 100) / 100 : 0,
        overall_cpc_eur: totalClicks > 0 ? Math.round((totalSpend / totalClicks) * 100) / 100 : 0
      },
      campaigns
    };
  } catch (err: any) {
    return { error: true, message: `Eccezione Meta Ads: ${err.message}` };
  }
}

// Google Ads Fetcher via google-ads-api Node SDK
async function fetchGoogleAds(datePreset: string) {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '');
  const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, '');

  let saJson: any = null;
  if (process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON_CONTENT) {
    try {
      saJson = JSON.parse(process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON_CONTENT);
    } catch (e) {}
  } else if (process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON) {
    try {
      const fs = await import('fs');
      saJson = JSON.parse(fs.readFileSync(process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON, 'utf8'));
    } catch (e) {}
  }

  if (!devToken || !customerId || !saJson) {
    return { error: true, message: 'Credenziali Google Ads non configurate' };
  }

  try {
    const auth = new JWT({
      email: saJson.client_email,
      key: saJson.private_key,
      scopes: ['https://www.googleapis.com/auth/adwords'],
    });

    await auth.authorize();
    const accessToken = auth.credentials.access_token;

    const client = new GoogleAdsApi({
      developer_token: devToken,
    });

    const customer = client.Customer({
      customer_id: customerId,
      login_customer_id: loginCustomerId || undefined,
      refresh_token: 'dummy_token',
      credentials: { refresh_token: 'dummy_token' },
    });

    // Override getAccessToken per usare il JWT del Service Account
    (customer as any).getAccessToken = async () => accessToken;

    let duringClause = 'DURING LAST_7_DAYS';
    if (datePreset === 'this_month') {
      duringClause = 'DURING THIS_MONTH';
    } else if (datePreset === 'last_30d') {
      duringClause = 'DURING LAST_30_DAYS';
    }

    const query = `
      SELECT 
        campaign.id, 
        campaign.name, 
        campaign.status, 
        metrics.cost_micros, 
        metrics.impressions, 
        metrics.clicks, 
        metrics.ctr, 
        metrics.average_cpc, 
        metrics.conversions
      FROM campaign 
      WHERE segments.date ${duringClause}
    `;

    const results = await customer.query(query);

    const campaigns: CampaignReport[] = results.map((row: any) => {
      const spendEur = (row.metrics?.cost_micros || 0) / 1000000;
      const impressions = row.metrics?.impressions || 0;
      const clicks = row.metrics?.clicks || 0;
      const ctr = (row.metrics?.ctr || 0) * 100;
      const cpcEur = (row.metrics?.average_cpc || 0) / 1000000;
      const conversions = row.metrics?.conversions || 0;

      return {
        id: String(row.campaign?.id),
        name: row.campaign?.name,
        status: String(row.campaign?.status),
        spend_eur: Math.round(spendEur * 100) / 100,
        impressions,
        clicks,
        ctr_pct: Math.round(ctr * 100) / 100,
        cpc_eur: Math.round(cpcEur * 100) / 100,
        conversions: Math.round(conversions * 10) / 10,
        cost_per_conversion_eur: conversions > 0 ? Math.round((spendEur / conversions) * 100) / 100 : 0
      };
    });

    const totalSpend = campaigns.reduce((acc, c) => acc + c.spend_eur, 0);
    const totalImpressions = campaigns.reduce((acc, c) => acc + c.impressions, 0);
    const totalClicks = campaigns.reduce((acc, c) => acc + c.clicks, 0);
    const totalConversions = campaigns.reduce((acc, c) => acc + c.conversions, 0);

    return {
      error: false,
      date_preset: datePreset,
      summary: {
        total_spend_eur: Math.round(totalSpend * 100) / 100,
        total_impressions: totalImpressions,
        total_clicks: totalClicks,
        total_conversions: Math.round(totalConversions * 10) / 10,
        overall_ctr_pct: totalImpressions > 0 ? Math.round((totalClicks / totalImpressions * 100) * 100) / 100 : 0,
        overall_cpc_eur: totalClicks > 0 ? Math.round((totalSpend / totalClicks) * 100) / 100 : 0
      },
      campaigns
    };
  } catch (err: any) {
    return { error: true, message: `Eccezione Google Ads: ${err.message}` };
  }
}

export const ALL: APIRoute = async ({ request, url }) => {
  const apiKey = request.headers.get('x-api-key') || url.searchParams.get('api_key');
  const expectedApiKey = process.env.NATANGO_ADS_API_KEY || 'natango_ads_secret_key_2026';

  if (apiKey !== expectedApiKey) {
    return new Response(
      JSON.stringify({ error: true, message: 'Non autorizzato: API Key non valida' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const datePreset = url.searchParams.get('range') || 'last_7d';

  const [metaRes, googleRes] = await Promise.all([
    fetchMetaAds(datePreset),
    fetchGoogleAds(datePreset)
  ]);

  let combinedSpend = 0;
  let combinedImpressions = 0;
  let combinedClicks = 0;
  let combinedConversions = 0;

  if (!metaRes.error && metaRes.summary) {
    combinedSpend += metaRes.summary.total_spend_eur;
    combinedImpressions += metaRes.summary.total_impressions;
    combinedClicks += metaRes.summary.total_clicks;
    if (metaRes.campaigns) {
      combinedConversions += metaRes.campaigns.reduce((a: number, c: any) => a + (c.conversions || 0), 0);
    }
  }

  if (!googleRes.error && googleRes.summary) {
    combinedSpend += googleRes.summary.total_spend_eur;
    combinedImpressions += googleRes.summary.total_impressions;
    combinedClicks += googleRes.summary.total_clicks;
    combinedConversions += googleRes.summary.total_conversions || 0;
  }

  const overallCtr = combinedImpressions > 0 ? Math.round((combinedClicks / combinedImpressions * 100) * 100) / 100 : 0;
  const overallCpc = combinedClicks > 0 ? Math.round((combinedSpend / combinedClicks) * 100) / 100 : 0;
  const costPerConv = combinedConversions > 0 ? Math.round((combinedSpend / combinedConversions) * 100) / 100 : 0;

  const payload = {
    date_preset: datePreset,
    summary: {
      total_spend_eur: Math.round(combinedSpend * 100) / 100,
      total_impressions: combinedImpressions,
      total_clicks: combinedClicks,
      total_conversions: Math.round(combinedConversions * 10) / 10,
      overall_ctr_pct: overallCtr,
      overall_cpc_eur: overallCpc,
      cost_per_conversion_eur: costPerConv
    },
    meta_ads: metaRes,
    google_ads: googleRes
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
};
