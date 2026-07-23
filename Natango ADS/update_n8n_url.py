#!/usr/bin/env python3
import urllib.request
import json

api_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjNTVmOTA0Yi1hNGJiLTQwOTYtOWMzNy1kZjk2YzhmZDJmZDMiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNGVmZGRiMmQtNmM4My00OWUyLTlmNjEtMjg4YWVkN2M0MWJiIiwiaWF0IjoxNzg0Nzk1NTA1fQ.CwCYrUjPC1rAVQNd_cpgHBWK9CZuBrKp6riwfldiAa8"
wf_id = "vRunXUeKp9ikTdkF"

url = f"https://n8n.bestengage.net/api/v1/workflows/{wf_id}"
req = urllib.request.Request(url, headers={"X-N8N-API-KEY": api_key})

with urllib.request.urlopen(req) as resp:
    wf = json.loads(resp.read().decode("utf-8"))

nodes = wf.get("nodes", [])
for n in nodes:
    if n.get("name") == "Chiama API Natango ADS" or n.get("id") == "node-api":
        n["parameters"]["url"] = "https://www.natango.org/api/ads-report"
        n["parameters"]["method"] = "GET"

connections = {
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
        "main": [[{"node": "Meta WhatsApp · Invia Risposta", "type": "main", "index": 0}]]
    }
}

wf_update_url = f"https://n8n.bestengage.net/api/v1/workflows/{wf_id}"
update_data = {
    "name": wf.get("name"),
    "nodes": nodes,
    "connections": connections,
    "settings": wf.get("settings", {"executionOrder": "v1"})
}

req_up = urllib.request.Request(wf_update_url, data=json.dumps(update_data).encode("utf-8"), headers={"X-N8N-API-KEY": api_key, "Content-Type": "application/json"}, method="PUT")

try:
    with urllib.request.urlopen(req_up) as resp_up:
        print("✅ WORKFLOW N8N AGGIORNATO CON CONNESSIONI NODI CORRETTE!")
        
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
