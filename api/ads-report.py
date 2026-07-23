from http.server import BaseHTTPRequestHandler
import json
import urllib.parse
import os
import sys
from pathlib import Path

# Aggiunge Natango ADS al sys.path
root_dir = Path(__file__).resolve().parent.parent
ads_dir = root_dir / "Natango ADS"
sys.path.insert(0, str(ads_dir))

from meta_ads import MetaAdsClient
from google_ads import GoogleAdsClient

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self._process_request()

    def do_POST(self):
        self._process_request()

    def _process_request(self):
        parsed_url = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed_url.query)
        
        api_key = params.get("api_key", [None])[0] or self.headers.get("x-api-key")
        expected_key = os.getenv("NATANGO_ADS_API_KEY", "natango_ads_secret_key_2026")

        if api_key != expected_key:
            self.send_response(401)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": True, "message": "Non autorizzato: API Key errata"}).encode('utf-8'))
            return

        date_preset = params.get("range", ["last_7d"])[0]

        meta_client = MetaAdsClient()
        google_client = GoogleAdsClient()

        meta_data = meta_client.get_campaign_insights(date_preset) if meta_client.is_configured() else {"error": True, "message": "Non configurato"}
        google_data = google_client.get_campaigns_insights(date_preset) if google_client.is_configured() else {"error": True, "message": "Non configurato"}

        combined_spend = 0.0
        combined_impressions = 0
        combined_clicks = 0
        combined_conversions = 0.0

        if not meta_data.get("error"):
            s = meta_data.get("summary", {})
            combined_spend += s.get("total_spend_eur", 0)
            combined_impressions += s.get("total_impressions", 0)
            combined_clicks += s.get("total_clicks", 0)
            for c in meta_data.get("campaigns", []):
                combined_conversions += c.get("conversions", 0)

        if not google_data.get("error"):
            s = google_data.get("summary", {})
            combined_spend += s.get("total_spend_eur", 0)
            combined_impressions += s.get("total_impressions", 0)
            combined_clicks += s.get("total_clicks", 0)
            combined_conversions += s.get("total_conversions", 0)

        report_payload = {
            "date_preset": date_preset,
            "summary": {
                "total_spend_eur": round(combined_spend, 2),
                "total_impressions": combined_impressions,
                "total_clicks": combined_clicks,
                "total_conversions": round(combined_conversions, 1),
                "overall_ctr_pct": round((combined_clicks / combined_impressions * 100), 2) if combined_impressions > 0 else 0,
                "overall_cpc_eur": round((combined_spend / combined_clicks), 2) if combined_clicks > 0 else 0,
                "cost_per_conversion_eur": round(combined_spend / combined_conversions, 2) if combined_conversions > 0 else 0
            },
            "meta_ads": meta_data,
            "google_ads": google_data
        }

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(report_payload, indent=2).encode('utf-8'))
