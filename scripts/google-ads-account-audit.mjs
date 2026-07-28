import { runGoogleAdsAccountAudit } from '../src/lib/googleAdsConfig.js';

const result = await runGoogleAdsAccountAudit();
console.log(JSON.stringify(result, null, 2));

if (!result.ok) process.exitCode = 1;
