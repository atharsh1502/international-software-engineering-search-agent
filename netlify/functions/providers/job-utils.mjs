const regions = [
  ["Singapore", /\bsingapore\b|\bsg\b/],
  ["Malaysia", /\bmalaysia\b|\bmy\b/],
  ["United Arab Emirates", /\bunited arab emirates\b|\bu\.?a\.?e\.?\b|\buae\b|\bdubai\b|\babu dhabi\b|\bsharjah\b/],
  ["Saudi Arabia", /\bsaudi arabia\b|\bksa\b|\briyadh\b|\bjeddah\b/],
  ["Qatar", /\bqatar\b|\bdoha\b/],
  ["Oman", /\boman\b|\bmuscat\b/],
  ["Kuwait", /\bkuwait\b/],
  ["Bahrain", /\bbahrain\b|\bmanama\b/]
];

export function normalizeRegion(location) {
  const value = String(location || "").trim();
  const normalized = value.toLowerCase();
  const matchedRegions = regions
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([region]) => region);

  if (/remote|worldwide|anywhere|work from anywhere/i.test(value)) {
    return "Remote";
  }
  if (/\bgcc\b|\bgulf\b|middle east/i.test(normalized)) {
    return "GCC / Middle East";
  }
  if (/\bemea\b/i.test(normalized)) {
    return "EMEA";
  }
  if (matchedRegions.length > 1) {
    return "Multiple regions";
  }
  if (matchedRegions.length === 1) {
    return matchedRegions[0];
  }

  if (!value) {
    return "Remote";
  }
  return value;
}

export function isSecureApplyUrl(value) {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const sponsorshipMentionPattern =
  /visa sponsorship|visa assistance|employment visa provided|work authorization sponsorship|sponsorship available|sponsor(?:ed|ship)?\s+(?:for|a|the|your|international)|(?:international candidates|work permit|relocation support|relocation assistance|visa support)/i;
const sponsorshipDenialPattern =
  /(?:no|not|does not|do not|unable to)\s+(?:provide|offer|support|consider)?\s*(?:visa\s+)?sponsorship|(?:visa\s+)?sponsorship\s+(?:is\s+)?(?:not available|unavailable|not provided)/i;

export function classifySponsorship(text = "", confirmedByRecruiter = false) {
  if (confirmedByRecruiter === true) return "Confirmed by recruiter";
  if (sponsorshipDenialPattern.test(text)) return "Sponsorship unavailable";
  if (sponsorshipMentionPattern.test(text)) return "Sponsorship mentioned - verify";
  return "Sponsorship not stated";
}

export function classifyJoobleSponsorship(snippet = "") {
  if (sponsorshipDenialPattern.test(snippet)) return "Sponsorship unavailable";
  if (/visa sponsorship|visa assistance|employment visa provided|work authorization sponsorship|sponsorship available|sponsor(?:ed|ship)?\s+(?:for|a|the|your|international)|visa support/i.test(snippet)) {
    return "Sponsorship mentioned - verify";
  }
  return "Sponsorship not stated";
}

export function scoreJob(job) {
  const text = `${job.title || ""} ${job.description || ""} ${job.company || ""}`.toLowerCase();
  const strongSkills = [
    "java",
    "spring boot",
    "microservices",
    "rest api",
    "backend",
    "react",
    "angular",
    "oauth",
    "oidc",
    "jwt",
    "kafka",
    "docker",
    "kubernetes"
  ];
  const relevantSkills = [
    "postgresql",
    "typescript",
    "jenkins",
    "tekton",
    "open shift",
    "identity",
    "entra id",
    "developer productivity"
  ];

  let score = 30;
  for (const skill of strongSkills) if (text.includes(skill)) score += 5;
  for (const skill of relevantSkills) if (text.includes(skill)) score += 3;
  if (/java/.test(text) && /spring boot/.test(text)) score += 12;
  if (["Sponsorship mentioned - verify", "Confirmed by recruiter"].includes(classifySponsorship(text))) {
    score += 10;
  }
  if (/senior|staff|principal|architect|10\+ years/.test(text)) score -= 20;
  if (/intern|internship|unpaid/.test(text)) score -= 40;
  return Math.max(0, Math.min(100, score));
}

export function getJobDedupeKey(job) {
  const urlKey = job.applyUrl?.trim().toLowerCase().replace(/\/$/, "") || "";
  if (urlKey) return urlKey;

  const fallbackKey = `${job.title || ""}|${job.company || ""}|${job.region || ""}`
    .toLowerCase()
    .replace(/\s+/g, " ");
  return fallbackKey.replace(/\|/g, "").trim() ? fallbackKey : "";
}

export function dedupeJobs(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    const key = getJobDedupeKey(job);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0));
}

export function filterJobs(jobs, {
  q = "",
  region = "all",
  category = "all",
  minScore = 0
} = {}) {
  const query = q.toLowerCase().trim();
  return jobs.filter((job) => {
    const title = job.title || "";
    const company = job.company || "";
    const location = job.location || "";
    const description = job.description || "";
    const text = `${title} ${company} ${location} ${description}`.toLowerCase();
    const matchesQuery = !query || text.includes(query);
    const matchesRegion = region === "all" ||
      (region === "Remote" ? normalizeRegion(job.region) === "Remote" : job.region === region);
    const score = Number(job.fitScore || 0);
    const visaStatus = job.visa || "";
    const matchesCategory = category === "all" ||
      (category === "visa" && /sponsorship mentioned|mentioned.*verify|confirmed by recruiter/i.test(visaStatus)) ||
      (category === "highfit" && score >= 75) ||
      (category === "backend" && /java|spring|backend|microservice/.test(text)) ||
      (category === "fullstack" && /full.?stack|react|angular/.test(text));
    return matchesQuery && matchesRegion && score >= minScore && matchesCategory;
  });
}

export function mergeJobs(existing, incoming, refreshedSources, now = Date.now(), maxAgeDays = 45) {
  const refreshed = new Set(refreshedSources);
  const incomingKeys = new Set(incoming.map(getJobDedupeKey).filter(Boolean));
  const byKey = new Map();

  for (const job of [...existing, ...incoming]) {
    const key = getJobDedupeKey(job);
    if (!key) continue;
    const previous = byKey.get(key);
    if (!previous || new Date(job.fetchedAt || 0) > new Date(previous.fetchedAt || 0)) {
      byKey.set(key, job);
    }
  }

  const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;
  let expiredCount = 0;
  const retained = [];
  for (const [key, job] of byKey) {
    const fetchedAt = Date.parse(job.fetchedAt || "");
    const stale = !Number.isFinite(fetchedAt) || fetchedAt < cutoff;
    if (stale && refreshed.has(job.source) && !incomingKeys.has(key)) {
      expiredCount++;
      continue;
    }
    retained.push(job);
  }

  return {
    jobs: dedupeJobs(retained),
    expiredCount
  };
}

export function selectRotatedSearches(regionFirstSearches, remainingSearches, extraCount, rotation = 0) {
  if (!remainingSearches.length || extraCount <= 0) return [...regionFirstSearches];
  const start = ((rotation % remainingSearches.length) + remainingSearches.length) % remainingSearches.length;
  const extras = Array.from({ length: Math.min(extraCount, remainingSearches.length) }, (_, index) =>
    remainingSearches[(start + index) % remainingSearches.length]
  );
  return [...regionFirstSearches, ...extras];
}

export function countJobsBySource(jobs) {
  return jobs.reduce((counts, job) => {
    counts[job.source] = (counts[job.source] || 0) + 1;
    return counts;
  }, {});
}
