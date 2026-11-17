# Setting up VIGIL

Everything below happens on the **github.com website**. Nothing gets installed on your laptop and you don't need admin rights. GitHub runs the collector on its own servers; your laptop only opens a web page.

It takes about 10 minutes. Wherever you see `<you>`, use your GitHub username.

## 1. Create the repository

1. Sign in at **github.com** with your personal account.
2. Top right **+** → **New repository**.
3. Name: `vigil` · Visibility: **Public** · leave everything else as it is → **Create repository**.

> It has to be public: GitHub Pages and Actions are free for public repositories. Only public advisory data and code go in it. Your inventory never does.

## 2. Upload the files

1. On the new repository page, click **uploading an existing file**.
2. Open the `vigil` folder on your laptop, select **everything inside it** (including the `.github` folder), and drag it onto the page.
3. Wait until the list finishes, then click **Commit changes**.
4. Check that the repository now shows `.github`, `collector`, `docs`, `site` and `README.md`.

**If `.github` is missing** (some browsers skip folders that start with a dot):

1. Click **Add file** → **Create new file**.
2. Type the name exactly as `.github/workflows/collect.yml`. The slashes create the folders.
3. Open `vigil/.github/workflows/collect.yml` from your laptop in Notepad, copy everything, and paste it in.
4. Click **Commit changes**.

## 3. Turn on GitHub Pages

1. **Settings** (the tab on the repository) → **Pages** in the left menu.
2. Under **Build and deployment** → **Source**, pick **GitHub Actions**.

## 4. Turn on Actions and run it once

1. Open the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.
2. On the left, click **VIGIL collect** → **Run workflow** → **Run workflow**.
3. The first run takes **10–20 minutes**, because it loads 90 days of history from NVD slowly to stay within their rate limits. A green tick means it worked.
4. After that it runs by itself every 15 minutes. GitHub sometimes runs scheduled jobs a few minutes late, which is normal.

## 5. Open VIGIL

Go to **`https://<you>.github.io/vigil/`** and bookmark it in Edge.

On first open:
1. The boot screen lists each feed.
2. Open **Settings** → **Choose file** (or drop the file anywhere on the page) and pick `Q4_PTM_Inventory.xlsx`.
3. VIGIL reads the **PTM Tracker** sheet in your browser. It is never uploaded. The browser remembers it until you click **Forget inventory**.
4. Each month, drop the new tracker file and it replaces the old one.

## Optional: faster NVD (free API key)

Without a key, NVD makes VIGIL wait 6 seconds between requests. With a free key, the wait drops to under a second.

1. Request a key at **nvd.nist.gov/developers/request-an-api-key**. It is emailed to you.
2. In the repository: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
3. Name: `NVD_API_KEY` · Secret: paste the key → **Add secret**.

## Later: Teams alerts (off for now)

The Teams hook is built in but switched off. It only sends when **both** of these exist:

1. **Secret** `VIGIL_TEAMS_URL`: the webhook address. In Teams, the channel's **Workflows** → "Post to a channel when a webhook request is received" gives you this address. Your company may need to allow this.
2. **Variable** `VIGIL_TEAMS` = `on`, set under **Settings** → **Secrets and variables** → **Actions** → **Variables** tab.

Messages name only the CVE, vendor, severity and link. No client or device names exist on GitHub, so none can be sent.

To switch it off again, delete the variable or set it to `off`.

## What to check

- [ ] `https://<you>.github.io/vigil/` opens **on the company network** (some networks block `github.io`; if yours does, ask IT to allow it).
- [ ] The boot screen shows each feed as **✓ online**. One `! stale` is fine; it retries every 15 minutes.
- [ ] After dropping the inventory, the triage list shows affected device and client counts.
- [ ] **Vendors** page → *Unmatched manufacturers* lists rows like `0`, `#N/A`, `Server`. Fixing those in the tracker brings them into view.
- [ ] **Settings** → *Lite mode* turns off all motion, and the page still works.
- [ ] **Settings** → *Turn on Windows notifications* works if you want desktop pop-ups.

## If something goes wrong

| What you see | What to do |
|---|---|
| Actions run shows a red ✗ | Open the run and read the failed step. A failing **Test** step means the code was changed. Re-upload the original files. |
| The page says *data unavailable* | The first run hasn't finished yet, or Pages isn't set to **GitHub Actions** (step 3). |
| A feed stays `stale` for a day | That vendor changed their feed. Everything else keeps working. |
| The scheduled runs stopped | GitHub pauses scheduled workflows in repositories with no activity for 60 days. **Actions** → **VIGIL collect** → **Enable workflow**. |
