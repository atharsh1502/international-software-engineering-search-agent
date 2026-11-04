import { store, JOBS_KEY, META_KEY, fetchAllJobSources, dedupeJobs } from "./_shared.mjs";

export default async (request) => {
  if (request.method !== "POST") return new Response("POST only", { status: 405 });

  const expected = process.env.JOB_REFRESH_SECRET;
  const supplied = request.headers.get("x-refresh-secret");
  if (!expected || supplied !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized. Configure JOB_REFRESH_SECRET in Netlify and send it as x-refresh-secret." }), {
      status: 401, headers: { "content-type": "application/json" }
    });
  }

  const { jobs: incoming, errors = [], skipped = [] } = await fetchAllJobSources();
  if (!incoming.length) {
    return new Response(JSON.stringify({ ok: false, imported: 0, skipped, errors, note: "No API results returned; existing stored jobs were preserved." }), {
      status: 502, headers: { "content-type": "application/json" }
    });
  }

  const currentStore = store();
  const existing = await currentStore.get(JOBS_KEY, { type: "json" }) || [];
  const byKey = new Map();
  for (const job of [...existing, ...incoming]) {
    const key = `${job.title}|${job.company}|${job.region}`.toLowerCase().replace(/\s+/g, " ");
    const old = byKey.get(key);
    if (!old || new Date(job.fetchedAt || 0) > new Date(old.fetchedAt || 0)) byKey.set(key, job);
  }
  const merged = dedupeJobs([...byKey.values()]);
  const metadata = {
    lastUpdated: new Date().toISOString(),
    sources: [...new Set(incoming.map((job) => job.source))],
    count: merged.length,
    newlyFetched: incoming.length,
    errors: errors.slice(0, 20)
  };
  await currentStore.setJSON(JOBS_KEY, merged);
  await currentStore.setJSON(META_KEY, metadata);

  return new Response(JSON.stringify({ ok: true, imported: incoming.length, total: merged.length, metadata }), {
    headers: { "content-type": "application/json" }
  });
};
