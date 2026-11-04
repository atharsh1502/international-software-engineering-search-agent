import {
  store,
  JOBS_KEY,
  META_KEY,
  fetchAllJobSources,
  countJobsBySource,
  mergeJobs
} from "./_shared.mjs";

export default async () => {
  const {
    jobs: incoming,
    errors = [],
    skipped = [],
    durationMs,
    providerTimings = {},
    refreshedSources = []
  } = await fetchAllJobSources();
  if (!incoming.length) {
    const blobStore = store();
    const previousMetadata = await blobStore.get(META_KEY, { type: "json" }) || {};
    const jobs = await blobStore.get(JOBS_KEY, { type: "json" }) || [];
    const metadata = {
      ...previousMetadata,
      attemptedAt: new Date().toISOString(),
      status: "failed",
      sources: [],
      sourceCounts: {},
      count: jobs.length,
      newlyFetched: 0,
      errors: errors.slice(0, 20),
      skipped,
      refreshDurationMs: durationMs,
      providerTimings,
      refreshedSources,
      expiredJobs: 0
    };
    await blobStore.setJSON(META_KEY, metadata);
    console.warn("Daily refresh returned no jobs", { skipped, errors, durationMs, providerTimings });
    return;
  }

  const blobStore = store();
  const existing = await blobStore.get(JOBS_KEY, { type: "json" }) || [];
  const { jobs, expiredCount } = mergeJobs(existing, incoming, refreshedSources);
  await blobStore.setJSON(JOBS_KEY, jobs);
  await blobStore.setJSON(META_KEY, {
    lastUpdated: new Date().toISOString(),
    attemptedAt: new Date().toISOString(),
    status: errors.length || skipped.length ? "partial" : "success",
    sources: [...new Set(incoming.map((job) => job.source))],
    sourceCounts: countJobsBySource(incoming),
    count: jobs.length,
    newlyFetched: incoming.length,
    errors: errors.slice(0, 20),
    skipped,
    refreshDurationMs: durationMs,
    providerTimings,
    expiredJobs: expiredCount,
    refreshedSources
  });
  console.log(`Daily job refresh complete: ${incoming.length} fetched; ${jobs.length} stored`, {
    durationMs,
    providerTimings
  });
};

export const config = { schedule: "30 23 * * *" }; // 05:00 India time (UTC+5:30)
