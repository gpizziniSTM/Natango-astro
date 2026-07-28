import { readFile } from 'node:fs/promises';
import { mutateGoogleCampaignActivation } from '../src/lib/googleAdsCampaignActivate.js';

const execute = process.argv.includes('--execute');
const approval = JSON.parse(await readFile('google-dry-runs/campaign-activation-approval.json', 'utf8'));
const approvalMatches =
  approval.approved === true &&
  approval.scope === 'enable_existing_approved_search_campaign' &&
  approval.accountId === '6934226615' &&
  approval.campaignId === '24061339564' &&
  approval.allowsCampaignEnable === true &&
  approval.dailyBudgetEur === 3 &&
  approval.expected?.campaigns === 1 &&
  approval.expected?.adGroups === 3 &&
  approval.expected?.keywords === 15 &&
  approval.expected?.responsiveSearchAds === 3 &&
  approval.expected?.allAdsApproved === true;

if (!approvalMatches) {
  console.error(JSON.stringify({ ok: false, error: 'Approvazione attivazione campagna assente o non coerente.' }, null, 2));
  process.exit(1);
}

const result = await mutateGoogleCampaignActivation({ validateOnly: !execute });
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
