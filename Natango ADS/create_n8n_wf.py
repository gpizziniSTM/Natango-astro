#!/usr/bin/env python3
import urllib.request
import json

api_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjNTVmOTA0Yi1hNGJiLTQwOTYtOWMzNy1kZjk2YzhmZDJmZDMiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNGVmZGRiMmQtNmM4My00OWUyLTlmNjEtMjg4YWVkN2M0MWJiIiwiaWF0IjoxNzg0Nzk1NTA1fQ.CwCYrUjPC1rAVQNd_cpgHBWK9CZuBrKp6riwfldiAa8"
url = "https://n8n.bestengage.net/api/v1/workflows"

# 1. Recupero lista credenziali per trovare quella di Evolution API
creds_url = "https://n8n.bestengage.net/api/v1/credentials"
req_creds = urllib.request.Request(creds_url, headers={"X-N8N-API-KEY": api_key})
evo_cred_id = None
try:
    with urllib.request.urlopen(req_creds) as resp:
        c_data = json.loads(resp.read().decode("utf-8"))
        for c in c_data.get("data", []):
            if "evolution" in c.get("name", "").lower() or "header" in c.get("name", "").lower():
                evo_cred_id = c.get("id")
                print(f"Trovata credenziale: {c.get('name')} ({evo_cred_id})")
                break
except Exception as e:
    print("Nota credenziali:", e)

wf_data = {
    "name": "Natango ADS — WhatsApp Bot (3 Numeri Autorizzati)",
    "settings": {
        "executionOrder": "v1"
    },
    "nodes": [
        {
            "parameters": {
                "httpMethod": "POST",
                "path": "natango-ads-whatsapp-webhook",
                "options": {}
            },
            "id": "node-webhook",
            "name": "Webhook WhatsApp / Evolution",
            "type": "n8n-nodes-base.webhook",
            "typeVersion": 1,
            "position": [100, 300]
        },
        {
            "parameters": {
                "jsCode": """
const body = $input.item.json.body || $input.item.json;
const data = body.data || body;

let rawSender = data.key?.remoteJid || data.sender || data.from || body.sender || '';
let sender = rawSender.replace(/@.*$/, '').replace(/[^0-9]/g, '');

if (sender.length === 10 && !sender.startsWith('39')) {
  sender = '39' + sender;
}

const whitelist = ['3933323270', '393392737619', '393494486269'];
const isAuthorized = whitelist.includes(sender);

const text = (data.message?.conversation || data.message?.extendedTextMessage?.text || data.text || body.text || '').toLowerCase();

return [{
  json: {
    sender: sender,
    rawSender: rawSender,
    isAuthorized: isAuthorized,
    text: text
  }
}];
"""
            },
            "id": "node-filter",
            "name": "Verifica Whitelist 3 Numeri",
            "type": "n8n-nodes-base.code",
            "typeVersion": 1,
            "position": [320, 300]
        },
        {
            "parameters": {
                "conditions": {
                    "boolean": [
                        {
                            "value1": "={{ $json.isAuthorized }}",
                            "value2": True
                        }
                    ]
                }
            },
            "id": "node-if",
            "name": "Is Authorized?",
            "type": "n8n-nodes-base.if",
            "typeVersion": 1,
            "position": [540, 300]
        },
        {
            "parameters": {
                "method": "POST",
                "url": "https://natango-astro.vercel.app/api/ads-report",
                "sendHeaders": True,
                "headerParameters": {
                    "parameters": [
                        {
                            "name": "x-api-key",
                            "value": "natango_ads_secret_key_2026"
                        }
                    ]
                },
                "options": {}
            },
            "id": "node-api",
            "name": "Chiama API Natango ADS",
            "type": "n8n-nodes-base.httpRequest",
            "typeVersion": 3,
            "position": [760, 200]
        },
        {
            "parameters": {
                "jsCode": """
const data = $input.item.json;
const s = data.summary || {};

let msg = `📊 *REPORT ADS ACCADEMIA NATANGO*\\n\\n`;
msg += `💰 *Spesa Totale:* € ${s.total_spend_eur || 0}\\n`;
msg += `👀 *Impression:* ${s.total_impressions || 0}\\n`;
msg += `🎯 *Clic Totali:* ${s.total_clicks || 0}\\n`;
msg += `📈 *CTR Medio:* ${s.overall_ctr_pct || 0}%\\n`;
msg += `🏷️ *CPC Medio:* € ${s.overall_cpc_eur || 0}\\n`;
msg += `✅ *Conversioni:* ${s.total_conversions || 0}\\n\\n`;

msg += `🔷 *META ADS:* € ${data.meta_ads?.summary?.total_spend_eur || 0} (${data.meta_ads?.summary?.total_clicks || 0} clic)\\n`;
msg += `🟢 *GOOGLE ADS:* € ${data.google_ads?.summary?.total_spend_eur || 0} (${data.google_ads?.summary?.total_clicks || 0} clic)`;

const sender = $node['Verifica Whitelist 3 Numeri'].json.sender;

return [{
  json: {
    formatted_message: msg,
    chatId: sender
  }
}];
"""
            },
            "id": "node-format",
            "name": "Formatta Messaggio WhatsApp",
            "type": "n8n-nodes-base.code",
            "typeVersion": 1,
            "position": [980, 200]
        },
        {
            "parameters": {
                "method": "POST",
                "url": "http://evolution:8080/message/sendText/tanguedia-test",
                "sendBody": True,
                "contentType": "raw",
                "rawContentType": "application/json",
                "body": "={{ JSON.stringify({ number: $json.chatId, text: $json.formatted_message }) }}",
                "options": {
                    "timeout": 30000
                }
            },
            "id": "node-send",
            "name": "Evolution · Invia Risposta",
            "type": "n8n-nodes-base.httpRequest",
            "typeVersion": 3,
            "position": [1200, 200]
        }
    ],
    "connections": {
        "Webhook WhatsApp / Evolution": {
            "main": [[{"node": "Verifica Whitelist 3 Numeri", "type": "main", "index": 0}]]
        },
        "Verifica Whitelist 3 Numeri": {
            "main": [[{"node": "Is Authorized?", "type": "main", "index": 0}]]
        },
        "Is Authorized?": {
            "main": [[{"node": "Chiama API Natango ADS", "type": "main", "index": 0}]]
        },
        "Chiama API Natango ADS": {
            "main": [[{"node": "Formatta Messaggio WhatsApp", "type": "main", "index": 0}]]
        },
        "Formatta Messaggio WhatsApp": {
            "main": [[{"node": "Evolution · Invia Risposta", "type": "main", "index": 0}]]
        }
    }
}

req_data = json.dumps(wf_data).encode("utf-8")
req = urllib.request.Request(url, data=req_data, headers={"X-N8N-API-KEY": api_key, "Content-Type": "application/json"}, method="POST")

try:
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        wf_id = res.get("id")
        print("✅ WORKFLOW CREATO CON SUCCESSO SU N8N!")
        print(f"ID Workflow: {wf_id}")
        print(f"Nome: {res.get('name')}")
        
        # Attiviamo il workflow
        act_url = f"https://n8n.bestengage.net/api/v1/workflows/{wf_id}/activate"
        req_act = urllib.request.Request(act_url, data=b"{}", headers={"X-N8N-API-KEY": api_key, "Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req_act) as act_resp:
                print("⚡ WORKFLOW ATTIVATO CON SUCCESSO SU N8N!")
        except Exception as e_act:
            print("Nota attivazione:", e_act)
except Exception as e:
    if hasattr(e, "read"):
        print("ERR:", e.read().decode("utf-8"))
    else:
        print("ERR:", e)
