import test from "node:test";
import assert from "node:assert/strict";

import {
  classifySponsorship,
  dedupeJobs,
  filterJobs,
  getJobDedupeKey,
  mergeJobs,
  normalizeRegion,
  selectRotatedSearches,
  scoreJob
} from "../netlify/functions/providers/job-utils.mjs";
import { fetchATSJobs } from "../netlify/functions/providers/ats.mjs";

const now = Date.parse("2026-11-04T00:00:00.000Z");
const daysAgo = (days) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
const makeJob = (overrides = {}) => ({
  source: "Adzuna",
  title: "Java Backend Engineer",
  company: "Example",
  location: "Singapore",
  region: "Singapore",
  description: "Java and Spring Boot",
  applyUrl: "https://jobs.example/1",
  fetchedAt: daysAgo(1),
  fitScore: 70,
  visa: "Sponsorship not stated",
  ...overrides
});

test("normalizes explicit locations and keeps remote and regional clusters separate", () => {
  assert.equal(normalizeRegion("Dubai, UAE"), "United Arab Emirates");
  assert.equal(normalizeRegion("Abu Dhabi, United Arab Emirates"), "United Arab Emirates");
  assert.equal(normalizeRegion("Riyadh, Saudi Arabia"), "Saudi Arabia");
  assert.equal(normalizeRegion("Remote - EMEA"), "Remote");
  assert.equal(normalizeRegion("Remote - Worldwide"), "Remote");
  assert.equal(normalizeRegion("Gulf region"), "GCC / Middle East");
  assert.equal(normalizeRegion("Middle East"), "GCC / Middle East");
  assert.equal(normalizeRegion("GCC"), "GCC / Middle East");
  assert.equal(normalizeRegion("Singapore / Malaysia"), "Multiple regions");
});

test("classifies sponsorship mentions without treating them as confirmation", () => {
  assert.equal(classifySponsorship("Visa assistance available"), "Sponsorship mentioned - verify");
  assert.equal(classifySponsorship("We do not offer visa sponsorship"), "Sponsorship unavailable");
  assert.equal(classifySponsorship("Ordinary job description"), "Sponsorship not stated");
  assert.equal(classifySponsorship("Visa assistance available", true), "Confirmed by recruiter");
});

test("scores relevant jobs higher, penalizes seniority, and clamps to range", () => {
  const relevant = scoreJob({ title: "Java Spring Boot Backend Engineer" });
  const unrelated = scoreJob({ title: "Office Administrator" });
  const senior = scoreJob({ title: "Senior Java Spring Boot Architect, 10+ years" });
  const intern = scoreJob({ title: "Java Internship unpaid" });

  assert.ok(relevant > unrelated);
  assert.ok(senior < relevant);
  assert.equal(intern, 0);
  assert.equal(scoreJob({ title: "Java Spring Boot React Angular Microservices Docker Kubernetes Kafka OAuth OIDC JWT" }), 97);
});

test("deduplicates jobs by normalized application URL and fallback identity", () => {
  const first = makeJob({ applyUrl: "https://jobs.example/1/" });
  const duplicate = makeJob({ applyUrl: "https://jobs.example/1" });
  const fallback = makeJob({ applyUrl: "", title: "Backend Engineer", company: "Example", region: "UAE" });
  const sameFallback = { ...fallback, applyUrl: "", title: "Backend Engineer" };

  assert.equal(getJobDedupeKey(first), "https://jobs.example/1");
  assert.equal(dedupeJobs([first, duplicate, fallback, sameFallback]).length, 2);
});

test("filters jobs by query, normalized remote region, sponsorship mention, and fit", () => {
  const jobs = [
    makeJob({ title: "Java Engineer", region: "Singapore", visa: "Sponsorship mentioned - verify", fitScore: 80 }),
    makeJob({ title: "React Developer", region: "Remote - Worldwide", location: "Remote - Worldwide", applyUrl: "https://jobs.example/2", fitScore: 75 }),
    makeJob({ title: "Java Intern", visa: "Sponsorship unavailable", applyUrl: "https://jobs.example/3", fitScore: 20 })
  ];

  assert.equal(filterJobs(jobs, { region: "Remote" }).length, 1);
  assert.equal(filterJobs(jobs, { category: "visa" }).length, 1);
  assert.equal(filterJobs(jobs, { category: "highfit" }).length, 2);
  assert.equal(filterJobs(jobs, { q: "react", region: "Remote" }).length, 1);
  assert.equal(filterJobs(jobs, { region: "Singapore", minScore: 75 }).length, 1);
});

test("expires stale jobs only for successfully refreshed providers", () => {
  const staleAdzuna = makeJob({ fetchedAt: daysAgo(46), applyUrl: "https://jobs.example/stale" });
  const failedJobicy = makeJob({
    source: "Jobicy",
    title: "Remote Engineer",
    region: "Remote",
    applyUrl: "https://jobs.example/failed",
    fetchedAt: daysAgo(90)
  });
  const recentAdzuna = makeJob({ applyUrl: "https://jobs.example/recent", fetchedAt: daysAgo(30) });
  const incoming = makeJob({ applyUrl: "https://jobs.example/new", fetchedAt: daysAgo(0) });

  const result = mergeJobs(
    [staleAdzuna, failedJobicy, recentAdzuna],
    [incoming],
    ["Adzuna"],
    now,
    45
  );
  const urls = result.jobs.map((job) => job.applyUrl);

  assert.equal(result.expiredCount, 1);
  assert.ok(!urls.includes(staleAdzuna.applyUrl));
  assert.ok(urls.includes(failedJobicy.applyUrl));
  assert.ok(urls.includes(recentAdzuna.applyUrl));
  assert.ok(urls.includes(incoming.applyUrl));
});

test("preserves all existing jobs when a provider fails and no provider refreshes successfully", () => {
  const stale = makeJob({ fetchedAt: daysAgo(120) });
  const result = mergeJobs([stale], [], [], now, 45);

  assert.deepEqual(result.jobs, [stale]);
  assert.equal(result.expiredCount, 0);
});

test("rotates additional Adzuna searches while preserving one search per region", () => {
  const regionFirst = [{ region: "Singapore" }, { region: "Malaysia" }];
  const additional = [{ term: "a" }, { term: "b" }, { term: "c" }, { term: "d" }];

  const firstRotation = selectRotatedSearches(regionFirst, additional, 2, 0);
  const nextRotation = selectRotatedSearches(regionFirst, additional, 2, 1);
  assert.deepEqual(firstRotation.slice(0, 2), regionFirst);
  assert.deepEqual(firstRotation.slice(2), [additional[0], additional[1]]);
  assert.deepEqual(nextRotation.slice(2), [additional[1], additional[2]]);
});

test("reports ATS company entries without names as invalid configuration", async () => {
  const previous = process.env.ATS_COMPANIES_JSON;
  process.env.ATS_COMPANIES_JSON = JSON.stringify([
    { ats: "greenhouse", board: "example" }
  ]);
  try {
    const result = await fetchATSJobs(scoreJob);
    assert.deepEqual(result.jobs, []);
    assert.deepEqual(result.errors, [
      "ATS_COMPANIES_JSON entry 1: company name is required"
    ]);
  } finally {
    if (previous === undefined) delete process.env.ATS_COMPANIES_JSON;
    else process.env.ATS_COMPANIES_JSON = previous;
  }
});
