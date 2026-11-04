import { getStore } from "@netlify/blobs";
import { fetchATSJobs } from "./providers/ats.mjs";
import { fetchJoobleJobs } from "./providers/jooble.mjs";
import {
  classifySponsorship,
  dedupeJobs,
  normalizeRegion,
  selectRotatedSearches,
  scoreJob
} from "./providers/job-utils.mjs";
export {
  countJobsBySource,
  dedupeJobs,
  filterJobs,
  getJobDedupeKey,
  mergeJobs,
  scoreJob
} from "./providers/job-utils.mjs";

export const STORE_NAME = "atharsh-job-search";
export const JOBS_KEY = "jobs-v1";
export const META_KEY = "metadata-v1";

export const store = () => getStore({ name: STORE_NAME });

export const PROFILE = {
  candidate: "Atharsh G.",
  experienceYears: 2.5,
  targetRegions: ["Singapore", "Malaysia", "United Arab Emirates", "Saudi Arabia", "Qatar", "Oman", "Kuwait", "Bahrain"],
  targetTitles: [
    "Java Backend Engineer",
    "Java Spring Boot Developer",
    "Full Stack Engineer Java React",
    "Software Engineer",
    "Backend Software Engineer",
    "Identity and Access Management Engineer",
    "Developer Productivity Engineer"
  ],
  skills: [
    "Java", "Spring Boot", "Microservices", "REST API", "React", "Angular",
    "TypeScript", "JavaScript", "PostgreSQL", "SQL", "OAuth", "OIDC", "JWT",
    "Microsoft Entra ID", "Kafka", "RabbitMQ", "Docker", "Kubernetes",
    "Jenkins", "Tekton", "OpenShift", "GCP", "CI/CD", "MCP", "AI coding agents"
  ],
  resumeSummary: "Software Engineer at Ford with 2+ years of experience in Java, Spring Boot, microservices, React/Angular, enterprise identity, API development, CI/CD, and AI-assisted developer productivity. Indian citizen based in India; open to relocation and requires employer-sponsored work authorization."
};

const LOCATION_QUERIES = [
  { region: "Singapore", country: "sg", terms: ["Java Spring Boot", "Java React software engineer", "backend engineer Java"] },
  { region: "Malaysia", country: "my", terms: ["Java Spring Boot", "Java full stack React", "backend software engineer"] },
  { region: "United Arab Emirates", country: "ae", terms: ["Java Spring Boot developer", "Java backend engineer", "full stack Java React"] },
  { region: "Saudi Arabia", country: "sa", terms: ["Java Spring Boot developer", "Java backend engineer"] },
  { region: "Qatar", country: "qa", terms: ["Java Spring Boot developer", "Java backend engineer"] },
  { region: "Oman", country: "om", terms: ["Java developer Spring Boot", "backend engineer Java"] },
  { region: "Kuwait", country: "kw", terms: ["Java Spring Boot developer", "Java backend engineer"] },
  { region: "Bahrain", country: "bh", terms: ["Java Spring Boot developer", "Java backend engineer"] }
];

function normalizeText(value = "") {
  return String(value).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
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

export function normalizeAdzuna(ad, region) {
  const description = normalizeText(ad.description || "");
  const url = ad.redirect_url || ad.url || "";
  const id = `adzuna-${ad.id || Buffer.from(url).toString("base64").slice(0, 18)}`;
  const job = {
    id,
    source: "Adzuna",
    title: normalizeText(ad.title || "Software Engineer"),
    company: normalizeText(ad.company?.display_name || "Not listed"),
    location: normalizeText(ad.location?.display_name || region),
    region,
    description,
    applyUrl: url,
    postedAt: ad.created || null,
    salary: ad.salary_min && ad.salary_max ? `${ad.salary_min}–${ad.salary_max} ${ad.salary_currency || ""}`.trim() : "Not disclosed",
    visa: classifySponsorship(description),
    experience: "Check job description",
    fitScore: 0,
    status: "Found via API; verify application status",
    fetchedAt: new Date().toISOString()
  };
  job.fitScore = scoreJob(job);
  return job;
}

export async function fetchAdzunaJobs() {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    return { jobs: [], skipped: "Adzuna credentials not configured" };
  }

  const maxSearchesValue = process.env.MAX_ADZUNA_SEARCHES || "8";
  const maxSearches = Number(maxSearchesValue);
  const maxSafeSearches = 12;
  if (!Number.isInteger(maxSearches) || maxSearches < 1 || maxSearches > maxSafeSearches) {
    return {
      jobs: [],
      errors: [`MAX_ADZUNA_SEARCHES must be an integer from 1 to ${maxSafeSearches}`]
    };
  }

  const regionFirstSearches = LOCATION_QUERIES.map((location) => ({
    location,
    term: location.terms[0]
  }));
  const remainingSearches = LOCATION_QUERIES.flatMap((location) =>
    location.terms.slice(1).map((term) => ({ location, term }))
  );
  const extraCount = maxSearches - regionFirstSearches.length;
  const rotation = Math.floor(Date.now() / 86400000) % remainingSearches.length;
  const searches = selectRotatedSearches(
    regionFirstSearches,
    remainingSearches,
    extraCount,
    rotation
  );
  const jobs = [];
  const errors = [];
  const results = await mapWithConcurrency(searches, 4, async ({ location, term }) => {
    const url = new URL(`https://api.adzuna.com/v1/api/jobs/${location.country}/search/1`);
    url.searchParams.set("app_id", appId);
    url.searchParams.set("app_key", appKey);
    url.searchParams.set("what", term);
    url.searchParams.set("results_per_page", "20");
    url.searchParams.set("content-type", "application/json");
    url.searchParams.set("sort_by", "date");

    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return (data.results || []).map((item) => normalizeAdzuna(item, location.region));
  });

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      jobs.push(...result.value);
    } else {
      errors.push(
        `Adzuna ${searches[i].location.country}/${searches[i].term}: ${
          result.reason?.message || result.reason
        }`
      );
    }
  }

  return {
    jobs,
    errors,
    refreshedSources: errors.length ? [] : ["Adzuna"]
  };
}

function normalizeJobicy(job) {
  const description = normalizeText(job.jobDescription || job.description || "");
  const url = job.url || job.jobUrl || "";
  const normalized = {
    id: `jobicy-${job.id || Buffer.from(url).toString("base64").slice(0, 18)}`,
    source: "Jobicy",
    title: normalizeText(job.jobTitle || job.title || "Software Engineer"),
    company: normalizeText(job.companyName || job.company || "Not listed"),
    location: normalizeText(job.jobGeo || job.location || "Remote"),
    region: normalizeRegion(job.jobGeo || "Remote"),
    description,
    applyUrl: url,
    postedAt: job.pubDate || job.datePosted || null,
    salary: job.salaryMin && job.salaryMax
      ? `${job.salaryMin}–${job.salaryMax}${job.salaryCurrency ? ` ${job.salaryCurrency}` : ""} (${job.salaryPeriod || "period not specified"})`
      : "Not disclosed",
    visa: classifySponsorship(description),
    experience: "Check job description",
    fitScore: 0,
    status: "Found via API; verify application status",
    fetchedAt: new Date().toISOString()
  };
  normalized.fitScore = scoreJob(normalized);
  return normalized;
}

async function fetchJobicyJobs() {
  try {
    const response = await fetch("https://jobicy.com/api/jobs?count=100", {
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`Jobicy HTTP ${response.status}`);

    const data = await response.json();
    const listings = Array.isArray(data)
      ? data
      : Array.isArray(data?.jobs)
        ? data.jobs
        : Array.isArray(data?.data?.jobs)
          ? data.data.jobs
          : Array.isArray(data?.results)
            ? data.results
            : null;

    if (!listings) {
      const keys = data && typeof data === "object" ? Object.keys(data).join(", ") : typeof data;
      throw new Error(`Unexpected response schema (received: ${keys || "no object keys"})`);
    }

    const validListings = listings.filter((item) => item && typeof item === "object" && !Array.isArray(item));
    const jobs = validListings
      .map(normalizeJobicy)
      .filter((job) => typeof job.applyUrl === "string" && job.applyUrl.trim());
    const errors = [];
    if (validListings.length !== listings.length) {
      errors.push(`Jobicy: skipped ${listings.length - validListings.length} malformed listing(s)`);
    }
    if (jobs.length !== validListings.length) {
      errors.push(`Jobicy: skipped ${validListings.length - jobs.length} listing(s) without an application URL`);
    }
    return {
      jobs,
      errors,
      refreshedSources: errors.length ? [] : ["Jobicy"]
    };
  } catch (error) {
    return { jobs: [], errors: [`Jobicy: ${error.message || error}`] };
  }
}

function normalizeRemoteOK(job) {
  const description = normalizeText(job.description || "");
  const url = job.url || "";
  const normalized = {
    id: `remoteok-${job.id || Buffer.from(url).toString("base64").slice(0, 18)}`,
    source: "Remote OK",
    title: normalizeText(job.position || job.title || "Software Engineer"),
    company: normalizeText(job.company || "Not listed"),
    location: normalizeText(job.location || "Remote"),
    region: normalizeRegion(job.location || "Remote"),
    description,
    applyUrl: job.apply_url || url,
    postedAt: job.date || null,
    salary: job.salary || "Not disclosed",
    visa: classifySponsorship(description),
    experience: "Check job description",
    fitScore: 0,
    status: "Found via API; verify application status",
    fetchedAt: new Date().toISOString()
  };
  normalized.fitScore = scoreJob(normalized);
  return normalized;
}

async function fetchRemoteOKJobs() {
  try {
    const response = await fetch("https://remoteok.com/api", {
      headers: { "User-Agent": "AtharshJobSearchDashboard/1.0" },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`Remote OK HTTP ${response.status}`);

    const data = await response.json();
    const jobs = (Array.isArray(data) ? data : [])
      .filter((item) => item && item.id && (item.position || item.title))
      .map(normalizeRemoteOK)
      .filter((job) => job.applyUrl);
    return { jobs, errors: [], refreshedSources: ["Remote OK"] };
  } catch (error) {
    return { jobs: [], errors: [`Remote OK: ${error.message || error}`] };
  }
}

export async function fetchAllJobSources() {
  const startedAt = Date.now();
  const providers = [
    ["Adzuna", fetchAdzunaJobs, ["Adzuna"]],
    ["Jobicy", fetchJobicyJobs, ["Jobicy"]],
    ["Remote OK", fetchRemoteOKJobs, ["Remote OK"]],
    ["ATS", () => fetchATSJobs(scoreJob), []],
    ["Jooble", () => fetchJoobleJobs(scoreJob), ["Jooble"]]
  ];
  const results = await Promise.all(
    providers.map(async ([name, fetchJobs, sources]) => {
      const providerStartedAt = Date.now();
      try {
        return {
          name,
          sources,
          result: await fetchJobs(),
          durationMs: Date.now() - providerStartedAt
        };
      } catch (error) {
        return {
          name,
          sources,
          error,
          durationMs: Date.now() - providerStartedAt
        };
      }
    })
  );
  const jobs = [];
  const errors = [];
  const skipped = [];
  const providerTimings = {};
  const refreshedSources = [];

  for (const provider of results) {
    providerTimings[provider.name] = provider.durationMs;
    if (provider.error) {
      errors.push(`${provider.name}: ${provider.error.message || provider.error}`);
      continue;
    }

    const result = provider.result;
    jobs.push(...(result.jobs || []));
    errors.push(...(result.errors || []).map((error) =>
      error.startsWith(`${provider.name}:`) ? error : `${provider.name}: ${error}`
    ));
    if (result.skipped) skipped.push(`${provider.name}: ${result.skipped}`);
    if (result.refreshedSources) {
      refreshedSources.push(...result.refreshedSources);
    } else if (!(result.errors || []).length && !result.skipped) {
      refreshedSources.push(...provider.sources);
    }
    if ((result.errors || []).length) {
      console.warn(`${provider.name} provider reported errors`, {
        durationMs: provider.durationMs,
        errors: result.errors
      });
    }
  }

  return {
    jobs: dedupeJobs(jobs),
    errors,
    skipped,
    durationMs: Date.now() - startedAt,
    providerTimings,
    refreshedSources: [...new Set(refreshedSources)]
  };
}
