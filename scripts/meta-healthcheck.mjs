import { runMetaHealthCheck } from '../src/lib/metaAdsConfig.js';

const result = await runMetaHealthCheck();

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}
