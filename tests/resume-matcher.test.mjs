import test from "node:test";
import assert from "node:assert/strict";

import {
  extractResumeKeywords,
  extractResumeText,
  scoreResumeAgainstJob
} from "../public/resume-matcher.mjs";

test("extracts technical skills and useful keywords from resume text", () => {
  const result = extractResumeKeywords(
    "Software engineer with Java, Spring Boot, REST APIs, PostgreSQL, Docker and Kubernetes experience."
  );

  assert.ok(result.skills.includes("Java"));
  assert.ok(result.skills.includes("Spring Boot"));
  assert.ok(result.skills.includes("PostgreSQL"));
  assert.ok(result.keywords.includes("Kubernetes"));
  assert.ok(!result.keywords.includes("spring"));
  assert.ok(!result.keywords.includes("boot"));
});

test("scores a job by resume keyword coverage and lists missing terms", () => {
  const keywords = extractResumeKeywords("Java Spring Boot REST APIs PostgreSQL Docker").keywords;
  const result = scoreResumeAgainstJob(keywords, {
    title: "Java Spring Boot Engineer",
    description: "Build REST APIs with PostgreSQL and Kubernetes."
  });

  assert.ok(result.score > 0);
  assert.ok(result.matchedKeywords.includes("Java"));
  assert.ok(result.matchedKeywords.includes("REST APIs"));
  assert.ok(result.missingKeywords.includes("Kubernetes"));
});

test("reads supported text resumes locally and rejects unsupported formats", async () => {
  const file = {
    name: "resume.txt",
    size: 20,
    text: async () => "Java engineer with Spring Boot."
  };
  assert.equal(await extractResumeText(file), "Java engineer with Spring Boot.");
  await assert.rejects(
    extractResumeText({ ...file, name: "resume.rtf" }),
    /Choose a PDF, DOCX, or TXT/
  );
  await assert.rejects(
    extractResumeText({ ...file, size: 10 * 1024 * 1024 + 1 }),
    /10 MB or smaller/
  );
});

test("extracts DOCX text locally through the browser parser", async () => {
  const file = {
    name: "resume.docx",
    size: 12,
    arrayBuffer: async () => new ArrayBuffer(8)
  };
  const result = await extractResumeText(file, {
    extractRawText: async ({ arrayBuffer }) => {
      assert.ok(arrayBuffer instanceof ArrayBuffer);
      return { value: "Java Spring Boot engineer" };
    }
  });
  assert.equal(result, "Java Spring Boot engineer");
});

test("extracts PDF text page-by-page and releases the document", async () => {
  let destroyed = false;
  const file = {
    name: "resume.pdf",
    size: 12,
    arrayBuffer: async () => new ArrayBuffer(8)
  };
  const pdfjs = {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async (pageNumber) => ({
          getTextContent: async () => ({
            items: [{ str: pageNumber === 1 ? "Java engineer" : "Spring Boot" }]
          })
        }),
        destroy: async () => { destroyed = true; }
      })
    })
  };

  assert.equal(await extractResumeText(file, undefined, pdfjs), "Java engineer\nSpring Boot");
  assert.equal(destroyed, true);
});
