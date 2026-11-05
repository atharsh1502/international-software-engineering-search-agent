import test from "node:test";
import assert from "node:assert/strict";

import { fetchJSearchJobs } from "../netlify/functions/providers/jsearch.mjs";
import { scoreJob } from "../netlify/functions/providers/job-utils.mjs";

test("skips JSearch with a clear setup hint when its API key is absent", async () => {
  const previous = process.env.JSEARCH_API_KEY;
  delete process.env.JSEARCH_API_KEY;
  try {
    const result = await fetchJSearchJobs(scoreJob);
    assert.deepEqual(result.jobs, []);
    assert.match(result.skipped, /JSEARCH_API_KEY/);
  } finally {
    if (previous !== undefined) process.env.JSEARCH_API_KEY = previous;
  }
});

test("searches target countries and returns normalized JSearch listings", async () => {
  const previous = process.env.JSEARCH_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.JSEARCH_API_KEY = "test-key";
  const requests = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    requests.push({ url, options });
    const country = url.searchParams.get("country");
    const cityCountry = country === "ae"
      ? ["Dubai", "United Arab Emirates"]
      : ["Doha", "Qatar"];
    return {
      ok: true,
      json: async () => ({
        data: [{
          job_id: `job-${country}`,
          job_title: "Java Spring Boot Engineer",
          employer_name: "Example Employer",
          job_city: cityCountry[0],
          job_country: cityCountry[1],
          job_description: "Java and Spring Boot experience required",
          job_apply_link: `https://jobs.example/${country}`,
          job_posted_at_datetime_utc: "2026-11-04T00:00:00.000Z",
          job_is_remote: false
        }]
      })
    };
  };

  try {
    const result = await fetchJSearchJobs(scoreJob);
    assert.equal(requests.length, 8);
    assert.ok(requests.every(({ options }) =>
      options.headers["X-RapidAPI-Host"] === "jsearch.p.rapidapi.com" &&
      options.headers["X-RapidAPI-Key"] === "test-key"
    ));
    assert.ok(requests.some(({ url }) =>
      url.searchParams.get("country") === "ae" &&
      url.searchParams.get("query").includes("United Arab Emirates")
    ));
    assert.equal(result.jobs.length, 8);
    assert.ok(result.jobs.some((job) => job.region === "United Arab Emirates"));
    assert.ok(result.jobs.some((job) => job.region === "Qatar"));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.refreshedSources, ["JSearch"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.JSEARCH_API_KEY;
    else process.env.JSEARCH_API_KEY = previous;
  }
});

test("does not mark JSearch refreshed if any country search fails", async () => {
  const previous = process.env.JSEARCH_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.JSEARCH_API_KEY = "test-key";
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.searchParams.get("country") === "sa") {
      return { ok: false, status: 429 };
    }
    return { ok: true, json: async () => ({ data: [] }) };
  };

  try {
    const result = await fetchJSearchJobs(scoreJob);
    assert.deepEqual(result.refreshedSources, []);
    assert.match(result.errors[0], /Saudi Arabia: JSearch HTTP 429/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.JSEARCH_API_KEY;
    else process.env.JSEARCH_API_KEY = previous;
  }
});
