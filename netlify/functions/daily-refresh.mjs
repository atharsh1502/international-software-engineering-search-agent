import { store, JOBS_KEY, META_KEY, fetchAllJobSources, dedupeJobs } from "./_shared.mjs";

export default async () => {
  const { jobs: incoming, errors = [], skipped = [] } = await fetchAllJobSources();
  if (!incoming.length) {
    console.warn("Daily refresh returned no jobs", { skipped, errors });
    return;
  }

  const blobStore = store();
  const existing = await blobStore.get(JOBS_KEY, { type: "json" }) || [];
  const map = new Map();
  for (const job of [...existing, ...incoming]) {
    const key = `${job.title}|${job.company}|${job.region}`.toLowerCase().replace(/\s+/g, " ");
    const previous = map.get(key);
    if (!previous || new Date(job.fetchedAt || 0) > new Date(previous.fetchedAt || 0)) map.set(key, job);
  }
  const jobs = dedupeJobs([...map.values()]);
  await blobStore.setJSON(JOBS_KEY, jobs);
  await blobStore.setJSON(META_KEY, {
    lastUpdated: new Date().toISOString(),
    sources: [...new Set(incoming.map((job) => job.source))],
    count: jobs.length,
    newlyFetched: incoming.length,
    errors: errors.slice(0, 20)
  });
  console.log(`Daily job refresh complete: ${incoming.length} fetched; ${jobs.length} stored`);
};

export const config = { schedule: "30 23 * * *" }; // 05:00 India time (UTC+5:30)
