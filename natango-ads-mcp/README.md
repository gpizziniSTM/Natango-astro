# natango-ads-mcp

Server MCP locale per gestire da Claude le campagne Google Ads (lettura) e
Meta Ads (lettura + **scrittura guardata**) di Accademia Natango. Implementa la soluzione
"adattata ai tempi": usa le credenziali già esistenti così come sono, senza
attendere la creazione di credenziali dedicate read-only. I punti rimandati
sono tracciati in fondo a questo file come debito tecnico, con scadenza.

## Cosa espone

4 tool, tutti a sola lettura (nessuna mutate, nessuna scrittura verso le API):

- `google_campaign_report` — impression, click, costo, CTR, CPC medio, conversioni per campagna.
- `google_conversion_report` — conversioni e valore conversioni per campagna e azione di conversione.
- `meta_campaign_insights` — impression, click, spesa, CTR, CPC, reach, azioni per campagna Meta (o rollup account).
- `meta_ads_status` — stato account (budget, saldo, valuta), stato effettivo di ogni campagna, giorni residui alla scadenza del token.

Nessun tool restituisce Developer Token, chiave del service account o
System User Token: questi restano nei due file `.env` esistenti, letti solo
lato server per costruire le chiamate alle API.

## Tool di scrittura Meta (set 2026)

Tutti con `dryRun=true` di default: restituiscono before + payload senza inviare
nulla. Serve `dryRun:false` esplicito per scrivere. Ogni scrittura reale finisce
in `mutations.jsonl` (gitignored) con before/after.

- `meta_adset_list` / `meta_adset_details` — lettura adset con targeting completo.
- `meta_adset_update` — nome, status, budget giornaliero, end_time, raggio geo (Roma centro, `location_types=home`).
- `meta_set_status` — ACTIVE/PAUSED su campagna, adset o ad.
- `meta_adset_duplicate` — deep copy (con ads) + nome/date/budget/geo; unica via per riaprire un adset scaduto (Meta rifiuta di cambiare `start_time`).
- `meta_ad_update_link` — nuova creative con link aggiornato (solo `object_story_spec.link_data`).

Guardrail: `META_MAX_DAILY_BUDGET` (default 10, unità piena) rifiuta budget superiori;
il geo viene sempre riscritto con almeno un luogo. Dopo ogni build va riavviato
Claude Desktop per ricaricare i tool.

## Setup

```bash
cd natango-ads-mcp
npm install
npm run build
```

Prima di avviarlo, **correggi i permessi del file Meta**, se non l'hai già fatto:

```bash
chmod 600 /Users/gius/Documents/Natango/.env
```

Il server carica automaticamente:

- `/Users/gius/.config/natango/google-ads.env`
- `/Users/gius/Documents/Natango/.env`

(percorsi già in uso nel progetto). Se in futuro li sposti, sovrascrivi i
default con le variabili d'ambiente `GOOGLE_ADS_ENV_FILE` e `META_ENV_FILE`
nella configurazione di Claude Desktop (vedi sotto). In `config/` trovi due
file `.env.example` come riferimento per le variabili attese.

**Facoltativo ma consigliato**: aggiungi al file Meta `.env` la variabile

```
META_TOKEN_EXPIRES_AT=2026-09-19T18:14:00+02:00
```

così `meta_ads_status` mostra sempre i giorni residui alla scadenza del token
direttamente in chat.

## Collegare il server a Claude Desktop

Nel file di configurazione di Claude Desktop (`claude_desktop_config.json`),
aggiungi:

```json
{
  "mcpServers": {
    "natango-ads": {
      "command": "node",
      "args": ["/percorso/assoluto/a/natango-ads-mcp/dist/index.js"]
    }
  }
}
```

Riavvia Claude Desktop. I 4 tool compariranno automaticamente in chat.

## Verifica rapida

Puoi testare il server da terminale, senza Claude, con l'MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Debito tecnico tracciato (rimandato con la scelta "adattata ai tempi")

Questi 3 punti erano stati identificati in fase di review e volutamente
**non** risolti ora per dare priorità ai tempi. Vanno chiusi entro il
**19 settembre 2026** (scadenza dell'attuale token Meta), idealmente prima:

1. **Google Ads — access level del service account non ancora ridotto a "Solo lettura"**
   Nel MCC (`7636248470`) → Accesso e sicurezza, il service account
   `natango-google-ads@planar-chassis-503208-f6.iam.gserviceaccount.com`
   ha oggi accesso Standard/Admin (da verificare quale). Questo server non
   esegue mutate, ma le credenziali potrebbero farlo se riusate altrove.
   Azione: impostare il livello "Solo lettura" per quel service account
   sull'account cliente.

2. **Meta — System User attuale non è dedicato al monitoraggio**
   Il token in uso (`Conversions API System User`, ID `122215925906049664`)
   ha permessi `ads_management` + `business_management`, non solo
   `ads_read`. Azione: creare un secondo System User con ruolo *Employee* e
   permesso *Analyst / View performance* sull'ad account
   `act_1088446485620774`, generare un token dedicato e sostituirlo nel
   file `.env` usato da questo server.

3. **Meta — token con scadenza invece che "Never"**
   Il token attuale scade il 19/9/2026 18:14 (ora italiana). Azione: alla
   creazione del nuovo System User dedicato (punto 2), generare il token con
   scadenza **Never** per evitare un'interruzione silenziosa del
   monitoraggio.

Nessuna azione richiesta invece sul Developer Token Google Ads: è già
funzionante; resta da confermare solo il livello (Basic/Standard) nel Centro
API, utile a sapere se il tetto di 15.000 operazioni/giorno è un vincolo
reale per voi.
