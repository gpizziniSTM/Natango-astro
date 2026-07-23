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
    if n.get("name") == "Verifica Whitelist 3 Numeri" or n.get("id") == "node-filter":
        n["parameters"]["jsCode"] = """
const body = $input.item.json.body || $input.item.json;
const data = body.data || body;

let rawSender = data.key?.remoteJid || data.sender || data.from || body.sender || '';
if (!rawSender && body.entry && body.entry[0]?.changes && body.entry[0].changes[0]?.value?.messages) {
  rawSender = body.entry[0].changes[0].value.messages[0].from || '';
}

let sender = rawSender.replace(/@.*$/, '').replace(/[^0-9]/g, '');

if (sender.length === 10 && !sender.startsWith('39')) {
  sender = '39' + sender;
}

const whitelist = ['393933323270', '3933323270', '393392737619', '393494486269'];
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
        print("✅ WORKFLOW N8N AGGIORNATO CON WHITELIST RIFINITA!")
        
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
