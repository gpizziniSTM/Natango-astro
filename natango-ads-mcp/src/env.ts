// Caricamento e validazione della configurazione.
//
// I segreti NON vivono in questo repo: restano nei due file .env esistenti
// (permessi 600), i cui percorsi sono passati al processo come variabili
// d'ambiente non sensibili (GOOGLE_ADS_ENV_FILE / META_ENV_FILE). Questo
// server li legge una sola volta all'avvio e non li restituisce mai nelle
// risposte dei tool.

import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";

function loadEnvFile(pathEnvVar: string, defaultPath: string) {
  const path = process.env[pathEnvVar] ?? defaultPath;
  if (!existsSync(path)) {
    throw new Error(
      `File env non trovato per ${pathEnvVar}: ${path}. ` +
        `Imposta ${pathEnvVar} con il percorso corretto o verifica che il file esista.`
    );
  }
  loadDotenv({ path, override: false });
}

// Percorsi di default = quelli già in uso nel progetto Natango.
loadEnvFile("GOOGLE_ADS_ENV_FILE", "/Users/gius/.config/natango/google-ads.env");
loadEnvFile("META_ENV_FILE", "/Users/gius/Documents/Natango/.env");

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Variabile d'ambiente mancante: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

export const config = {
  google: {
    apiVersion: process.env.GOOGLE_ADS_API_VERSION ?? "v24",
    customerId: required("GOOGLE_ADS_CUSTOMER_ID"),
    loginCustomerId: required("GOOGLE_ADS_LOGIN_CUSTOMER_ID"),
    serviceAccountJson: required("GOOGLE_ADS_SERVICE_ACCOUNT_JSON"),
    developerToken: required("GOOGLE_ADS_DEVELOPER_TOKEN"),
  },
  meta: {
    apiVersion: process.env.META_GRAPH_API_VERSION ?? "v25.0",
    adAccountId: required("META_AD_ACCOUNT_ID"),
    accessToken: required("META_ACCESS_TOKEN"),
    // Facoltativa: se impostata, meta_ads_status calcola i giorni residui.
    // Formato ISO 8601, es. 2026-09-19T18:14:00+02:00
    tokenExpiresAt: optional("META_TOKEN_EXPIRES_AT"),
  },
};

// Guardia esplicita: nessun valore di config va mai incluso in un output
// di tool. Usare solo per costruire richieste verso le API esterne.
export function assertNeverLeak(_value: never): never {
  throw new Error("unreachable");
}
