import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createValidatedGoogleDryRun } from '../src/lib/googleAdsPlan.js';

let previousPlan = null;
try {
  previousPlan = JSON.parse(await readFile('google-dry-runs/campaign-plan.json', 'utf8'));
} catch {
  previousPlan = null;
}

const result = createValidatedGoogleDryRun(previousPlan);

if (!result.ok) {
  console.error(JSON.stringify({ ok: false, errors: result.errors }, null, 2));
  process.exitCode = 1;
} else {
  await mkdir('google-dry-runs', { recursive: true });
  await writeFile('google-dry-runs/campaign-plan.json', `${JSON.stringify(result.plan, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    ok: true,
    path: 'google-dry-runs/campaign-plan.json',
    writeCallsMade: false,
    readyForHumanReview: true,
    readyForGoogleCreate: false,
    approvalPreserved: result.plan.approval?.approved === true,
  }, null, 2));
}
