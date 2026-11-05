const SKILLS = [
  ["Java", ["java"]],
  ["Spring Boot", ["spring boot"]],
  ["Spring", ["spring framework"]],
  ["Microservices", ["microservices", "microservice"]],
  ["REST APIs", ["rest api", "rest apis", "restful api", "restful apis"]],
  ["React", ["react"]],
  ["Angular", ["angular"]],
  ["TypeScript", ["typescript"]],
  ["JavaScript", ["javascript"]],
  ["Node.js", ["node.js", "nodejs"]],
  ["Python", ["python"]],
  ["C#", ["c#"]],
  ["C++", ["c++"]],
  ["SQL", ["sql"]],
  ["PostgreSQL", ["postgresql", "postgres"]],
  ["MySQL", ["mysql"]],
  ["MongoDB", ["mongodb"]],
  ["Redis", ["redis"]],
  ["Kafka", ["kafka"]],
  ["RabbitMQ", ["rabbitmq"]],
  ["Docker", ["docker"]],
  ["Kubernetes", ["kubernetes", "k8s"]],
  ["AWS", ["aws", "amazon web services"]],
  ["Azure", ["azure"]],
  ["Google Cloud", ["gcp", "google cloud"]],
  ["CI/CD", ["ci/cd", "continuous integration", "continuous delivery"]],
  ["Jenkins", ["jenkins"]],
  ["GitHub Actions", ["github actions"]],
  ["OAuth", ["oauth", "oauth 2.0"]],
  ["OIDC", ["oidc", "openid connect"]],
  ["JWT", ["jwt", "json web token"]],
  ["Microsoft Entra ID", ["microsoft entra id", "entra id", "azure ad"]],
  ["OpenShift", ["openshift", "open shift"]],
  ["Terraform", ["terraform"]],
  ["GraphQL", ["graphql"]],
  ["HTML", ["html"]],
  ["CSS", ["css"]],
  ["Agile", ["agile", "scrum"]],
  ["Machine Learning", ["machine learning"]],
  ["Generative AI", ["generative ai", "llm", "large language model"]]
];

const STOP_WORDS = new Set(
  "a an and are as at be been being by build building can candidate company developing development do each engineer engineering for from has have in into is it its job of on or our api backend frontend fullstack developer role should skills software strong team that the their this to using we with work working you your experience responsibilities requirements required preferred".split(" ")
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasTerm(text, term) {
  const escaped = escapeRegExp(term).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(text);
}

function extractTerms(text, limit = 30) {
  const normalized = String(text || "").toLowerCase().replace(/[^a-z0-9+#./-]+/g, " ");
  const terms = new Map();
  for (const match of normalized.matchAll(/[a-z][a-z0-9+#./-]{2,}/g)) {
    const term = match[0].replace(/[./-]+$/, "");
    if (term.length < 3 || STOP_WORDS.has(term) || /^\d+$/.test(term)) continue;
    terms.set(term, (terms.get(term) || 0) + 1);
  }
  return [...terms.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

export function extractResumeKeywords(text) {
  const content = String(text || "");
  const skills = SKILLS
    .filter(([, aliases]) => aliases.some((alias) => hasTerm(content, alias)))
    .map(([name]) => name);
  const skillParts = new Set(skills.flatMap((skill) => skill.toLowerCase().split(/[^a-z0-9+#]+/)));
  const terms = extractTerms(content, 30).filter((term) => !skillParts.has(term));
  const keywords = [...new Set([...skills, ...terms])];
  return { skills, keywords };
}

export function scoreResumeAgainstJob(resumeKeywords, job) {
  const jobText = `${job.title || ""} ${job.description || ""}`;
  const skills = SKILLS
    .filter(([, aliases]) => aliases.some((alias) => hasTerm(jobText, alias)))
    .map(([name]) => name);
  const skillParts = new Set(skills.flatMap((skill) => skill.toLowerCase().split(/[^a-z0-9+#]+/)));
  const jobTerms = extractTerms(jobText, 24).filter((term) => !skillParts.has(term));
  const requirements = [...new Set([...skills, ...jobTerms])];
  if (!requirements.length) {
    return { score: 0, matchedKeywords: [], missingKeywords: [] };
  }

  const resumeSet = new Set((resumeKeywords || []).map((term) => term.toLowerCase()));
  const matchedKeywords = requirements.filter((term) => resumeSet.has(term.toLowerCase()));
  const score = Math.round((matchedKeywords.length / requirements.length) * 100);
  return {
    score,
    matchedKeywords,
    missingKeywords: requirements.filter((term) => !resumeSet.has(term.toLowerCase())).slice(0, 8)
  };
}

export async function extractResumeText(file, mammoth, pdfjs) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["pdf", "docx", "txt"].includes(extension)) {
    throw new Error("Choose a PDF, DOCX, or TXT resume.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Resume files must be 10 MB or smaller.");
  }

  if (extension === "txt") return file.text();
  const data = await file.arrayBuffer();
  if (extension === "docx") {
    const result = await mammoth.extractRawText({ arrayBuffer: data });
    return result.value;
  }

  const document = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  try {
    if (document.numPages > 100) {
      throw new Error("PDF resumes must have 100 pages or fewer.");
    }
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str || "").join(" "));
    }
    return pages.join("\n");
  } finally {
    await document.destroy();
  }
}
