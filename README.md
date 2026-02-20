# github-lang-stats

CLI that computes **per-author** GitHub language statistics by inspecting the files changed in every commit authored by a given user.

Unlike `GET /repos/{owner}/{repo}/languages` (which returns repo-wide bytes regardless of who wrote them), this tool only counts lines in files **you personally changed**.

## How it works

| Phase | API | Cost |
|---|---|---|
| 1. Discover repos | GraphQL `contributionsCollection` | ~20 calls (one per year) |
| 2. Collect commit SHAs per repo | GraphQL `history(author: ...)` | ~1 call per 100 commits |
| 3. Fetch per-commit file details | REST `GET /repos/:owner/:repo/commits/:sha` | 1 call per commit |

Progress is cached in `.github-lang-stats-cache/<user>.json` so **interrupted runs resume from where they left off**.

## Metric: `lines_changed`

For each file in each commit we count `additions + deletions`. This is a proxy for "language activity" — it's not as precise as bytes stored, but it correctly reflects only work you did.

## Installation & usage

### npx (no install)

```sh
npx github-lang-stats --user=<github-username> --token=<pat> --output=stats.json
```


### Global install

```sh
npm i -g github-lang-stats
gls --user=<github-username> --token=<pat>
# or the long form:
github-lang-stats --user=<github-username> --token=<pat>
```


### Programmatic API

```sh
npm i github-lang-stats
```

```ts
import { getGithubLangStats, type ProgressEvent } from "github-lang-stats";

const stats = await getGithubLangStats({
  user: "octocat",
  token: process.env.GITHUB_TOKEN,

  // all fields below are optional
  fromYear: 2020,                        // defaults to 10 years ago
  excludeLanguages: ["JSON", "YAML"],    // omit languages from totals
  concurrency: 5,                        // concurrent REST requests (default: 5)
  cachePath: "./.my-cache/octocat.json", // override default cache location
  useCache: true,                        // set false to disable caching
  repos: ["octocat/Hello-World"],        // restrict to specific repos; omit for all
  onProgress: (e: ProgressEvent) => {
    if (e.phase === "discover") console.log(e.details);
    if (e.phase === "shas")    console.log(`${e.repo}: ${e.count} commits`);
    if (e.phase === "details") console.log(`${e.fetched}/${e.total} commits fetched`);
    if (e.phase === "aggregate") console.log("Aggregating…");
  },
});

console.log(stats.totals); // { TypeScript: 412000, … }
```

#### `ProgressEvent` shape

| `phase` | Extra fields | When fired |
|---|---|---|
| `"discover"` | `details: string` | Once per year scanned |
| `"shas"` | `repo: string`, `count: number` | Once per repo after all SHAs collected |
| `"details"` | `fetched: number`, `total: number` | After every concurrency-batch of REST calls |
| `"aggregate"` | — | Once, just before the final roll-up |

### Local development

```sh
npm install              # also installs the lefthook commit-msg hook
npm run dev -- --user=<github-username> --token=<pat>   # live run via tsx (no build step)
npm run build            # compile to dist/
node dist/index.js --user=<github-username> --token=<pat> --output=stats.json
npm run lint             # biome lint
npm run lint:fix         # biome lint + auto-fix
npm run format           # biome format
```

Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/) — `lefthook` enforces this via a `commit-msg` hook. The [Conventional Commits VS Code extension](https://marketplace.visualstudio.com/items?itemName=vivaxy.vscode-conventional-commits) is recommended (`.vscode/extensions.json`).

## Token scopes required

| Scope | Why |
|---|---|
| `repo` | Read access to private repositories |
| `read:user` | Fetch verified email addresses for commit matching |

## Options

```
Usage: gls|github-lang-stats [options]

Options:
  -u, --user <username>      GitHub username (required)
  -t, --token <pat>          GitHub PAT (required)
  -o, --output <path>        Write JSON to file (default: stdout)
  --cache <path>             Override cache file path
  --no-cache                 Disable caching (start fresh each run)
  --concurrency <n>          Concurrent REST requests (default: 5)
  --from-year <year>         Earliest year to include (default: 10 years ago)
  --exclude-langs <langs>    Comma-separated languages to exclude (e.g. HCL,JSON)
  --select-repos             Interactively pick repos to analyse after commit counts are known
  --stats-only               Re-aggregate from cache without fetching new data
  --reset                    Delete cache and start fresh
  -V, --version              Print version
  -h, --help                 Print help
```

### `--select-repos` interactive picker

When passed, after all commit SHAs have been collected the tool shows a full-screen
checkbox list sorted by **number of commits** (highest first). All repos are pre-selected:

```
? Choose repos (42 total, sorted by commit count)
❯◉ myorg/monorepo                                       1 248 commits
 ◉ myorg/frontend                                         832 commits
 ◉ octocat/personal-site                                  201 commits
 ...
```

| Key | Action |
|-----|--------|
| `space` | Toggle selected repo |
| `a` | Toggle **all** (select all / deselect all) |
| `i` | Invert selection |
| `enter` | Confirm and continue |

## Output format

```json
{
  "totals": {
    "TypeScript": 412000,
    "JavaScript": 88000,
    "Svelte": 43000
  },
  "byRepo": {
    "myorg/myrepo": {
      "TypeScript": 200000,
      "CSS": 5000
    }
  },
  "meta": {
    "user": "maxfriedmann",
    "generatedAt": "2026-02-20T10:00:00.000Z",
    "totalCommitsProcessed": 12450,
    "totalRepos": 47,
    "unit": "lines_changed"
  }
}
```

### Using the output in the CV widget

The `totals` field maps directly to the `githubLanguageTotals` field in the CV widget schema — just copy it in.

## Tips

- **First run is slow** — at 5k req/hr with 30k commits it can take hours. Let it run overnight; it saves progress every 50 commits.
- **Subsequent runs are fast** — only new commits since the last run are fetched.
- **Exclude infrastructure languages** with `--exclude-langs HCL,Dockerfile` if teammates committed those to repos you also touched.
- **Adjust concurrency** carefully — GitHub's [secondary rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) may trigger at high concurrency even if your primary limit is not exhausted. `5` is a safe default.

---

Made by [smallstack GmbH](https://smallstack.com) · [GitHub](https://github.com/smallstack/github-lang-stats) · [npm](https://www.npmjs.com/package/github-lang-stats)
