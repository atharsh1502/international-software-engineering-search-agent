import {
  classifyJoobleSponsorship,
  isSecureApplyUrl,
  normalizeRegion
} from "./job-utils.mjs";

const SEARCHES = [
  { keyword: "Java Spring Boot Developer", location: "United Arab Emirates" },
  { keyword: "Java Backend Engineer", location: "Saudi Arabia" },
  { keyword: "Java Software Engineer", location: "Qatar" },
  { keyword: "Java Spring Boot Developer", location: "Oman" },
  { keyword: "Java Backend Developer", location: "Kuwait" },
  { keyword: "Java Software Engineer", location: "Bahrain" },
  { keyword: "Java Spring Boot Developer", location: "Singapore" },
  { keyword: "Java Full Stack Developer", location: "Malaysia" }
];

const timeout = 8000;
const concurrency = 4;

function clean(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: "fulfilled", value: await mapper(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

async function fetchSearch(apiKey, search) {
  const response = await fetch(`https://jooble.org/api/${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "AtharshInternationalJobSearch/1.0"
    },
    body: JSON.stringify({
      keywords: search.keyword,
      location: search.location,
      page: 1
    }),
    signal: AbortSignal.timeout(timeout)
  });

  if (!response.ok) {
    throw new Error(`Jooble HTTP ${response.status}`);
  }

  const data = await response.json();
  const listings = Array.isArray(data?.jobs) ? data.jobs : [];
  const jobs = listings
    .filter((job) => job && typeof job === "object" && isSecureApplyUrl(job.link))
    .map((job) => {
      const description = clean(job.snippet || "");
      return {
        id: `jooble-${job.id || Buffer.from(job.link).toString("base64").slice(0, 18)}`,
        source: "Jooble",
        title: clean(job.title || "Software Engineer"),
        company: clean(job.company || "Not listed"),
        location: clean(job.location || search.location),
        region: normalizeRegion(job.location || search.location),
        description,
        applyUrl: new URL(job.link).href,
        postedAt: normalizeDate(job.updated),
        salary: clean(job.salary || "Not disclosed"),
        visa: classifyJoobleSponsorship(description),
        experience: "Check job description",
        fitScore: 0,
        status: "Found via API; verify application status",
        fetchedAt: new Date().toISOString()
      };
    });

  return {
    jobs,
    skipped: listings.length - jobs.length
  };
}

export async function fetchJoobleJobs(scoreJob) {
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) {
    return {
      jobs: [],
      skipped: "Jooble API key not configured"
    };
  }

  const jobs = [];
  const errors = [];
  const results = await mapWithConcurrency(SEARCHES, concurrency, (search) =>
    fetchSearch(apiKey, search)
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      for (const job of result.value.jobs) {
        job.fitScore = scoreJob(job);
        jobs.push(job);
      }
      if (result.value.skipped) {
        errors.push(
          `Jooble (${SEARCHES[i].location}): skipped ${result.value.skipped} listing(s) without a valid HTTPS application URL`
        );
      }
    } else {
      errors.push(
        `Jooble (${SEARCHES[i].location}): ${result.reason?.message || result.reason}`
      );
    }
  }

  return { jobs, errors };
}
