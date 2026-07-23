#!/usr/bin/env python3
"""
Google Ads Client per Accademia Natango.
Utilizza l'SDK ufficiale Google Ads Python per la gestione autenticata tramite Service Account o OAuth2.
"""

import os
import sys
import json
from typing import Dict, Any, List, Optional
from pathlib import Path

def load_env_file():
    env_path = Path(__file__).resolve().parent.parent / ".env.local"
    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key not in os.environ:
                        os.environ[key] = value

load_env_file()

GOOGLE_DEV_TOKEN = os.getenv("GOOGLE_ADS_DEVELOPER_TOKEN", "")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_ADS_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_ADS_CLIENT_SECRET", "")
GOOGLE_REFRESH_TOKEN = os.getenv("GOOGLE_ADS_REFRESH_TOKEN", "")
GOOGLE_CUSTOMER_ID = os.getenv("GOOGLE_ADS_CUSTOMER_ID", "").replace("-", "")
GOOGLE_LOGIN_CUSTOMER_ID = os.getenv("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "").replace("-", "")
GOOGLE_SERVICE_ACCOUNT_JSON = os.getenv("GOOGLE_ADS_SERVICE_ACCOUNT_JSON", "")

class GoogleAdsClient:
    def __init__(self):
        self.dev_token = GOOGLE_DEV_TOKEN
        self.customer_id = GOOGLE_CUSTOMER_ID
        self.login_customer_id = GOOGLE_LOGIN_CUSTOMER_ID
        self.service_account_json = GOOGLE_SERVICE_ACCOUNT_JSON
        self.client_id = GOOGLE_CLIENT_ID
        self.client_secret = GOOGLE_CLIENT_SECRET
        self.refresh_token = GOOGLE_REFRESH_TOKEN
        self._sdk_client = None

    def is_configured(self) -> bool:
        has_sa = bool(self.service_account_json and Path(self.service_account_json).exists())
        has_oauth = bool(self.client_id and self.client_secret and self.refresh_token)
        return bool(self.dev_token and self.customer_id and (has_sa or has_oauth))

    def _init_sdk(self):
        if self._sdk_client:
            return self._sdk_client

        from google.ads.googleads.client import GoogleAdsClient as SDKClient

        config: Dict[str, Any] = {
            "developer_token": self.dev_token,
            "use_proto_plus": True
        }

        if self.login_customer_id:
            config["login_customer_id"] = self.login_customer_id

        if self.service_account_json and Path(self.service_account_json).exists():
            config["json_key_file_path"] = self.service_account_json
        else:
            config["client_id"] = self.client_id
            config["client_secret"] = self.client_secret
            config["refresh_token"] = self.refresh_token

        self._sdk_client = SDKClient.load_from_dict(config)
        return self._sdk_client

    def get_campaigns_insights(self, date_preset: str = "last_7d") -> Dict[str, Any]:
        if not self.is_configured():
            return {
                "error": True,
                "message": "Credenziali Google Ads non configurate in .env.local."
            }

        date_map = {
            "today": "TODAY",
            "yesterday": "YESTERDAY",
            "last_7d": "LAST_7_DAYS",
            "last_30d": "LAST_30_DAYS",
            "this_month": "THIS_MONTH",
            "last_month": "LAST_MONTH"
        }
        gaql_date = date_map.get(date_preset.lower(), "LAST_7_DAYS")

        try:
            client = self._init_sdk()
            ga_service = client.get_service("GoogleAdsService")

            query = f"""
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
                WHERE segments.date DURING {gaql_date}
            """

            stream = ga_service.search_stream(customer_id=self.customer_id, query=query)

            campaigns = []
            total_cost_micros = 0
            total_impressions = 0
            total_clicks = 0
            total_conversions = 0.0

            for batch in stream:
                for row in batch.results:
                    c = row.campaign
                    m = row.metrics

                    status_name = c.status.name if hasattr(c.status, "name") else str(c.status)
                    # Saltiamo le campagne rimosse se non hanno spesa
                    cost_micros = getattr(m, "cost_micros", 0)
                    if status_name == "REMOVED" and cost_micros == 0:
                        continue

                    spend_eur = round(cost_micros / 1_000_000, 2)
                    impressions = int(getattr(m, "impressions", 0))
                    clicks = int(getattr(m, "clicks", 0))
                    ctr = round(float(getattr(m, "ctr", 0)) * 100, 2)
                    cpc = round(int(getattr(m, "average_cpc", 0)) / 1_000_000, 2)
                    conversions = round(float(getattr(m, "conversions", 0)), 1)
                    cost_per_conv = round(int(getattr(m, "cost_per_conversion", 0)) / 1_000_000, 2) if conversions > 0 else 0

                    total_cost_micros += cost_micros
                    total_impressions += impressions
                    total_clicks += clicks
                    total_conversions += conversions

                    campaigns.append({
                        "id": str(c.id),
                        "name": c.name,
                        "status": status_name,
                        "spend_eur": spend_eur,
                        "impressions": impressions,
                        "clicks": clicks,
                        "ctr_pct": ctr,
                        "cpc_eur": cpc,
                        "conversions": conversions,
                        "cost_per_conversion_eur": cost_per_conv
                    })

            total_spend_eur = round(total_cost_micros / 1_000_000, 2)
            return {
                "error": False,
                "date_preset": date_preset,
                "summary": {
                    "total_spend_eur": total_spend_eur,
                    "total_impressions": total_impressions,
                    "total_clicks": total_clicks,
                    "total_conversions": round(total_conversions, 1),
                    "overall_ctr_pct": round((total_clicks / total_impressions * 100), 2) if total_impressions > 0 else 0,
                    "overall_cpc_eur": round((total_spend_eur / total_clicks), 2) if total_clicks > 0 else 0
                },
                "campaigns": campaigns
            }
        except Exception as e:
            return {"error": True, "message": f"Errore SDK Google Ads: {str(e)}"}

if __name__ == "__main__":
    client = GoogleAdsClient()
    if not client.is_configured():
        print("[!] Google Ads non configurato in .env.local")
        sys.exit(1)

    print("[+] Recupero Campagne e Insights Google Ads (last_7d)...")
    res = client.get_campaigns_insights("last_7d")
    print(json.dumps(res, indent=2))
