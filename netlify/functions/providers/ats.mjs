import {
  classifySponsorship,
  isSecureApplyUrl,
  normalizeRegion
} from "./job-utils.mjs";

const timeout = 8000;
const concurrency = 4;
const maxCompanies = 8;

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

function smartRecruitersLocation(location = {}) {
  const city = clean(location.city || location.region || "");
  const countryValue = location.country;
  const country = clean(
    typeof countryValue === "string"
      ? countryValue
      : countryValue?.label || countryValue?.name || ""
  );
  return [city, country].filter(Boolean).join(", ") || (location.remote ? "Remote" : "");
}

function normalizeJob({
  source,
  id,
  title,
  company,
  location,
  description,
  url,
  postedAt
}, scoreJob) {
  const text = clean(description);
  const job = {
    id: `${source.toLowerCase()}-${id || Buffer.from(url || "").toString("base64").slice(0, 18)}`,
    source,
    title: clean(title || "Software Engineer"),
    company: clean(company || "Not listed"),
    location: clean(location || "Not specified"),
    region: normalizeRegion(location),
    description: text,
    applyUrl: isSecureApplyUrl(url) ? new URL(url).href : "",
    postedAt: postedAt || null,
    salary: "Not disclosed",
    visa: classifySponsorship(text),
    experience: "Check job description",
    fitScore: 0,
    status: "Found via company career API; verify application status",
    fetchedAt: new Date().toISOString()
  };
  job.fitScore = scoreJob(job);
  return job;
}

async function getJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: {
      "User-Agent": "AtharshInternationalJobSearch/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
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

async function fetchGreenhouse(company, scoreJob) {
  const url =
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(company.board)}/jobs?content=true`;
  const data = await getJson(url);

  return (data.jobs || []).map((job) =>
    normalizeJob({
      source: "Greenhouse",
      id: job.id,
      title: job.title,
      company: company.name,
      location: job.location?.name,
      description: job.content,
      url: job.absolute_url,
      postedAt: job.updated_at
    }, scoreJob)
  );
}

async function fetchLever(company, scoreJob) {
  const url =
    `https://api.lever.co/v0/postings/${encodeURIComponent(company.board)}?mode=json`;
  const data = await getJson(url);

  return (data || []).map((job) =>
    normalizeJob({
      source: "Lever",
      id: job.id,
      title: job.text,
      company: company.name,
      location: job.categories?.location,
      description: job.descriptionPlain || job.description,
      url: job.hostedUrl,
      postedAt: normalizeDate(job.createdAt)
    }, scoreJob)
  );
}

async function fetchAshby(company, scoreJob) {
  const url =
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company.board)}`;
  const data = await getJson(url);

  return (data.jobs || []).map((job) =>
    normalizeJob({
      source: "Ashby",
      id: job.id,
      title: job.title,
      company: company.name,
      location: job.location,
      description: job.descriptionHtml,
      url: job.jobUrl,
      postedAt: job.publishedAt
    }, scoreJob)
  );
}

async function fetchSmartRecruiters(company, scoreJob) {
  const url =
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company.board)}/postings?limit=100`;
  const data = await getJson(url);

  return (data.content || []).map((job) =>
    normalizeJob({
      source: "SmartRecruiters",
      id: job.id,
      title: job.name,
      company: company.name,
      location: smartRecruitersLocation(job.location),
      description: job.jobAd?.sections?.jobDescription?.text || "",
      url: job.id
        ? `https://jobs.smartrecruiters.com/${encodeURIComponent(company.board)}/${encodeURIComponent(job.id)}`
        : "",
      postedAt: job.releasedDate
    }, scoreJob)
  );
}

const providers = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  smartrecruiters: fetchSmartRecruiters
};

export async function fetchATSJobs(scoreJob) {
  const raw = process.env.ATS_COMPANIES_JSON;

  if (!raw) {
    return {
      jobs: [],
      skipped: "ATS_COMPANIES_JSON not configured"
    };
  }

  let companies;
  try {
    companies = JSON.parse(raw);
  } catch {
    return {
      jobs: [],
      errors: ["Invalid ATS_COMPANIES_JSON"]
    };
  }

  if (!Array.isArray(companies)) {
    return {
      jobs: [],
      errors: ["ATS_COMPANIES_JSON must be an array"]
    };
  }
  if (companies.length > maxCompanies) {
    return {
      jobs: [],
      errors: [`ATS_COMPANIES_JSON supports at most ${maxCompanies} company boards per refresh`]
    };
  }

  const jobs = [];
  const errors = [];
  const results = await mapWithConcurrency(companies, concurrency, async (company) => {
    if (!company || typeof company !== "object" || Array.isArray(company)) {
      throw new Error("Company entry must be an object");
    }

    const providerName = String(company.ats || "").toLowerCase();
    if (!Object.hasOwn(providers, providerName)) {
      throw new Error(`Unsupported ATS: ${company.ats || "unspecified"}`);
    }
    if (typeof company.board !== "string" || !company.board.trim()) {
      throw new Error("Company board identifier is required");
    }
    return providers[providerName](company, scoreJob);
  });

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      const secureJobs = result.value.filter((job) => isSecureApplyUrl(job.applyUrl));
      jobs.push(...secureJobs);
      if (secureJobs.length !== result.value.length) {
        errors.push(
          `${companies[i]?.name || "Unknown company"}: skipped ${
            result.value.length - secureJobs.length
          } listing(s) without a valid HTTPS application URL`
        );
      }
    } else {
      errors.push(
        `${companies[i]?.name || "Unknown company"}: ${
          result.reason?.message || result.reason
        }`
      );
    }
  }

  return { jobs, errors };
}
