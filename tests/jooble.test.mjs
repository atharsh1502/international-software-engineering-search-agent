import test from "node:test";
import assert from "node:assert/strict";

import { fetchJoobleJobs } from "../netlify/functions/providers/jooble.mjs";
import { scoreJob } from "../netlify/functions/providers/job-utils.mjs";

test("reports the required Jooble key when it is not configured", async () => {
  const previous = process.env.JOOBLE_API_KEY;
  delete process.env.JOOBLE_API_KEY;
  try {
    const result = await fetchJoobleJobs(scoreJob);
    assert.deepEqual(result.jobs, []);
    assert.match(result.skipped, /JOOBLE_API_KEY/);
  } finally {
    if (previous !== undefined) process.env.JOOBLE_API_KEY = previous;
  }
});

test("searches GCC locations and normalizes Jooble job results", async () => {
  const previous = process.env.JOOBLE_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.JOOBLE_API_KEY = "test-key";
  const requests = [];
  globalThis.fetch = async (input, options) => {
    requests.push({ input, options });
    const requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        jobs: [{
          id: requestBody.location,
          title: "Java Spring Boot Developer",
          company: "Example Employer",
          location: requestBody.location,
          snippet: "Java and Spring Boot experience required",
          link: `https://jobs.example/${encodeURIComponent(requestBody.location)}`,
          updated: "2026-11-04T00:00:00.000Z"
        }]
      })
    };
  };

  try {
    const result = await fetchJoobleJobs(scoreJob);
    const requestedLocations = requests.map(({ options }) =>
      JSON.parse(options.body).location
    );
    assert.ok(requestedLocations.includes("United Arab Emirates"));
    assert.ok(requestedLocations.includes("Saudi Arabia"));
    assert.ok(requestedLocations.includes("Qatar"));
    assert.ok(requestedLocations.includes("Oman"));
    assert.ok(requestedLocations.includes("Kuwait"));
    assert.ok(requestedLocations.includes("Bahrain"));
    assert.equal(result.jobs.length, 8);
    assert.ok(result.jobs.every((job) => job.source === "Jooble"));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.refreshedSources, ["Jooble"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.JOOBLE_API_KEY;
    else process.env.JOOBLE_API_KEY = previous;
  }
});

test("does not treat a malformed successful Jooble response as a completed refresh", async () => {
  const previous = process.env.JOOBLE_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.JOOBLE_API_KEY = "test-key";
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ unexpected: [] })
  });

  try {
    const result = await fetchJoobleJobs(scoreJob);
    assert.deepEqual(result.jobs, []);
    assert.deepEqual(result.refreshedSources, []);
    assert.match(result.errors[0], /invalid response/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.JOOBLE_API_KEY;
    else process.env.JOOBLE_API_KEY = previous;
  }
});
