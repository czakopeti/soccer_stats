# PL X-ray

A weekly Premier League page. It shows what the scoreline leaves out: chances, luck, strength, and the run of fixtures ahead. The page is in English. It rebuilds itself every Wednesday. You do not need to check the numbers by hand. If a check fails, the old page stays up and GitHub opens an issue that says what went wrong, in plain language.

The page is published at:

**https://czakopeti.github.io/soccer_stats/**

## What you have to click once

Do these after this change is merged. You only do them once.

1. Open the repository on GitHub.
2. Click **Settings**, then **Pages** (under Code and automation).
3. Under **Build and deployment**, set **Source** to **GitHub Actions**. Save if it asks.
4. Click **Settings**, then **Actions**, then **General**.
5. Under **Workflow permissions**, choose **Read and write permissions**. Save.
   This lets the Wednesday job save that week's data and open an issue if something breaks.
6. Click the **Actions** tab, open **Weekly update**, and click **Run workflow** → **Run workflow**.
   The first run takes a few minutes. After that it runs on its own every Wednesday at 08:00 UTC.
7. Leave the repository **public**. Free GitHub Pages hosting is for public repositories.

You do not install anything. You do not edit numbers. You do not upload a file.

## What happens every Wednesday

1. The job downloads fresh match data, the official fixture list, older league results, and European fixtures.
2. It builds the page.
3. It runs the checks (scores add up, names match, the page actually opens, the text is English).
4. If every check passes, the new page replaces the old one.
5. If a check fails, visitors keep seeing last week's page, and an issue titled **[PL X-ray] Weekly update did not publish** explains the problem. The next successful Wednesday replaces it. You can close the issue once a later run has succeeded.

An international break is not a failure. The job writes "no new round", still refreshes the fixture list, and publishes.

You can also run it yourself any day: **Actions** → **Weekly update** → **Run workflow**.

## Where the numbers come from

| What | Where it comes from | How often it changes |
|---|---|---|
| Matches, shots, xG, players, Opta totals, squad values, injury news | [pl-catalogue](https://github.com/oladeeayo/pl-catalogue) | About Tuesday 10:00 UTC. Non-commercial. The page credits it. |
| The same catalogue, underneath | The Premier League's Fantasy site, Understat, Opta, Transfermarkt | Via pl-catalogue only |
| Kickoff times, the fixture list, scores, the list of clubs | The Premier League's own public fixture feed | Every run. Postponements and TV moves are picked up here. |
| Older Premier League and Championship results, used only to rate clubs before the season starts | [football-data.co.uk](https://www.football-data.co.uk/) result files (no prices are read) | Historical files, re-downloaded every run |
| Champions League, Europa League and Conference League kickoffs | ESPN's public football schedule | Every run |

Bookmaker prices are not shown, and they are not downloaded.

If pl-catalogue is late or its private update pipeline stops, the checks notice that a finished gameweek is missing and refuse to publish. The previous page stays up.

## What is stored

Each successful run keeps a copy of that week's numbers in `snapshots/`, and the latest copy in `data/`. That is how the job knows a player's minutes did not shrink, and how it reports a kickoff that moved. `data/status.json` is a short machine-readable report. The human version is the **Build status** link in the page footer, and `status.html` next to the site.

## If you want to look at the working copy

You do not need to. If someone technical does:

```bash
pip install -r requirements.txt
python3 -m playwright install chromium
python3 scripts/run_pipeline.py
```

Then open `site/index.html`. Checks that do not need a download:

```bash
python3 -m unittest discover -s tests -v
```

Model settings that are choices, not measurements, live in one file: `config/model.json`. What each number means is in `MODELS.md`. Every value that used to be typed in by hand, and what happened to it, is in `AUDIT.md`.
