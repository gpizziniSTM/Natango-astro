#!/usr/bin/env python3
"""
Dashboard CLI Unificata Accademia Natango - Controllo Campagne Meta Ads e Google Ads.
Può essere eseguita sia manualmente che da Antigravity per report veloci.
"""

import sys
import json
import argparse
from pathlib import Path

# Import dei moduli locali in Natango ADS
sys.path.insert(0, str(Path(__file__).resolve().parent))

from meta_ads import MetaAdsClient
from google_ads import GoogleAdsClient

def format_currency(val: float) -> str:
    return f"€ {val:,.2f}".replace(",", " ")

def print_header(title: str):
    print("\n" + "=" * 65)
    print(f"   {title}")
    print("=" * 65)

def run_test_connection():
    print_header("TEST CONNESSORE ADS ACCADEMIA NATANGO")
    
    meta_client = MetaAdsClient()
    print("\n🔹 [Meta Ads / Facebook Marketing API]")
    if not meta_client.is_configured():
        print("  ❌ NON CONFIGURATO: Compilare META_ADS_ACCESS_TOKEN e META_ADS_ACCOUNT_ID in .env.local")
    else:
        acc_info = meta_client.get_account_info()
        if acc_info.get("error"):
            print(f"  ❌ ERRORE: {acc_info.get('message')}")
        else:
            print(f"  ✅ CONNESSO! Account: {acc_info.get('name')} ({acc_info.get('id')}) | Valuta: {acc_info.get('currency')}")

    google_client = GoogleAdsClient()
    print("\n🔹 [Google Ads API]")
    if not google_client.is_configured():
        print("  ❌ NON CONFIGURATO: Compilare GOOGLE_ADS_DEVELOPER_TOKEN, CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN e CUSTOMER_ID in .env.local")
    else:
        print("  ℹ️ Credenziali presenti. Esecuzione query di test su Google Ads...")
        res = google_client.get_campaigns_insights("today")
        if res.get("error"):
            print(f"  ❌ ERRORE: {res.get('message')}")
        else:
            print("  ✅ CONNESSO! Google Ads risponde correttamente.")

def generate_report(date_preset: str = "last_7d", as_json: bool = False):
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

    if as_json:
        print(json.dumps(report_payload, indent=2))
        return

    print_header(f"REPORT CAMPAGNE NATANGO ADS (Periodo: {date_preset})")
    
    s = report_payload["summary"]
    print(f"\n📊 RIEPILOGO COMBINATO (META + GOOGLE):")
    print(f"  • Spesa Totale:         {format_currency(s['total_spend_eur'])}")
    print(f"  • Impression Totali:    {s['total_impressions']:,}".replace(",", " "))
    print(f"  • Clic Totali:          {s['total_clicks']:,}".replace(",", " "))
    print(f"  • CTR Medio:            {s['overall_ctr_pct']}%")
    print(f"  • CPC Medio:            {format_currency(s['overall_cpc_eur'])}")
    print(f"  • Conversioni Totali:   {s['total_conversions']}")
    print(f"  • Costo per Conversione: {format_currency(s['cost_per_conversion_eur'])}")

    # Dettaglio Meta Ads
    print("\n--- 🔷 META ADS ---")
    if meta_data.get("error"):
        print(f"  ⚠️ Meta Ads non disponibile: {meta_data.get('message')}")
    else:
        ms = meta_data.get("summary", {})
        print(f"  Spesa: {format_currency(ms.get('total_spend_eur', 0))} | Clic: {ms.get('total_clicks')} | CTR: {ms.get('overall_ctr_pct')}% | CPC: {format_currency(ms.get('overall_cpc_eur', 0))}")
        print("  Campagne Attive / Rilevate:")
        for c in meta_data.get("campaigns", []):
            print(f"   • [{c['campaign_name']}] Spesa: {format_currency(c['spend_eur'])} | Clic: {c['clicks']} | CTR: {c['ctr_pct']}% | Conv: {c['conversions']} ({format_currency(c['cost_per_conversion_eur'])}/conv)")

    # Dettaglio Google Ads
    print("\n--- 🟢 GOOGLE ADS ---")
    if google_data.get("error"):
        print(f"  ⚠️ Google Ads non disponibile: {google_data.get('message')}")
    else:
        gs = google_data.get("summary", {})
        print(f"  Spesa: {format_currency(gs.get('total_spend_eur', 0))} | Clic: {gs.get('total_clicks')} | CTR: {gs.get('overall_ctr_pct')}% | CPC: {format_currency(gs.get('overall_cpc_eur', 0))}")
        print("  Campagne Attive / Rilevate:")
        for c in google_data.get("campaigns", []):
            print(f"   • [{c['name']}] Spesa: {format_currency(c['spend_eur'])} | Clic: {c['clicks']} | CTR: {c['ctr_pct']}% | Conv: {c['conversions']} ({format_currency(c['cost_per_conversion_eur'])}/conv)")

    print("\n" + "=" * 65 + "\n")

def main():
    parser = argparse.ArgumentParser(description="Accademia Natango ADS Controller")
    parser.add_argument("--test-connection", action="store_true", help="Esegue la diagnostica di connessione alle API")
    parser.add_argument("--range", type=str, default="last_7d", choices=["today", "yesterday", "last_7d", "last_30d", "this_month", "last_month"], help="Seleziona il periodo temporale")
    parser.add_argument("--json", action="store_true", help="Restituisce il report in formato JSON")

    args = parser.parse_args()

    if args.test_connection:
        run_test_connection()
    else:
        generate_report(date_preset=args.range, as_json=args.json)

if __name__ == "__main__":
    main()
