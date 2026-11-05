import { classifySponsorship, isSecureApplyUrl, normalizeRegion } from "./job-utils.mjs";

const locations = [
  { country: "ae", name: "United Arab Emirates" },
  { country: "sa", name: "Saudi Arabia" },
  { country: "qa", name: "Qatar" },
  { country: "om", name: "Oman" },
  { country: "kw", name: "Kuwait" },
  { country: "bh", name: "Bahrain" },
  { country: "my", name: "Malaysia" },
  { country: "sg", name: "Singapore" }
];
const timeout = 7000;
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

function normalizeJob(job, requestedLocation, scoreJob) {
  const description = clean(job.job_description || "");
  const isRemote = job.job_is_remote === true || job.job_is_remote === "true";
  const location = isRemote
    ? "Remote"
    : clean([job.job_city, job.job_state, job.job_country].filter(Boolean).join(", ") || requestedLocation.name);
  const applyUrl = isSecureApplyUrl(job.job_apply_link) ? new URL(job.job_apply_link).href : "";
  const normalized = {
    id: `jsearch-${job.job_id || Buffer.from(applyUrl).toString("base64").slice(0, 18)}`,
    source: "JSearch",
    title: clean(job.job_title || "Software Engineer"),
    company: clean(job.employer_name || "Not listed"),
    location,
    region: isRemote ? "Remote" : normalizeRegion(location || requestedLocation.name),
    description,
    applyUrl,
    postedAt: normalizeDate(job.job_posted_at_datetime_utc),
    salary: job.job_min_salary && job.job_max_salary
      ? `${job.job_min_salary}–${job.job_max_salary} ${job.job_salary_currency || ""}`.trim()
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
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function fetchSearch(apiKey, location, scoreJob) {
  const url = new URL("https://jsearch.p.rapidapi.com/search");
  url.searchParams.set("query", `Java Spring Boot software engineer jobs in ${location.name}`);
  url.searchParams.set("page", "1");
  url.searchParams.set("num_pages", "1");
  url.searchParams.set("country", location.country);
  url.searchParams.set("date_posted", "month");
  const response = await fetch(url, {
    headers: {
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": "jsearch.p.rapidapi.com"
    },
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw new Error(`JSearch HTTP ${response.status}`);

  const data = await response.json();
  if (!Array.isArray(data?.data)) {
    throw new Error("JSearch returned an invalid response");
  }
  const jobs = data.data
    .filter((job) => job && typeof job === "object")
    .map((job) => normalizeJob(job, location, scoreJob))
    .filter((job) => job.applyUrl);
  return { jobs, skipped: data.data.length - jobs.length };
}

export async function fetchJSearchJobs(scoreJob) {
  const apiKey = process.env.JSEARCH_API_KEY;
  if (!apiKey) {
    return {
      jobs: [],
      skipped: "JSearch API key not configured (JSEARCH_API_KEY)"
    };
  }

  const results = await mapWithConcurrency(locations, concurrency, (location) =>
    fetchSearch(apiKey, location, scoreJob)
  );
  const jobs = [];
  const errors = [];
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (result.status === "rejected") {
      errors.push(`${locations[index].name}: ${result.reason?.message || result.reason}`);
      continue;
    }
    jobs.push(...result.value.jobs);
    if (result.value.skipped) {
      errors.push(`${locations[index].name}: skipped ${result.value.skipped} listing(s) without HTTPS application URLs`);
    }
  }

  return {
    jobs,
    errors,
    refreshedSources: errors.length ? [] : ["JSearch"]
  };
}
