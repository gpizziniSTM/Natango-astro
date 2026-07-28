import { resolveGoogleAdsTargetingConstants } from '../src/lib/googleAdsConfig.js';

const result = await resolveGoogleAdsTargetingConstants([
  'Frascati',
  'Grottaferrata',
  'Marino',
  'Albano Laziale',
]);

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
