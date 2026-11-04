import { getStore } from "@netlify/blobs";

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

export function scoreJob(job) {
  const text = `${job.title || ""} ${job.description || ""} ${job.company || ""}`.toLowerCase();
  const strong = ["java", "spring boot", "microservices", "rest", "backend", "react", "angular", "oauth", "oidc", "jwt", "kafka", "docker", "kubernetes", "ci/cd"];
  const differentiators = ["identity", "entra", "developer productivity", "ai agent", "mcp", "typescript", "postgresql"];
  let score = 35;
  for (const keyword of strong) if (text.includes(keyword)) score += 4;
  for (const keyword of differentiators) if (text.includes(keyword)) score += 3;
  if (/senior|staff|principal|lead architect|8\+ years|10\+ years/.test(text)) score -= 18;
  if (/intern|internship|unpaid|commission only/.test(text)) score -= 35;
  if (/java/.test(text) && /spring/.test(text)) score += 8;
  return Math.max(20, Math.min(98, score));
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
    visa: /visa sponsorship|work permit|relocation support|sponsor.*visa/i.test(description) ? "Mentioned — verify with employer" : "Not stated — ask recruiter",
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

  const all = [];
  const errors = [];
  const tasks = LOCATION_QUERIES.flatMap((location) =>
    location.terms.map(async (term) => {
      const url = new URL(`https://api.adzuna.com/v1/api/jobs/${location.country}/search/1`);
      url.searchParams.set("app_id", appId);
      url.searchParams.set("app_key", appKey);
      url.searchParams.set("what", term);
      url.searchParams.set("results_per_page", "20");
      url.searchParams.set("content-type", "application/json");
      url.searchParams.set("sort_by", "date");
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(`Adzuna ${location.country}/${term}: HTTP ${response.status}`);
        const data = await response.json();
        for (const item of data.results || []) all.push(normalizeAdzuna(item, location.region));
      } catch (error) {
        errors.push(String(error.message || error));
      }
    })
  );

  await Promise.allSettled(tasks);
  return { jobs: all, errors };
}

export function dedupeJobs(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    const key = `${job.title}|${job.company}|${job.region}`.toLowerCase().replace(/\s+/g, " ");
    if (!job.applyUrl || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0));
}
