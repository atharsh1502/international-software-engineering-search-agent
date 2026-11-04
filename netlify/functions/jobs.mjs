import { store, JOBS_KEY, META_KEY, PROFILE } from "./_shared.mjs";

export default async (request) => {
  try {
    const blobStore = store();
    const jobs = await blobStore.get(JOBS_KEY, { type: "json" }) || [];
    const metadata = await blobStore.get(META_KEY, { type: "json" }) || { lastUpdated: null, sources: [], count: jobs.length };

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").toLowerCase().trim();
    const region = url.searchParams.get("region") || "all";
    const category = url.searchParams.get("category") || "all";
    const minScore = Number(url.searchParams.get("minScore") || 0);
    const filtered = jobs.filter((job) => {
      const text = `${job.title} ${job.company} ${job.location} ${job.description}`.toLowerCase();
      const matchesQuery = !q || text.includes(q);
      const matchesRegion = region === "all" || job.region === region;
      const score = Number(job.fitScore || 0);
      const matchesScore = score >= minScore;
      const visaText = `${job.visa || ""} ${job.description || ""}`.toLowerCase();
      const matchesCategory = category === "all" ||
        (category === "visa" && /sponsor|visa|work permit|relocation/.test(visaText)) ||
        (category === "highfit" && score >= 75) ||
        (category === "backend" && /java|spring|backend|microservice/.test(text)) ||
        (category === "fullstack" && /full.?stack|react|angular/.test(text));
      return matchesQuery && matchesRegion && matchesScore && matchesCategory;
    });

    return new Response(JSON.stringify({
      profile: PROFILE,
      jobs: filtered,
      metadata: { ...metadata, total: jobs.length, filtered: filtered.length },
      setup: jobs.length ? null : "No job data yet. Add Adzuna API credentials in Netlify and run the refresh function."
    }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Unable to load jobs", detail: String(error.message || error) }), {
      status: 500, headers: { "content-type": "application/json" }
    });
  }
};
