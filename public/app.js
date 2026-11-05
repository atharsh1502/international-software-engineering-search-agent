import * as pdfjsLib from "./vendor/pdf.min.mjs";
import {
  extractResumeKeywords,
  extractResumeText,
  scoreResumeAgainstJob
} from "./resume-matcher.mjs";

const state = { jobs: [], metadata: {}, view: "jobs" };
state.resumeKeywords = [];
state.resumeSkills = [];
pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
const $ = (id) => document.getElementById(id);
const escapeHtml = (s="") => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fmtDate = (s) => { if(!s) return "Date not listed"; const d=new Date(s); return Number.isNaN(d.getTime())?"Date not listed":d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}); };
function isRemoteRegion(value="") { return /remote|worldwide|anywhere/i.test(value) || ["Singapore","Malaysia","United Arab Emirates","Saudi Arabia","Qatar","Oman","Kuwait","Bahrain"].filter(region=>value.toLowerCase().includes(region.toLowerCase())).length>1; }
function initials(s="") { return s.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase() || "CO"; }
function showView(view) {
  state.view=view;
  document.querySelectorAll(".nav").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  $("jobsList").parentElement.classList.toggle("hidden",view!=="jobs");
  document.querySelector(".stats").classList.toggle("hidden",view!=="jobs");
  document.querySelector(".hero").classList.toggle("hidden",view!=="jobs");
  document.querySelector(".right-column").classList.toggle("hidden",view!=="jobs");
  $("profileView").classList.toggle("hidden",view!=="profile");
  $("resumeView").classList.toggle("hidden",view!=="resume");
  $("insightsView").classList.toggle("hidden",view!=="insights");
}
function renderStats() {
  const all=state.jobs;
  $("statTotal").textContent=all.length;
  $("statHigh").textContent=all.filter(j=>(j.fitScore||0)>=75).length;
  $("statVisa").textContent=all.filter(j=>/sponsorship mentioned|mentioned.*verify|confirmed by recruiter/i.test(j.visa||"")).length;
  const date=state.metadata.lastUpdated;
  $("statSync").textContent=date?new Date(date).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"Not yet";
  $("syncSub").textContent=date?new Date(date).toLocaleDateString():"API has not completed a sync";
  $("setupNotice").textContent=state.jobs.length
    ? `Loaded ${state.jobs.length} records. Last sync: ${date?new Date(date).toLocaleString():"not recorded"}.`
    : "No stored jobs yet. Configure ADZUNA_APP_ID and ADZUNA_APP_KEY in Netlify Site configuration → Environment variables, then deploy and run the daily-refresh function.";
  const providerIssues=[
    ...(Array.isArray(state.metadata.errors)?state.metadata.errors:[]),
    ...(Array.isArray(state.metadata.skipped)?state.metadata.skipped:[])
  ];
  const notice=$("providerNotice");
  notice.innerHTML=providerIssues.length
    ? `<b>Some job sources did not return results:</b> ${providerIssues.slice(0,5).map(escapeHtml).join(" · ")}${providerIssues.length>5?` · and ${providerIssues.length-5} more`:``}`
    : "";
  notice.classList.toggle("hidden",providerIssues.length===0);
}
function getFiltered() {
  let jobs=[...state.jobs], q=$("searchInput").value.trim().toLowerCase(), region=$("regionFilter").value, category=$("categoryFilter").value, sort=$("sortFilter").value;
  if(q) jobs=jobs.filter(j=>`${j.title} ${j.company} ${j.description} ${j.location}`.toLowerCase().includes(q));
  if(region!=="all") jobs=jobs.filter(j=>region==="Remote"?isRemoteRegion(j.region||""):(j.region===region));
  if(category==="backend") jobs=jobs.filter(j=>/java|spring|backend|microservice/i.test(`${j.title} ${j.description}`));
  if(category==="fullstack") jobs=jobs.filter(j=>/full.?stack|react|angular/i.test(`${j.title} ${j.description}`));
  if(category==="highfit") jobs=jobs.filter(j=>(j.fitScore||0)>=75);
  if(category==="visa") jobs=jobs.filter(j=>/sponsorship mentioned|mentioned.*verify|confirmed by recruiter/i.test(j.visa||""));
  jobs.sort((a,b)=>sort==="date"?new Date(b.postedAt||0)-new Date(a.postedAt||0):(b.fitScore||0)-(a.fitScore||0));
  return jobs;
}
function renderJobs() {
  const jobs=getFiltered();
  $("resultCount").textContent=`${jobs.length} role${jobs.length===1?"":"s"}`;
  $("jobsList").innerHTML=jobs.map(j=>{
    const score=Math.max(0,Math.min(100,Number(j.fitScore||0)));
    const tags=[j.region,j.source||"Job API",j.experience||"Experience not specified"].filter(Boolean);
    const visaStatus=j.visa||"Sponsorship not stated";
    const sponsorshipMentioned=/sponsorship mentioned|mentioned.*verify/i.test(visaStatus);
    const sponsorshipConfirmed=/confirmed by recruiter/i.test(visaStatus);
    return `<article class="job-card">
      <div class="job-head"><div class="company-logo">${escapeHtml(initials(j.company))}</div><div class="job-main">
        <div class="job-title">${escapeHtml(j.title||"Software Engineer")}</div><div class="company-line">${escapeHtml(j.company||"Company not listed")} · ${escapeHtml(j.location||j.region||"Location not listed")}</div>
      </div></div>
      <div class="job-meta"><span>${escapeHtml(j.region||"International")}</span><span>Posted ${escapeHtml(fmtDate(j.postedAt))}</span><span>${escapeHtml(j.salary||"Salary not disclosed")}</span></div>
      <div class="job-tags">${tags.map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join("")}<span class="tag${sponsorshipMentioned||sponsorshipConfirmed?" visa":""}">${escapeHtml(sponsorshipConfirmed?"Sponsorship confirmed by recruiter":sponsorshipMentioned?"Sponsorship mentioned - verify":visaStatus)}</span></div>
      <div class="job-footer"><div class="match"><span class="match-score">${score}%</span><div><div class="match-bar"><i style="width:${score}%"></i></div><small>Estimated skills match</small></div></div>
        <a class="apply-btn" href="${escapeHtml(j.applyUrl||"#")}" target="_blank" rel="noopener noreferrer" ${j.applyUrl?"":"aria-disabled='true'"}>View / Apply ↗</a>
      </div>
    </article>`;
  }).join("");
  $("emptyState").classList.toggle("hidden",jobs.length>0);
  $("jobsList").classList.toggle("hidden",jobs.length===0);
}
function renderResumeResults() {
  const keywords = state.resumeKeywords;
  const matches = state.jobs.map(job => ({
    job,
    ...scoreResumeAgainstJob(keywords, job)
  })).sort((a,b)=>b.score-a.score).slice(0,10);
  $("resumeKeywordCount").textContent=keywords.length;
  $("resumeBestScore").textContent=matches.length?`${matches[0].score}%`:"—";
  $("resumeSkillTags").innerHTML=state.resumeSkills.length
    ? state.resumeSkills.map(skill=>`<span>${escapeHtml(skill)}</span>`).join("")
    : '<span>No recognized skills found; keyword matches are still shown.</span>';
  $("resumeKeywordTags").innerHTML=keywords.map(keyword=>`<span>${escapeHtml(keyword)}</span>`).join("");
  $("resumeMatchList").innerHTML=matches.length?matches.map(({job,score,matchedKeywords,missingKeywords})=>`
    <article class="resume-match-card">
      <div class="resume-match-heading">
        <div><b>${escapeHtml(job.title||"Software Engineer")}</b><small>${escapeHtml(job.company||"Company not listed")} · ${escapeHtml(job.region||job.location||"Region not listed")}</small></div>
        <strong>${score}%</strong>
      </div>
      <div class="resume-match-keywords"><b>Matched:</b> ${escapeHtml(matchedKeywords.slice(0,8).join(", ")||"No direct keyword matches")}</div>
      ${missingKeywords.length?`<div class="resume-match-keywords muted"><b>Consider emphasizing if accurate:</b> ${escapeHtml(missingKeywords.slice(0,5).join(", "))}</div>`:""}
      <a class="apply-btn" href="${escapeHtml(job.applyUrl||"#")}" target="_blank" rel="noopener noreferrer" ${job.applyUrl?"":"aria-disabled='true'"}>View / Apply ↗</a>
    </article>`).join(""):'<p>No current jobs are loaded to compare against.</p>';
  $("resumeResults").classList.remove("hidden");
}
async function loadJobs() {
  $("jobsList").innerHTML='<div class="loading-card"><div class="spinner"></div><b>Loading current job results…</b><span>Reading the daily API snapshot.</span></div>';
  try {
    const response=await fetch("/api/jobs",{cache:"no-store"});
    if(!response.ok) throw new Error(`API error ${response.status}`);
    const data=await response.json();
    state.jobs=data.jobs||[];state.metadata=data.metadata||{};
    renderStats();renderJobs();
    if(state.resumeKeywords.length) renderResumeResults();
  } catch(error) {
    $("jobsList").innerHTML=`<div class="loading-card"><b>Could not connect to the job API.</b><span>${escapeHtml(error.message)}. Check Netlify deployment and environment setup.</span></div>`;
    $("setupNotice").textContent="API endpoint is not reachable yet. Deploy the project to Netlify, then configure the API keys.";
  }
}
$("refreshBtn").addEventListener("click", async () => {
  const button = $("refreshBtn");

  button.disabled = true;
  button.textContent = "Loading jobs...";

  try {
    await loadJobs();
  } finally {
    button.disabled = false;
    button.textContent = "↻ Reload saved jobs";
  }
});
$("resumeFile").addEventListener("change", async (event) => {
  const file=event.target.files?.[0];
  if(!file) return;
  $("resumeStatus").textContent="Reading resume locally…";
  $("resumeResults").classList.add("hidden");
  try {
    const text=await extractResumeText(file,window.mammoth,pdfjsLib);
    if(!text.trim()) throw new Error("No readable text found. Scanned PDFs need OCR before upload.");
    const result=extractResumeKeywords(text);
    if(!result.keywords.length) throw new Error("Could not identify searchable keywords in this resume.");
    state.resumeKeywords=result.keywords;
    state.resumeSkills=result.skills;
    $("resumeStatus").textContent=`Analyzed ${file.name} locally. Resume text was not uploaded or saved.`;
    renderResumeResults();
  } catch(error) {
    state.resumeKeywords=[];
    state.resumeSkills=[];
    $("resumeStatus").textContent=error.message||"Unable to read this resume.";
  }
});
$("clearResume").addEventListener("click",()=>{
  state.resumeKeywords=[];
  state.resumeSkills=[];
  $("resumeFile").value="";
  $("resumeResults").classList.add("hidden");
  $("resumeStatus").textContent="Your file stays on this device. Scanned PDFs without selectable text need OCR first.";
});
["searchInput","regionFilter","categoryFilter","sortFilter"].forEach(id=>$(id).addEventListener(id==="searchInput"?"input":"change",renderJobs));
$("clearFilters").addEventListener("click",()=>{$("searchInput").value="";$("regionFilter").value="all";$("categoryFilter").value="all";renderJobs();});
document.querySelectorAll("[data-view]").forEach(el=>el.addEventListener("click",()=>showView(el.dataset.view)));
showView("jobs");
loadJobs();
