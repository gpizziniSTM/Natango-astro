import { readFile } from 'node:fs/promises';
import {
  GOOGLE_PAUSED_CAMPAIGN_NAME,
  mutatePausedGoogleCampaign,
} from '../src/lib/googleAdsCampaignCreate.js';

const execute = process.argv.includes('--execute');
const approval = JSON.parse(await readFile('google-dry-runs/campaign-create-approval.json', 'utf8'));
const approvalMatches =
  approval.approved === true &&
  approval.scope === 'create_complete_search_campaign_paused' &&
  approval.accountId === '6934226615' &&
  approval.campaignName === GOOGLE_PAUSED_CAMPAIGN_NAME &&
  approval.allowsCampaignCreatePaused === true &&
  approval.allowsCampaignEnable === false &&
  approval.allowsBudgetChange === false &&
  approval.dailyBudgetEur === 8 &&
  approval.expected?.campaigns === 1 &&
  approval.expected?.adGroups === 3 &&
  approval.expected?.keywords === 15 &&
  approval.expected?.responsiveSearchAds === 3 &&
  approval.expected?.allServingObjectsPaused === true;

if (!approvalMatches) {
  console.error(JSON.stringify({ ok: false, error: 'Approvazione creazione campagna assente o non coerente.' }, null, 2));
  process.exit(1);
}

const result = await mutatePausedGoogleCampaign({ validateOnly: !execute });
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
