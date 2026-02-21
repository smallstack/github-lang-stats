/**
 * Programmatic API for github-lang-stats.
 *
 * @example
 * ```ts
 * import { getGithubLangStats } from "github-lang-stats";
 *
 * const stats = await getGithubLangStats({
 *   user: "octocat",
 *   token: process.env.GITHUB_TOKEN!,
 *   fromYear: 2020,
 * });
 * console.log(stats.totals);
 * ```
 */
import { aggregate } from "./aggregator.js";
import { CacheStore, defaultCachePath } from "./cache.js";
import { GitHubClient } from "./github-client.js";
import type { AggregatedStats, Repo } from "./types.js";

export type {
	AggregatedStats,
	CommitDetail,
	CommitFileDetail,
	RateLimitInfo,
	Repo,
	RepoStats
} from "./types.js";

export { GitHubClient } from "./github-client.js";

export interface GetGithubLangStatsOptions {
	/**
	 * GitHub username to analyse.
	 * When omitted, the username is resolved automatically from the token
	 * via a `viewer` GraphQL query — no extra API call if the token belongs
	 * to the user being analysed (the common case).
	 */
	user?: string;
	/** GitHub Personal Access Token (needs repo + read:user scopes) */
	token: string;
	/**
	 * Earliest year to include in the analysis.
	 * Defaults to **10 years ago** from the current year.
	 */
	fromYear?: number;
	/** Languages to exclude (e.g. ["JSON", "YAML"]). */
	excludeLanguages?: string[];
	/** Max concurrent REST requests when fetching commit details. Defaults to 5. */
	concurrency?: number;
	/**
	 * Path to the cache file. Defaults to `.github-lang-stats-cache/<user>.json`
	 * in the current working directory.
	 */
	cachePath?: string;
	/**
	 * Set to `false` to disable on-disk caching entirely.
	 * Defaults to `true`.
	 */
	useCache?: boolean;
	/**
	 * Restrict analysis to these repos (`"owner/name"` format).
	 * When omitted, all discovered repos are processed.
	 */
	repos?: string[];
	/**
	 * Include commit dates for heatmap visualization.
	 * Adds a `commitDates` array to each repo with ISO date strings (YYYY-MM-DD).
	 * Defaults to `true`.
	 */
	includeCommitDates?: boolean;
	/**
	 * Include PR counts for activity metrics.
	 * Adds a `prCount` field to each repo with the number of PRs authored by the user.
	 * Defaults to `true`.
	 */
	includePRCounts?: boolean;
	/** Optional progress callback invoked as each phase advances. */
	onProgress?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
	| { phase: "discover"; details: string }
	| { phase: "shas"; repo: string; count: number }
	| { phase: "details"; fetched: number; total: number }
	| { phase: "pr-counts"; fetched: number; total: number }
	| { phase: "aggregate" };

export interface ListRepositoriesOptions {
	/**
	 * GitHub username to discover repos for.
	 * When omitted, the username is resolved automatically from the token.
	 */
	user?: string;
	/** GitHub Personal Access Token (needs repo + read:user scopes) */
	token: string;
	/**
	 * Earliest year to scan for contributions.
	 * Defaults to **10 years ago** from the current year.
	 */
	fromYear?: number;
	/** Optional progress callback invoked as each year is scanned. */
	onProgress?: (year: number) => void;
}

/**
 * List all repositories the user has contributed to.
 *
 * This combines two discovery methods:
 * 1. REST API: All repos the user owns, collaborates on, or is an org member of
 * 2. GraphQL: Public repos contributed to via PRs (year-by-year scan)
 *
 * @returns Array of repositories with owner, name, and privacy status
 *
 * @example
 * ```ts
 * import { listRepositories } from "github-lang-stats";
 *
 * const repos = await listRepositories({
 *   token: process.env.GITHUB_TOKEN!,
 *   fromYear: 2020,
 * });
 * console.log(repos); // [{ owner: "octocat", name: "hello-world", isPrivate: false }, ...]
 * ```
 */
export async function listRepositories(
	options: ListRepositoriesOptions
): Promise<Repo[]> {
	const {
		user: userOption,
		token,
		fromYear = new Date().getFullYear() - 10,
		onProgress
	} = options;

	const client = new GitHubClient(token);

	// Resolve username from the token if not provided
	let user: string;
	if (userOption) {
		user = userOption;
	} else {
		const viewer = await client.getViewer();
		user = viewer.login;
	}

	return client.discoverContributedRepos(user, fromYear, onProgress);
}

/**
 * Fetch GitHub language statistics for the given user programmatically.
 *
 * The function mirrors the full CLI pipeline (discover repos → collect commit
 * SHAs → fetch commit file details → aggregate) but without any console output
 * or interactive prompts, making it suitable for embedding in other tools.
 */
export async function getGithubLangStats(
	options: GetGithubLangStatsOptions
): Promise<AggregatedStats> {
	const {
		user: userOption,
		token,
		fromYear = new Date().getFullYear() - 10,
		excludeLanguages = [],
		concurrency = 5,
		cachePath,
		useCache = true,
		repos: repoFilter,
		includeCommitDates = true,
		includePRCounts = true,
		onProgress
	} = options;

	const client = new GitHubClient(token);

	// Resolve username (and node ID) from the token if user was not provided
	let user: string;
	let cachedAuthorId: string | undefined;
	if (userOption) {
		user = userOption;
	} else {
		const viewer = await client.getViewer();
		user = viewer.login;
		cachedAuthorId = viewer.id;
	}

	const cPath = cachePath ?? defaultCachePath(user);
	const cache = new CacheStore(cPath);

	// ── Phase 1: Discover repos ─────────────────────────────────────────────

	if (cache.repos.length === 0) {
		onProgress?.({ phase: "discover", details: "Discovering repositories…" });
		const allRepos = await client.discoverContributedRepos(
			user,
			fromYear,
			(year) => {
				onProgress?.({
					phase: "discover",
					details: `Scanning contributions for ${year}…`
				});
			}
		);
		cache.repos = allRepos;
		if (useCache) cache.save();
	}

	const reposToProcess = repoFilter
		? cache.repos.filter((r) => repoFilter.includes(`${r.owner}/${r.name}`))
		: cache.repos;

	// ── Phase 2: Collect commit SHAs ────────────────────────────────────────

	const incompleteRepos = reposToProcess.filter(
		(r) => !cache.isRepoComplete(r.owner, r.name)
	);

	if (incompleteRepos.length > 0) {
		const authorId = cachedAuthorId ?? await client.getUserNodeId(user);

		for (const repo of incompleteRepos) {
			const shas = await client.collectCommitShas(
				repo.owner,
				repo.name,
				authorId,
				(count) => {
					onProgress?.({
						phase: "shas",
						repo: `${repo.owner}/${repo.name}`,
						count
					});
				},
				fromYear
			);
			cache.addCommits(repo.owner, repo.name, shas);
			cache.markRepoComplete(repo.owner, repo.name);
			if (useCache) cache.save();
		}
	}

	// ── Phase 3: Fetch commit file details ──────────────────────────────────

	type Work = { owner: string; repo: string; sha: string };
	const workList: Work[] = [];
	for (const repo of reposToProcess) {
		const shas = cache.getCommits(repo.owner, repo.name);
		for (const sha of shas) {
			if (!cache.hasCommitDetail(sha)) {
				workList.push({ owner: repo.owner, repo: repo.name, sha });
			}
		}
	}

	let fetched = 0;
	for (let i = 0; i < workList.length; i += concurrency) {
		const batch = workList.slice(i, i + concurrency);
		const results = await Promise.allSettled(
			batch.map(({ owner, repo, sha }) =>
				client.fetchCommitDetail(owner, repo, sha)
			)
		);
		for (let j = 0; j < batch.length; j++) {
			const { sha } = batch[j];
			const result = results[j];
			cache.setCommitDetail(
				sha,
				result.status === "fulfilled" ? result.value : null
			);
			fetched++;
		}
		if (useCache) cache.save();
		onProgress?.({ phase: "details", fetched, total: workList.length });
	}

	// ── Phase 3.5: Collect PR counts ────────────────────────────────────────

	if (includePRCounts) {
		const incompletePRRepos = reposToProcess.filter(
			(r) => !cache.isRepoPRComplete(r.owner, r.name)
		);

		if (incompletePRRepos.length > 0) {
			let prFetched = 0;
			for (const repo of incompletePRRepos) {
				try {
					const prCount = await client.fetchPRCount(repo.owner, repo.name, user);
					cache.setPRCount(repo.owner, repo.name, prCount);
					cache.markRepoPRComplete(repo.owner, repo.name);
					prFetched++;
					if (useCache) cache.save();
					onProgress?.({
						phase: "pr-counts",
						fetched: prFetched,
						total: incompletePRRepos.length
					});
					// Add delay to respect Search API rate limit (30 req/min = 2s between requests)
					if (prFetched < incompletePRRepos.length) {
						await new Promise(r => setTimeout(r, 2000));
					}
				} catch (_err) {
					// Mark as complete even on error to avoid retrying indefinitely
					cache.markRepoPRComplete(repo.owner, repo.name);
				}
			}
		}
	}

	// ── Phase 4: Aggregate ──────────────────────────────────────────────────

	onProgress?.({ phase: "aggregate" });

	const filteredCommitsByRepo: Record<string, string[]> = {};
	for (const repo of reposToProcess) {
		const key = `${repo.owner}/${repo.name}`;
		filteredCommitsByRepo[key] = cache.getCommits(repo.owner, repo.name);
	}
	const { commitDetails, prCountByRepo } = cache.getAggregationData();

	return aggregate(
		user,
		filteredCommitsByRepo,
		commitDetails,
		excludeLanguages,
		includeCommitDates,
		prCountByRepo,
		reposToProcess,
		includePRCounts
	);
}
