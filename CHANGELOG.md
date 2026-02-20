# Changelog

## [1.3.0](https://github.com/smallstack/github-lang-stats/compare/github-lang-stats-v1.2.0...github-lang-stats-v1.3.0) (2026-02-20)


### Added

* add GitHub Actions workflow for publishing to npm ([a1cf9b9](https://github.com/smallstack/github-lang-stats/commit/a1cf9b9c417aec1c3aa89ab474fe01a52a9fbd4c))

## [1.2.0](https://github.com/smallstack/github-lang-stats/compare/github-lang-stats-v1.1.0...github-lang-stats-v1.2.0) (2026-02-20)


### Added

* add date field to CommitDetail and update cache version for time-series aggregation ([b568db3](https://github.com/smallstack/github-lang-stats/commit/b568db303df89c6494de1963cf17ede65fe668b7))
* make --user optional, resolve login and node ID from token via viewer query ([1329c9f](https://github.com/smallstack/github-lang-stats/commit/1329c9fbc16b87d7eb2199f0dcac8541f0390889))
* npm publish setup, --from-year, --select-repos, programmatic API, biome, rate limit reserve ([a1dc5b4](https://github.com/smallstack/github-lang-stats/commit/a1dc5b485c4dbb3d8e14b6d69e9eb2684ee6f944))
* update LICENSE and package.json with company details and additional metadata ([7eb04b0](https://github.com/smallstack/github-lang-stats/commit/7eb04b0455a37f9c96225c6f700576417b92cead))
* update release configuration to use manifest and include changelog sections ([c12d7af](https://github.com/smallstack/github-lang-stats/commit/c12d7af62fff5829c30d6aae538e7ea3b81aee92))


### Documentation

* document all programmatic API options, ProgressEvent shape, and dev scripts ([10022ea](https://github.com/smallstack/github-lang-stats/commit/10022eab0171a06b2eaa1d957462116eaf351b77))


### Miscellaneous

* add commitlint, lefthook, and vscode extension recommendation ([27b5147](https://github.com/smallstack/github-lang-stats/commit/27b5147da2571e0d07f2abc4b7d286bfb5a618ba))
* configure release-please ([ddb5881](https://github.com/smallstack/github-lang-stats/commit/ddb5881f4af2e14609d80f9950badd494cc8e2ec))
* initial commit ([6dbc376](https://github.com/smallstack/github-lang-stats/commit/6dbc376a994a5907299adb8d7f065c14294c5093))
* **main:** release 1.1.0 ([0ae538b](https://github.com/smallstack/github-lang-stats/commit/0ae538b00ebe8e5cff95ab0a03699a16cebc500f))
* **main:** release 1.1.0 ([ff57759](https://github.com/smallstack/github-lang-stats/commit/ff5775945ed75bc421d6bf220c3c9ee36ba61c92))
* **release:** 1.0.0 ([a294e49](https://github.com/smallstack/github-lang-stats/commit/a294e49ec709bff09bb087f91605664cd7882dd6))
* **release:** 1.0.1 ([582fccf](https://github.com/smallstack/github-lang-stats/commit/582fccfcddca7425ce3cfda99ac1af12f65ce748))
* **release:** 1.0.2 ([9e8e1ec](https://github.com/smallstack/github-lang-stats/commit/9e8e1ec681511686a79dd70c4e985cf1f3af33be))
* unhide documentation, chore, and refactor sections in release-please config ([5e1da71](https://github.com/smallstack/github-lang-stats/commit/5e1da71425082fad5b030e23c5333e62beb60ef5))

## [1.1.0](https://github.com/smallstack/github-lang-stats/compare/v1.0.2...v1.1.0) (2026-02-20)


### Features

* make --user optional, resolve login and node ID from token via viewer query ([1329c9f](https://github.com/smallstack/github-lang-stats/commit/1329c9fbc16b87d7eb2199f0dcac8541f0390889))

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
