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

  for (const [region, pattern] of regions) {
    if (pattern.test(normalized)) return region;
  }
  if (!value || /remote|worldwide|anywhere|work from anywhere/i.test(value)) {
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
