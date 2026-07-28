import { readFile } from 'node:fs/promises';
import { runGoogleAdsAtomicMutate, runGoogleAdsQuery } from '../src/lib/googleAdsConfig.js';

const execute = process.argv.includes('--execute');
const approval = JSON.parse(await readFile('google-dry-runs/campaign-removal-approval.json', 'utf8'));
const target = {
  accountId: '6934226615',
  campaignId: '23361550943',
  campaignName: 'Natango Principianti Gen26',
};
const approvalMatches =
  approval.approved === true &&
  approval.scope === 'permanently_remove_single_old_campaign' &&
  approval.accountId === target.accountId &&
  approval.campaignId === target.campaignId &&
  approval.campaignName === target.campaignName &&
  approval.allowsPermanentCampaignRemoval === true &&
  approval.allowsOtherCampaignChanges === false;

if (!approvalMatches) {
  console.error(JSON.stringify({ ok: false, error: 'Approvazione rimozione assente o non coerente.' }, null, 2));
  process.exit(1);
}

const response = await runGoogleAdsQuery([
  'SELECT campaign.resource_name, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type',
  'FROM campaign',
  `WHERE campaign.id = ${target.campaignId}`,
].join(' '));
const campaign = response.results?.[0]?.campaign;
const errors = [];

if (!campaign) errors.push('Campagna da rimuovere non trovata.');
if (String(campaign?.id || '') !== target.campaignId) errors.push('ID campagna inatteso.');
if (campaign?.name !== target.campaignName) errors.push('Nome campagna inatteso.');
if (campaign?.status !== 'PAUSED') errors.push('La campagna non e in pausa.');
if (campaign?.advertisingChannelType !== 'SEARCH') errors.push('Il tipo di campagna e inatteso.');

if (errors.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    validateOnly: !execute,
    errors,
    safety: { writeCallsMade: false, campaignRemovalCallsMade: false },
  }, null, 2));
  process.exit(1);
}

const result = await runGoogleAdsAtomicMutate([
  { campaignOperation: { remove: campaign.resourceName } },
], { validateOnly: !execute });

console.log(JSON.stringify({
  ...result,
  removal: {
    campaignId: target.campaignId,
    campaignName: target.campaignName,
    previousStatus: campaign.status,
    requestedStatus: 'REMOVED',
  },
  safety: {
    writeCallsMade: execute,
    campaignRemovalCallsMade: execute,
    campaignEnableCallsMade: false,
    otherCampaignChangesMade: false,
  },
}, null, 2));
