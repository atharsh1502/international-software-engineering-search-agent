# Atharsh G. — International Software Engineering Search AGENT

A Netlify-ready job discovery dashboard with:
- Responsive web dashboard for GCC, Singapore and Malaysia
- Server-side job API integration (Adzuna)
- Daily scheduled job search/refresh at **05:00 India Standard Time**
- Persistent job snapshots using Netlify Blobs
- Fit scoring, keyword/region filters, job application links and sponsorship signal labels
- API keys kept server-side in Netlify environment variables

## Important: Hosting status

This package is prepared for Netlify deployment, but it has **not been published yet**. Publishing requires authorization to your Netlify account/site. The steps below deploy it globally through Netlify CDN.

## 1. Get Adzuna API credentials

Register for API credentials at:
- https://developer.adzuna.com/overview
- https://developer.adzuna.com/activedocs

You need `app_id` and `app_key`. API coverage and results vary by country; verify the target country availability with Adzuna.

## 2. Deploy to Netlify

### Option A — Netlify CLI (recommended)
1. Install Node.js 20+.
2. Extract this ZIP.
3. Open a terminal in the extracted project folder:
   ```bash
   npm install
   npx netlify login
   npx netlify init
   ```
4. Select/create your Netlify site when prompted.
5. In Netlify Site configuration → Environment variables, add:
   - `ADZUNA_APP_ID` = your Adzuna app ID
   - `ADZUNA_APP_KEY` = your Adzuna API key
   - `JOB_REFRESH_SECRET` = a long random secret (use a password manager or generate one)
6. Ensure the variables are available to Functions. Trigger a new deploy after adding them.
7. Deploy:
   ```bash
   npm run build
   npx netlify deploy --prod
   ```
8. Netlify will provide a public `https://<site-name>.netlify.app` URL.

### Option B — Git-based deployment
1. Push the extracted project to a private GitHub repository.
2. In Netlify, choose **Add new site → Import an existing project**.
3. Build command: `npm run build` (or leave blank; the site is static)
4. Publish directory: `public`
5. Functions directory: `netlify/functions`
6. Add the same environment variables listed above.
7. Deploy.

## 3. Run the first data refresh
Scheduled function runs only after a **published production deploy**. It is scheduled at `30 23 * * *` UTC, which is **05:00 IST**.

To test immediately:
- Netlify Dashboard → Site → Functions → `daily-refresh` → **Run now**, or
- With Netlify CLI:
  ```bash
  npx netlify functions:invoke daily-refresh
  ```

For manual API refresh, call the protected endpoint from your terminal (never put the secret in frontend code):
```bash
curl -X POST "https://YOUR-SITE.netlify.app/api/refresh" \
  -H "x-refresh-secret: YOUR_JOB_REFRESH_SECRET"
```

## 4. How data flows
1. Netlify Scheduled Function calls Adzuna for configured regions and search terms.
2. Jobs are normalized, deduplicated and fit-scored.
3. The current snapshot is stored in Netlify Blobs.
4. Frontend calls `/api/jobs` to display the current snapshot.
5. Refresh metadata shows last successful sync.

## 5. Regions currently searched
Singapore, Malaysia, UAE, Saudi Arabia, Qatar, Oman, Kuwait and Bahrain.

## 6. Fit score / sponsorship caution
- Fit scores are heuristic keyword estimates, not ATS scores or guarantees.
- API search results may be duplicate, stale, or not accepting applications. Confirm the original employer page before applying.
- “Visa signal” only means the listing text contains a sponsorship/work-permit phrase. It is **not** a promise that an employer will sponsor an Indian applicant.
- Ask the recruiter directly whether they sponsor candidates currently residing in India.
- Do not pay recruiters or agencies for a job offer or visa sponsorship.

## 7. Daily run troubleshooting
- Scheduled functions run on published production deployments, not deploy previews.
- Schedule uses UTC. `30 23 * * *` = 05:00 next day IST.
- Check Netlify Functions logs for `daily-refresh`.
- Check environment variable scope and redeploy after changing variables.
- Adzuna may not return vacancies for every region or query. Empty responses preserve the last successful snapshot.
- Netlify Scheduled Functions have a 30-second execution limit; the code runs API queries concurrently.

## 8. Security notes
- Never put Adzuna keys or refresh secret in frontend JavaScript.
- Keep `JOB_REFRESH_SECRET` private.
- Do not commit `.env` files or credentials to GitHub.
- Consider Netlify access control / authentication if you want the dashboard private. By default, a Netlify URL is publicly accessible.
