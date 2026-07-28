import { readFile } from 'node:fs/promises';
import {
  GOOGLE_LEAD_CONVERSION_NAME,
  GOOGLE_OUTBOUND_ACTION_IDS_TO_DEMOTE,
  mutateGoogleAdsConversionSetup,
} from '../src/lib/googleAdsConfig.js';

const execute = process.argv.includes('--execute');
const approvalPath = 'google-dry-runs/conversion-setup-approval.json';
const approval = JSON.parse(await readFile(approvalPath, 'utf8'));
const expectedScope = 'create_website_lead_and_demote_three_outbound_click_actions';
const approvalMatches =
  approval.approved === true &&
  approval.scope === expectedScope &&
  approval.accountId === '6934226615' &&
  approval.allowsConversionSetupWrite === true &&
  approval.allowsCampaignCreate === false &&
  approval.allowsCampaignEnable === false &&
  approval.operations?.create?.length === 1 &&
  approval.operations.create[0] === GOOGLE_LEAD_CONVERSION_NAME &&
  JSON.stringify(approval.operations?.updateToSecondary) === JSON.stringify(GOOGLE_OUTBOUND_ACTION_IDS_TO_DEMOTE);

if (!approvalMatches) {
  console.error(JSON.stringify({ ok: false, error: 'Approvazione conversioni assente o non coerente.' }, null, 2));
  process.exit(1);
}

const result = await mutateGoogleAdsConversionSetup({ validateOnly: !execute });
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
