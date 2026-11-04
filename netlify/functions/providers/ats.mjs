const timeout = 12000;

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
    region: clean(location || "Not specified"),
    description: text,
    applyUrl: url || "",
    postedAt: postedAt || null,
    salary: "Not disclosed",
    visa: /visa sponsorship|work permit|relocation support|sponsor.*visa/i.test(text)
      ? "Mentioned - verify with employer"
      : "Not stated - ask recruiter",
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

const providers = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever
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

  const jobs = [];
  const errors = [];
  const results = await Promise.allSettled(
    companies.map(async (company) => {
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
    })
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      jobs.push(...result.value);
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
