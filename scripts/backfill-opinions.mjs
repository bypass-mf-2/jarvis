/**
 * Backfill opinions from the corrections table.
 *
 * Run with JARVIS server running on localhost:3000:
 *   pnpm exec node scripts/backfill-opinions.mjs            # dry run (default)
 *   pnpm exec node scripts/backfill-opinions.mjs --execute  # actually form
 *
 * The dry run shows exactly which topics qualify and how many corrections
 * each has. Always run dry first — the execute pass calls multiHopRetrieval
 * + smartChat per topic and can take 30-90 sec per opinion if you have
 * many qualifying topics.
 *
 * Idempotent: skips topics that already have an opinion (locked or not).
 * Re-running picks up the queue.
 */

const SERVER_URL = process.env.JARVIS_SERVER_URL ?? "http://localhost:3000";
const DRY_RUN = !process.argv.includes("--execute");
const MIN_CORRECTIONS = Number(process.env.MIN_CORRECTIONS ?? 2);
const MAX_TOPICS = Number(process.env.MAX_TOPICS ?? 50);

async function callTrpc(path, input) {
  const res = await fetch(`${SERVER_URL}/api/trpc/${path}?batch=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ "0": { json: input ?? {} } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`);
  const data = await res.json();
  if (data?.[0]?.error) {
    throw new Error(data[0].error?.json?.message ?? "tRPC error");
  }
  return data?.[0]?.result?.data?.json;
}

async function isServerUp() {
  try {
    const res = await fetch(SERVER_URL, { signal: AbortSignal.timeout(2_000) });
    return res.status > 0;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`\n────────────────────────────────────────────────────`);
  console.log(`  Opinion backfill from corrections`);
  console.log(`  Server: ${SERVER_URL}`);
  console.log(`  Mode:   ${DRY_RUN ? "DRY RUN (preview only)" : "EXECUTE (will form opinions)"}`);
  console.log(`  Min:    ${MIN_CORRECTIONS} corrections per topic`);
  console.log(`  Max:    ${MAX_TOPICS} topics this run`);
  console.log(`────────────────────────────────────────────────────\n`);

  if (!(await isServerUp())) {
    console.error(`✗ JARVIS server is not reachable at ${SERVER_URL}.`);
    console.error(`  Start it with \`pnpm dev\` from the project root, then rerun.`);
    process.exit(1);
  }

  // Step 1: count opinions BEFORE so we have a baseline
  let beforeCount = 0;
  try {
    const opinions = await callTrpc("opinions.list", { limit: 200 });
    beforeCount = Array.isArray(opinions) ? opinions.length : 0;
  } catch (err) {
    console.warn(`  (Couldn't read opinion count beforehand: ${String(err).slice(0, 80)})`);
  }
  console.log(`Opinions in DB before: ${beforeCount}`);

  // Step 2: run the backfill (dry first, regardless of flag)
  console.log(`\nRunning ${DRY_RUN ? "preview" : "DRY-RUN preview before live execution"}…`);
  const preview = await callTrpc("opinions.backfillFromCorrections", {
    dryRun: true,
    minCorrections: MIN_CORRECTIONS,
    maxTopics: MAX_TOPICS,
  });
  console.log(`\n  Total corrections in DB:    ${preview.totalCorrections}`);
  console.log(`  Distinct topics extracted:  ${preview.totalTopics}`);
  console.log(`  Topics meeting threshold:   ${preview.qualifyingTopics}`);

  if (preview.qualifyingTopics === 0) {
    console.log(`\n✓ No topics meet the threshold. Nothing to do.`);
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log(`\n(DRY RUN — no opinions formed. Server-side log shows the qualifying list.)`);
    console.log(`To execute: pnpm exec node scripts/backfill-opinions.mjs --execute`);
    process.exit(0);
  }

  // Step 3: confirm with the user before live run
  console.log(`\nAbout to form up to ${Math.min(preview.qualifyingTopics, MAX_TOPICS)} opinions.`);
  console.log(`Each takes ~30-90s of LLM time. Total: roughly ${Math.round(Math.min(preview.qualifyingTopics, MAX_TOPICS) * 1.5)} minutes.`);
  console.log(`\nProceeding in 5 seconds. Ctrl+C to abort.\n`);
  await new Promise((r) => setTimeout(r, 5_000));

  // Step 4: live execution
  console.log(`Executing live backfill — watch the server log for progress.\n`);
  const result = await callTrpc("opinions.backfillFromCorrections", {
    dryRun: false,
    minCorrections: MIN_CORRECTIONS,
    maxTopics: MAX_TOPICS,
  });

  // Step 5: count opinions AFTER + verify the delta
  let afterCount = 0;
  try {
    const opinions = await callTrpc("opinions.list", { limit: 500 });
    afterCount = Array.isArray(opinions) ? opinions.length : 0;
  } catch { /* ignore */ }

  console.log(`\n────────────────────────────────────────────────────`);
  console.log(`  Backfill complete`);
  console.log(`────────────────────────────────────────────────────`);
  console.log(`  Attempted:      ${result.attempted}`);
  console.log(`  Formed:         ${result.formed}`);
  console.log(`  Skipped (existing): ${result.skippedExisting}`);
  console.log(`  Failed:         ${result.failed}`);
  console.log(`  Opinions before: ${beforeCount}`);
  console.log(`  Opinions after:  ${afterCount}`);
  console.log(`  Net new:        ${afterCount - beforeCount}`);
  if (result.formed !== afterCount - beforeCount) {
    console.log(`\n  ⚠  Reported formed (${result.formed}) doesn't match DB delta (${afterCount - beforeCount}).`);
    console.log(`     Possible: another process formed opinions concurrently, or some forms returned`);
    console.log(`     non-null but didn't persist. Inspect the server log.`);
  }
  if (result.topicsFailed.length > 0) {
    console.log(`\n  Failures:`);
    for (const f of result.topicsFailed.slice(0, 10)) {
      console.log(`    - "${f.topic}" — ${f.reason.slice(0, 100)}`);
    }
    if (result.topicsFailed.length > 10) {
      console.log(`    … and ${result.topicsFailed.length - 10} more (see server log)`);
    }
  }
  console.log(``);
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
