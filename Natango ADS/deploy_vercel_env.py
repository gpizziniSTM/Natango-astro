#!/usr/bin/env python3
import os
import subprocess
import json
from pathlib import Path

# Carica .env.local
env_path = Path(__file__).resolve().parent.parent / ".env.local"
env_vars = {}
if env_path.exists():
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env_vars[k.strip()] = v.strip().strip('"').strip("'")

# Legge il file del Service Account JSON
sa_path = Path("/Users/gius/.config/natango/google-ads-service-account.json")
sa_json_raw = ""
if sa_path.exists():
    sa_json_raw = sa_path.read_text(encoding="utf-8")

vars_to_push = {
    "META_ADS_ACCESS_TOKEN": env_vars.get("META_ADS_ACCESS_TOKEN", ""),
    "META_ADS_ACCOUNT_ID": env_vars.get("META_ADS_ACCOUNT_ID", ""),
    "GOOGLE_ADS_DEVELOPER_TOKEN": env_vars.get("GOOGLE_ADS_DEVELOPER_TOKEN", ""),
    "GOOGLE_ADS_CUSTOMER_ID": env_vars.get("GOOGLE_ADS_CUSTOMER_ID", ""),
    "GOOGLE_ADS_LOGIN_CUSTOMER_ID": env_vars.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", ""),
    "GOOGLE_ADS_SERVICE_ACCOUNT_JSON_CONTENT": sa_json_raw,
    "NATANGO_ADS_API_KEY": env_vars.get("NATANGO_ADS_API_KEY", "natango_ads_secret_key_2026")
}

project_dir = str(Path(__file__).resolve().parent.parent)

print("[+] Inizio caricamento variabili d'ambiente su Vercel...")

for name, val in vars_to_push.items():
    if not val:
        print(f"⚠️ Salto {name} (valore vuoto)")
        continue
    
    # Rimuove prima la variabile se esiste già su Vercel per evitare duplicati
    subprocess.run(f"npx vercel env rm {name} production -y", shell=True, cwd=project_dir, capture_output=True)
    
    # Aggiunge la variabile d'ambiente per il target 'production' e 'preview'
    cmd = f"npx vercel env add {name} production"
    p = subprocess.Popen(cmd, shell=True, cwd=project_dir, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    out, err = p.communicate(input=val)
    if p.returncode == 0:
        print(f"✅ Variabile {name} caricata su Vercel!")
    else:
        print(f"❌ Errore caricamento {name}: {err or out}")

print("\n[+] Esecuzione Deployment finale su Vercel...")
dep_cmd = "npx vercel deploy --prod --yes"
p_dep = subprocess.run(dep_cmd, shell=True, cwd=project_dir, capture_output=True, text=True)
print("Output Deployment Vercel:")
print(p_dep.stdout)
if p_dep.stderr:
    print("Stderr:", p_dep.stderr)
