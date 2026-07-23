# Natango ADS - Connettore API Meta Ads & Google Ads

Modulo di integrazione locale per **Antigravity** e per l'Accademia Natango per il monitoraggio e la gestione automatica delle campagne pubblicitarie su **Meta Ads** (Facebook / Instagram) e **Google Ads**.

---

## 📁 Struttura della Cartella

- `meta_ads.py`: Connettore alla Meta Marketing API (Graph API).
- `google_ads.py`: Connettore alla Google Ads REST API (GAQL queries).
- `check_campaigns.py`: CLI Dashboard consolidata che unifica i dati di Meta e Google.
- `requirements.txt`: Dipendenze Python opzionali (`requests`, `python-dotenv`).

---

## ⚙️ Configurazione (.env.local)

Aggiungi o compila le seguenti variabili nel file `.env.local` presente nella radice del progetto:

```env
# ===============================================
# META ADS API (Facebook / Instagram Marketing API)
# ===============================================
META_ADS_ACCESS_TOKEN="il_tuo_access_token_meta"
META_ADS_ACCOUNT_ID="act_XXXXXXXXXXXXX"
META_ADS_API_VERSION="v20.0"

# ===============================================
# GOOGLE ADS API
# ===============================================
GOOGLE_ADS_DEVELOPER_TOKEN="il_tuo_developer_token"
GOOGLE_ADS_CLIENT_ID="il_tuo_client_id_oauth"
GOOGLE_ADS_CLIENT_SECRET="il_tuo_client_secret_oauth"
GOOGLE_ADS_REFRESH_TOKEN="il_tuo_refresh_token"
GOOGLE_ADS_CUSTOMER_ID="1234567890" # 10 cifre senza trattini
GOOGLE_ADS_LOGIN_CUSTOMER_ID=""     # Opzionale se usi un Manager Account (MCC)
```

---

## 🚀 Utilizzo da Riga di Comando

### 1. Verifica diagnostica della connessione
```bash
python3 "Natango ADS/check_campaigns.py" --test-connection
```

### 2. Genera Report (Default: ultimi 7 giorni)
```bash
python3 "Natango ADS/check_campaigns.py"
```

### 3. Report per periodo personalizzato
Supporta: `today`, `yesterday`, `last_7d`, `last_30d`, `this_month`, `last_month`.
```bash
python3 "Natango ADS/check_campaigns.py" --range last_30d
```

### 4. Output in formato JSON
```bash
python3 "Natango ADS/check_campaigns.py" --range last_7d --json
```

---

## 💬 Utilizzo con Antigravity

Una volta inseriti i token in `.env.local`, ti basterà chiedere in chat:
- *"Come stanno andando le campagne Natango negli ultimi 7 giorni?"*
- *"Quanto stiamo spendendo su Meta Ads e Google Ads?"*
- *"Fammi un report complessivo delle ADS Natango del mese."*

Antigravity eseguirà automaticamente gli script e ti risponderà analizzando i dati reali in tempo reale.
