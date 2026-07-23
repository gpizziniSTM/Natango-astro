#!/usr/bin/env python3
import urllib.request
import json

api_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjNTVmOTA0Yi1hNGJiLTQwOTYtOWMzNy1kZjk2YzhmZDJmZDMiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNGVmZGRiMmQtNmM4My00OWUyLTlmNjEtMjg4YWVkN2M0MWJiIiwiaWF0IjoxNzg0Nzk1NTA1fQ.CwCYrUjPC1rAVQNd_cpgHBWK9CZuBrKp6riwfldiAa8"
wf_id = "vRunXUeKp9ikTdkF"

token = "EAAWYCFZBRem8BSAqFtQVBcpNN5bF9OAlMFsChrwe9V2J5xZCEigJLP0oqmiYT9UiY7QmGp3L0ltPthosRgePkOaMGQL2iU8jiIi2kOqVgJYMPtif27YnORSCtmyWB4p12fdlRyMBN1UZBL9ZBFMibn1lYjttZAOgBXHrVnmphFIB3J9FQcbFQGvkAqNylLbXvVwZDZD"
phone_number_id = "1243463512184066"

url = f"https://n8n.bestengage.net/api/v1/workflows/{wf_id}"
req = urllib.request.Request(url, headers={"X-N8N-API-KEY": api_key})

with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read().decode("utf-8"))

nodes = wf.get("nodes", [])
for n in nodes:
    if n.get("name") in ["Meta WhatsApp · Invia Risposta", "Evolution · Invia Risposta"] or n.get("id") == "node-send":
        n["name"] = "Meta WhatsApp · Invia Risposta"
        n["type"] = "n8n-nodes-base.httpRequest"
        n["parameters"] = {
            "method": "POST",
            "url": f"https://graph.facebook.com/v20.0/{phone_number_id}/messages",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {
                        "name": "Authorization",
                        "value": f"Bearer {token}"
                    },
                    {
                        "name": "Content-Type",
                        "value": "application/json"
                    }
                ]
            },
            "sendBody": True,
            "contentType": "raw",
            "rawContentType": "application/json",
            "body": "={{ JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: $json.chatId, type: 'text', text: { preview_url: false, body: $json.formatted_message } }) }}",
            "options": {}
        }

wf_update_url = f"https://n8n.bestengage.net/api/v1/workflows/{wf_id}"
update_data = {
    "name": wf.get("name"),
    "nodes": nodes,
    "connections": wf.get("connections"),
    "settings": wf.get("settings", {"executionOrder": "v1"})
}

req_up = urllib.request.Request(wf_update_url, data=json.dumps(update_data).encode("utf-8"), headers={"X-N8N-API-KEY": api_key, "Content-Type": "application/json"}, method="PUT")

try:
    with urllib.request.urlopen(req_up) as resp_up:
        print("✅ WORKFLOW N8N AGGIORNATO CON IL TOKEN PERMANENTE E PHONE NUMBER ID!")
        
        # Riattiviamo il workflow
        act_url = f"https://n8n.bestengage.net/api/v1/workflows/{wf_id}/activate"
        req_act = urllib.request.Request(act_url, data=b"{}", headers={"X-N8N-API-KEY": api_key, "Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req_act) as act_resp:
            print("⚡ WORKFLOW RIATTIVATO SU N8N!")
except Exception as e:
    if hasattr(e, "read"):
        print("ERR:", e.read().decode("utf-8"))
    else:
        print("ERR:", e)
