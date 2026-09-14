#!/usr/bin/env node
// Server MCP locale per Google Ads (lettura) e Meta Ads (lettura + scrittura
// guardata: dryRun di default, budget cappato, log mutazioni) del progetto
// Natango. Nessun tool restituisce token/segreti nella risposta.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { googleCampaignReport, googleConversionReport, googleCampaignDiagnosis } from "./googleAds.js";
import { metaCampaignInsights, metaAdsStatus } from "./meta.js";
import {
  metaAdsetDetails,
  metaListAdsets,
  metaUpdateAdset,
  metaSetStatus,
  metaDuplicateAdset,
  metaUpdateAdLink,
} from "./metaWrite.js";

const server = new McpServer({
  name: "natango-ads-mcp",
  version: "0.1.0",
});

function toolResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Errore: ${message}` }],
  };
}

server.registerTool(
  "google_campaign_report",
  {
    title: "Report performance campagne Google Ads",
    description:
      "Legge metriche di performance (impression, click, costo, CTR, CPC medio, conversioni) per le campagne Google Ads. Sola lettura.",
    inputSchema: {
      customerId: z.string().optional().describe("Customer ID (default: account configurato)"),
      campaignId: z.string().optional().describe("Filtra su una singola campagna"),
      dateRange: z
        .string()
        .optional()
        .describe("Es. LAST_7_DAYS, LAST_30_DAYS, THIS_MONTH, LAST_MONTH, YESTERDAY (default LAST_7_DAYS)"),
    },
  },
  async (args) => {
    try {
      return toolResult(await googleCampaignReport(args));
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "google_conversion_report",
  {
    title: "Report conversioni Google Ads",
    description:
      "Legge conversioni e valore conversioni per campagna e azione di conversione. Sola lettura.",
    inputSchema: {
      customerId: z.string().optional().describe("Customer ID (default: account configurato)"),
      dateRange: z
        .string()
        .optional()
        .describe("Es. LAST_7_DAYS, LAST_30_DAYS, THIS_MONTH, LAST_MONTH (default LAST_30_DAYS)"),
    },
  },
  async (args) => {
    try {
      return toolResult(await googleConversionReport(args));
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "google_campaign_diagnosis",
  {
    title: "Diagnosi mancata erogazione campagna Google Ads",
    description:
      "Spiega perché una campagna Google Ads non sta erogando impression (primary_status e motivi espliciti di Google), più date di inizio/fine e stato di erogazione. Utile quando una campagna ENABLED mostra 0 impression. Sola lettura.",
    inputSchema: {
      customerId: z.string().optional().describe("Customer ID (default: account configurato)"),
      campaignId: z.string().optional().describe("Filtra su una singola campagna; se omesso, tutte tranne le rimosse"),
    },
  },
  async (args) => {
    try {
      return toolResult(await googleCampaignDiagnosis(args));
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "meta_campaign_insights",
  {
    title: "Insight performance campagne Meta Ads",
    description:
      "Legge impression, click, spesa, CTR, CPC, reach e azioni (conversioni) per una campagna Meta o per l'intero ad account. Sola lettura.",
    inputSchema: {
      campaignId: z.string().optional().describe("ID campagna Meta; se omesso, rollup per campagna sull'intero ad account"),
      datePreset: z
        .string()
        .optional()
        .describe("Es. today, yesterday, last_7d, last_14d, last_30d, this_month, last_month (default last_7d)"),
    },
  },
  async (args) => {
    try {
      return toolResult(await metaCampaignInsights(args));
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "meta_ads_status",
  {
    title: "Stato account e campagne Meta Ads",
    description:
      "Legge stato dell'ad account (budget, saldo, valuta) e stato effettivo di ciascuna campagna (attiva, in pausa, ecc.). Include i giorni residui alla scadenza del token, se configurata. Sola lettura.",
    inputSchema: {
      includeCampaigns: z.boolean().optional().describe("Includi l'elenco campagne con stato (default true)"),
    },
  },
  async (args) => {
    try {
      return toolResult(await metaAdsStatus(args));
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ---------------------------------------------------------------------
// TOOL DI SCRITTURA META — dryRun=true di default, budget cappato, log.
// ---------------------------------------------------------------------

const wrap = (fn: (args: any) => Promise<unknown>) => async (args: any) => {
  try {
    return toolResult(await fn(args));
  } catch (err) {
    return errorResult(err);
  }
};

server.registerTool(
  "meta_adset_list",
  {
    title: "Elenco gruppi di inserzioni Meta",
    description: "Elenca gli adset (id, stato, budget, date, targeting) dell'account o di una campagna. Sola lettura.",
    inputSchema: { campaignId: z.string().optional().describe("Se omesso, tutti gli adset dell'ad account") },
  },
  wrap((a) => metaListAdsets(a.campaignId))
);

server.registerTool(
  "meta_adset_details",
  {
    title: "Dettaglio gruppo di inserzioni Meta",
    description: "Legge budget, date, stato e targeting completo di un adset. Sola lettura; usalo prima di ogni modifica.",
    inputSchema: { adsetId: z.string() },
  },
  wrap((a) => metaAdsetDetails(a.adsetId))
);

server.registerTool(
  "meta_adset_update",
  {
    title: "Modifica gruppo di inserzioni Meta (SCRITTURA)",
    description:
      "Aggiorna nome, stato, budget giornaliero, data di fine e/o raggio geografico (Roma centro, location_types=home) di un adset. " +
      "dryRun=true (default) restituisce before+payload senza scrivere. Budget oltre META_MAX_DAILY_BUDGET viene rifiutato. " +
      "NB: Meta non consente di modificare start_time né di riaprire un adset già scaduto: in quel caso usa meta_adset_duplicate.",
    inputSchema: {
      adsetId: z.string(),
      name: z.string().optional(),
      status: z.enum(["ACTIVE", "PAUSED"]).optional(),
      dailyBudget: z.number().optional().describe("Unità piena, es. 5 = 5,00 €"),
      endTime: z.string().optional().describe("ISO 8601 con offset, es. 2026-10-31T23:59:00+0100"),
      geoRadiusKm: z.number().optional().describe("Raggio in km attorno a Roma centro (1-80)"),
      dryRun: z.boolean().optional().describe("Default true. Passa false per scrivere davvero."),
    },
  },
  wrap(metaUpdateAdset)
);

server.registerTool(
  "meta_set_status",
  {
    title: "Attiva/pausa campagna, adset o ad Meta (SCRITTURA)",
    description: "Imposta status ACTIVE o PAUSED su una campagna, un adset o un'inserzione. dryRun=true di default.",
    inputSchema: {
      objectId: z.string().describe("ID campagna, adset o ad"),
      status: z.enum(["ACTIVE", "PAUSED"]),
      dryRun: z.boolean().optional(),
    },
  },
  wrap((a) => metaSetStatus(a.objectId, a.status, a.dryRun ?? true))
);

server.registerTool(
  "meta_adset_duplicate",
  {
    title: "Duplica gruppo di inserzioni Meta con le sue inserzioni (SCRITTURA)",
    description:
      "Copia un adset (deep copy, incluse le ads) con nuovo nome, date, budget e geo (Roma centro + raggio, location_types=home). " +
      "La copia nasce PAUSED; activate=true la attiva a fine procedura. dryRun=true (default) mostra il piano in 3 step senza eseguirlo. " +
      "È la via corretta per riaprire una campagna scaduta.",
    inputSchema: {
      sourceAdsetId: z.string(),
      name: z.string(),
      startTime: z.string().optional().describe("ISO 8601 con offset; default: subito"),
      endTime: z.string().describe("ISO 8601 con offset"),
      dailyBudget: z.number().optional().describe("Unità piena; default: quello dell'originale"),
      geoRadiusKm: z.number().optional().describe("Default: raggio dell'originale (o 12)"),
      activate: z.boolean().optional(),
      dryRun: z.boolean().optional(),
    },
  },
  wrap(metaDuplicateAdset)
);

server.registerTool(
  "meta_ad_update_link",
  {
    title: "Cambia landing page di un'inserzione Meta (SCRITTURA)",
    description:
      "Crea una nuova creative con il link aggiornato e la assegna all'ad (le creative Meta sono immutabili). " +
      "Supporta solo ads single image/video con object_story_spec.link_data. dryRun=true di default.",
    inputSchema: {
      adId: z.string(),
      newUrl: z.string().url(),
      dryRun: z.boolean().optional(),
    },
  },
  wrap((a) => metaUpdateAdLink(a.adId, a.newUrl, a.dryRun ?? true))
);

const transport = new StdioServerTransport();
await server.connect(transport);
