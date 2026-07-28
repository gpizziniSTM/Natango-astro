import { readFile } from 'node:fs/promises';
import {
  GOOGLE_CAMPAIGN_UPDATE_TARGETS,
  mutatePausedGoogleCampaignUpdate,
} from '../src/lib/googleAdsCampaignUpdate.js';

const execute = process.argv.includes('--execute');
const approval = JSON.parse(await readFile('google-dry-runs/campaign-update-approval.json', 'utf8'));
const approvalMatches =
  approval.approved === true &&
  approval.scope === 'update_existing_search_campaign_paused' &&
  approval.accountId === '6934226615' &&
  approval.campaignId === GOOGLE_CAMPAIGN_UPDATE_TARGETS.campaignId &&
  approval.allowsCampaignUpdatePaused === true &&
  approval.allowsCampaignEnable === false &&
  approval.changes?.startDate === '2026-07-22' &&
  approval.changes?.dailyBudgetEur === 3 &&
  approval.changes?.courseTime === '20:00-21:00' &&
  approval.changes?.adSchedule === '07:00-23:00 unchanged';

if (!approvalMatches) {
  console.error(JSON.stringify({ ok: false, error: 'Approvazione aggiornamento campagna assente o non coerente.' }, null, 2));
  process.exit(1);
}

const result = await mutatePausedGoogleCampaignUpdate({ validateOnly: !execute });
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
