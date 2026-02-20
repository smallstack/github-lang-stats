# Changelog

## [1.0.2](https://github.com/smallstack/github-lang-stats/compare/v1.0.1...v1.0.2) (2026-02-20)

### Features

* update LICENSE and package.json with company details and additional metadata

## [1.0.1](https://github.com/smallstack/github-lang-stats/compare/v1.0.0...v1.0.1) (2026-02-20)

### Features

* add `date` field on `CommitDetail` (from `commit.author.date` in the REST
  response), stored in the cache to enable future time-series aggregation
  (by day/month/year) at the consumer's chosen granularity without re-fetching
  from GitHub

## [1.0.0](https://github.com/smallstack/github-lang-stats/releases/tag/v1.0.0) (2026-02-20)

### Features

* initial public release on npmjs.org
* `gls` bin alias alongside `github-lang-stats` for shorter CLI invocation
* `--from-year <year>` option — defaults to 10 years ago; passed through to both
  repo discovery and commit SHA collection (uses GraphQL `since` timestamp)
* `--select-repos` interactive checkbox prompt after commit SHAs are fetched —
  repos sorted by commit count descending, all pre-selected; supports
  space/a/i/enter shortcuts for easy select-all / deselect-all / invert
* programmatic API (`src/lib.ts`) exported as the package main entry point —
  import `getGithubLangStats` and pass all options without any CLI interaction
* [Biome](https://biomejs.dev) linter and formatter (`biome.json`); added
  `lint`, `lint:fix`, and `format` npm scripts
* `LICENSE` (MIT) file
* rate limiting now reserves **100 requests** (`RATE_LIMIT_RESERVE`) so the user
  retains a buffer after a run; throttle threshold raised from 10 → 100
* rate limit ceiling is now read from the `x-ratelimit-limit` response header
  instead of being hardcoded to 5000
* throttle pause message now includes the human-readable reset time
* phase 3 header shows `total / reserved / usable` breakdown and uses `usable`
  for the ETA estimate
* progress bar displays `availableForTool / usable` coloured **yellow** < 500
  and **red** < 200
* `RateLimitInfo` type extended with `reserved` and `availableForTool` fields
* `.gitignore` now ignores the entire `.github-lang-stats-cache/` directory
  instead of a single hardcoded username file
