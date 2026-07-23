#!/usr/bin/env python3
"""
Meta Ads (Facebook Marketing API) Client per Accademia Natango.
Gestisce il recupero di campagne, insights (spesa, impression, clic, conversioni) e cambio stato.
"""

import os
import sys
import json
import urllib.request
import urllib.parse
import urllib.error
from typing import Dict, Any, List, Optional
from pathlib import Path

# Caricamento automatico di .env.local se presente
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

META_ACCESS_TOKEN = os.getenv("META_ADS_ACCESS_TOKEN", "")
META_ACCOUNT_ID = os.getenv("META_ADS_ACCOUNT_ID", "")
META_API_VERSION = os.getenv("META_ADS_API_VERSION", "v20.0")

class MetaAdsClient:
    def __init__(self, access_token: Optional[str] = None, account_id: Optional[str] = None, api_version: Optional[str] = None):
        self.access_token = access_token or META_ACCESS_TOKEN
        self.account_id = account_id or META_ACCOUNT_ID
        self.api_version = api_version or META_API_VERSION

        # Pulisce l'account_id assicurando il prefisso act_
        if self.account_id and not self.account_id.startswith("act_"):
            self.account_id = f"act_{self.account_id}"

        self.base_url = f"https://graph.facebook.com/{self.api_version}"

    def is_configured(self) -> bool:
        """Verifica se le credenziali minime sono presenti."""
        return bool(self.access_token and self.account_id and self.access_token != "il_tuo_access_token_meta")

    def _make_request(self, endpoint: str, params: Optional[Dict[str, Any]] = None, method: str = "GET") -> Dict[str, Any]:
        if not self.is_configured():
            return {
                "error": True,
                "message": "Credenziali Meta Ads non configurate in .env.local (META_ADS_ACCESS_TOKEN, META_ADS_ACCOUNT_ID)."
            }

        params = params or {}
        params["access_token"] = self.access_token

        query_string = urllib.parse.urlencode(params)
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        
        if method == "GET":
            url = f"{url}?{query_string}"
            req = urllib.request.Request(url, method="GET")
        else:
            data = query_string.encode("utf-8")
            req = urllib.request.Request(url, data=data, method=method)

        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                body = response.read().decode("utf-8")
                return json.loads(body)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            try:
                err_json = json.loads(err_body)
                msg = err_json.get("error", {}).get("message", str(e))
            except Exception:
                msg = f"HTTP {e.code}: {e.reason}"
            return {"error": True, "code": e.code, "message": f"Errore API Meta Ads: {msg}"}
        except Exception as e:
            return {"error": True, "message": f"Errore connessione Meta Ads: {str(e)}"}

    def get_account_info(self) -> Dict[str, Any]:
        """Recupera informazioni sull'account pubblicitario."""
        fields = "id,name,account_status,currency,spend_cap,amount_spent"
        return self._make_request(self.account_id, {"fields": fields})

    def get_campaigns(self) -> Dict[str, Any]:
        """Recupera l'elenco delle campagne con i dettagli principali."""
        fields = "id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time"
        res = self._make_request(f"{self.account_id}/campaigns", {"fields": fields, "limit": 100})
        if res.get("error"):
            return res
        
        campaigns = res.get("data", [])
        formatted = []
        for c in campaigns:
            daily_b = float(c.get("daily_budget", 0)) / 100 if c.get("daily_budget") else 0
            life_b = float(c.get("lifetime_budget", 0)) / 100 if c.get("lifetime_budget") else 0
            formatted.append({
                "id": c.get("id"),
                "name": c.get("name"),
                "status": c.get("status"),
                "effective_status": c.get("effective_status"),
                "objective": c.get("objective"),
                "daily_budget_eur": daily_b,
                "lifetime_budget_eur": life_b
            })
        return {"error": False, "count": len(formatted), "campaigns": formatted}

    def get_campaign_insights(self, date_preset: str = "last_7d") -> Dict[str, Any]:
        """
        Recupera le metriche di performance a livello di campagna.
        date_preset supportati: today, yesterday, last_7d, last_30d, this_month, last_month.
        """
        fields = "campaign_id,campaign_name,spend,impressions,clicks,cpc,cpm,ctr,actions,cost_per_action_type"
        params = {
            "level": "campaign",
            "date_preset": date_preset,
            "fields": fields,
            "limit": 100
        }
        res = self._make_request(f"{self.account_id}/insights", params)
        if res.get("error"):
            return res

        data = res.get("data", [])
        insights = []
        total_spend = 0.0
        total_impressions = 0
        total_clicks = 0

        for row in data:
            spend = float(row.get("spend", 0))
            impressions = int(row.get("impressions", 0))
            clicks = int(row.get("clicks", 0))
            ctr = float(row.get("ctr", 0))
            cpc = float(row.get("cpc", 0))

            total_spend += spend
            total_impressions += impressions
            total_clicks += clicks

            # Estrazione conversioni/lead
            conversions = 0
            actions = row.get("actions", [])
            for act in actions:
                action_type = act.get("action_type", "")
                if action_type in ["lead", "purchase", "complete_registration", "offsite_conversion.fb_pixel_lead"]:
                    conversions += int(act.get("value", 0))

            insights.append({
                "campaign_id": row.get("campaign_id"),
                "campaign_name": row.get("campaign_name"),
                "spend_eur": round(spend, 2),
                "impressions": impressions,
                "clicks": clicks,
                "ctr_pct": round(ctr, 2),
                "cpc_eur": round(cpc, 2),
                "conversions": conversions,
                "cost_per_conversion_eur": round(spend / conversions, 2) if conversions > 0 else 0
            })

        return {
            "error": False,
            "date_preset": date_preset,
            "summary": {
                "total_spend_eur": round(total_spend, 2),
                "total_impressions": total_impressions,
                "total_clicks": total_clicks,
                "overall_ctr_pct": round((total_clicks / total_impressions * 100), 2) if total_impressions > 0 else 0,
                "overall_cpc_eur": round((total_spend / total_clicks), 2) if total_clicks > 0 else 0
            },
            "campaigns": insights
        }

    def update_campaign_status(self, campaign_id: str, status: str) -> Dict[str, Any]:
        """Cambia lo stato di una campagna (status: 'ACTIVE' o 'PAUSED')."""
        status_upper = status.upper()
        if status_upper not in ["ACTIVE", "PAUSED"]:
            return {"error": True, "message": "Lo stato deve essere 'ACTIVE' o 'PAUSED'."}

        res = self._make_request(campaign_id, {"status": status_upper}, method="POST")
        if res.get("success"):
            return {"error": False, "message": f"Campagna {campaign_id} impostata a {status_upper}."}
        return res

if __name__ == "__main__":
    client = MetaAdsClient()
    if not client.is_configured():
        print("[!] Meta Ads non configurato in .env.local")
        sys.exit(1)

    print("[+] Test Connessione Meta Ads...")
    acc = client.get_account_info()
    print("Account Info:", json.dumps(acc, indent=2))
    
    print("\n[+] Recupero Campagne...")
    camps = client.get_campaigns()
    print("Campagne:", json.dumps(camps, indent=2))

    print("\n[+] Recupero Insights (last_7d)...")
    ins = client.get_campaign_insights("last_7d")
    print("Insights:", json.dumps(ins, indent=2))
