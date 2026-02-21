import type { CommitDetail, RateLimitInfo, Repo } from "./types.js";

const GH_REST = "https://api.github.com";
const GH_GRAPHQL = "https://api.github.com/graphql";

/** Number of requests always kept in reserve so the user still has a buffer after the run */
const RATE_LIMIT_RESERVE = 100;

export class GitHubClient {
	private token: string;
	private rateLimitTotal = 5000;
	private rateLimitRemaining = 5000;
	private rateLimitReset = 0;

	constructor(token: string) {
		this.token = token;
	}

	private headers(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.token}`,
			"Content-Type": "application/json",
			"User-Agent": "github-lang-stats-cli/1.0",
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28"
		};
	}

	private updateRateLimitFromHeaders(headers: Headers): void {
		const limit = headers.get("x-ratelimit-limit");
		const remaining = headers.get("x-ratelimit-remaining");
		const reset = headers.get("x-ratelimit-reset");
		if (limit !== null) this.rateLimitTotal = parseInt(limit, 10);
		if (remaining !== null) this.rateLimitRemaining = parseInt(remaining, 10);
		if (reset !== null) this.rateLimitReset = parseInt(reset, 10);
	}

	/** Wait if remaining requests would dip into the reserve */
	private async throttle(): Promise<void> {
		if (this.rateLimitRemaining <= RATE_LIMIT_RESERVE) {
			const now = Math.floor(Date.now() / 1000);
			const waitSeconds = Math.max(this.rateLimitReset - now + 5, 5);
			const resetAt = new Date(this.rateLimitReset * 1000).toLocaleTimeString();
			process.stderr.write(
				`\nRate limit reserve reached (${this.rateLimitRemaining} remaining, ${RATE_LIMIT_RESERVE} reserved). ` +
					`Waiting ${waitSeconds}s until reset at ${resetAt}...\n`
			);
			await sleep(waitSeconds * 1000);
		}
	}

	getRateLimitInfo(): RateLimitInfo {
		return {
			limit: this.rateLimitTotal,
			remaining: this.rateLimitRemaining,
			reserved: RATE_LIMIT_RESERVE,
			availableForTool: Math.max(
				0,
				this.rateLimitRemaining - RATE_LIMIT_RESERVE
			),
			reset: this.rateLimitReset
		};
	}

	// ---------------------------------------------------------------------------
	// GraphQL
	// ---------------------------------------------------------------------------

	async graphql<T = unknown>(
		query: string,
		variables?: Record<string, unknown>
	): Promise<T> {
		await this.throttle();
		const res = await fetch(GH_GRAPHQL, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({ query, variables })
		});
		this.updateRateLimitFromHeaders(res.headers);
		if (!res.ok) {
			const text = await res.text();
			throw new Error(`GraphQL request failed (${res.status}): ${text}`);
		}
		const json = (await res.json()) as { data?: T; errors?: unknown[] };
		if (json.errors?.length) {
			// Don't throw on partial errors (e.g. repos with no default branch); just return data
			if (!json.data)
				throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
		}
		return json.data as T;
	}

	// ---------------------------------------------------------------------------
	// Discover repos via REST: all repos the user owns / collaborates on / is org member of
	// This matches the same endpoint used by the in-app sync (fetchUserRepos) and typically
	// returns many more repos than contributionsCollection alone.
	// ---------------------------------------------------------------------------

	async discoverReposViaRest(): Promise<Repo[]> {
		const repos: Repo[] = [];
		let page = 1;
		const perPage = 100;

		while (true) {
			const res = await fetch(
				`${GH_REST}/user/repos?affiliation=owner,collaborator,organization_member&per_page=${perPage}&page=${page}`,
				{ headers: this.headers() }
			);
			this.updateRateLimitFromHeaders(res.headers);
			if (!res.ok) throw new Error(`Failed to fetch repos (${res.status})`);

			const apiRepos = (await res.json()) as Array<{
				full_name: string;
				owner: { login: string };
				name: string;
				private: boolean;
			}>;
			if (apiRepos.length === 0) break;

			for (const r of apiRepos) {
				repos.push({ owner: r.owner.login, name: r.name, isPrivate: r.private });
			}

			if (apiRepos.length < perPage) break;
			page++;
		}

		return repos;
	}

	// ---------------------------------------------------------------------------
	// Discover repos via GraphQL contributionsCollection (year-by-year).
	// Catches public repos the user contributed to via PRs but isn't a collaborator on.
	// ---------------------------------------------------------------------------

	async discoverReposViaContributions(
		user: string,
		fromYear = 2008,
		onProgress?: (year: number) => void
	): Promise<Repo[]> {
		const repoMap = new Map<string, Repo>();
		const currentYear = new Date().getFullYear();

		for (let year = fromYear; year <= currentYear; year++) {
			onProgress?.(year);
			const from = `${year}-01-01T00:00:00Z`;
			const to = `${year}-12-31T23:59:59Z`;

			try {
				const data = await this.graphql<{
					user: {
						contributionsCollection: {
							commitContributionsByRepository: Array<{
								repository: { 
									owner: { login: string }; 
									name: string;
									isPrivate: boolean;
								};
							}>;
						};
					};
				}>(
					`
          query($login: String!, $from: DateTime!, $to: DateTime!) {
            user(login: $login) {
              contributionsCollection(from: $from, to: $to) {
                commitContributionsByRepository(maxRepositories: 100) {
                  repository {
                    owner { login }
                    name
                    isPrivate
                  }
                }
              }
            }
          }
        `,
					{ login: user, from, to }
				);

				for (const entry of data.user.contributionsCollection
					.commitContributionsByRepository) {
					const key = `${entry.repository.owner.login}/${entry.repository.name}`;
					if (!repoMap.has(key)) {
						repoMap.set(key, {
							owner: entry.repository.owner.login,
							name: entry.repository.name,
							isPrivate: entry.repository.isPrivate
						});
					}
				}
			} catch (err) {
				process.stderr.write(
					`  Warning: could not fetch contributions for ${year}: ${String(err)}\n`
				);
			}

			await sleep(100);
		}

		return [...repoMap.values()];
	}

	// ---------------------------------------------------------------------------
	// Union of both discovery methods
	// ---------------------------------------------------------------------------

	async discoverContributedRepos(
		user: string,
		fromYear = 2008,
		onProgress?: (year: number) => void
	): Promise<Repo[]> {
		const repoMap = new Map<string, Repo>();

		// Source 1: REST — all repos the user has access to (owner/collaborator/org member)
		const restRepos = await this.discoverReposViaRest();
		for (const r of restRepos) repoMap.set(`${r.owner}/${r.name}`, r);

		// Source 2: GraphQL contributions — catches public repos contributed to via PRs
		const contribRepos = await this.discoverReposViaContributions(
			user,
			fromYear,
			onProgress
		);
		for (const r of contribRepos) repoMap.set(`${r.owner}/${r.name}`, r);

		return [...repoMap.values()];
	}

	// ---------------------------------------------------------------------------
	// Get the authenticated user's login + node ID from the token itself
	// ---------------------------------------------------------------------------

	async getViewer(): Promise<{ login: string; id: string }> {
		const data = await this.graphql<{ viewer: { login: string; id: string } }>(
			`query { viewer { login id } }`
		);
		return data.viewer;
	}

	// ---------------------------------------------------------------------------
	// Get GitHub user node ID (for reliable author filtering)
	// ---------------------------------------------------------------------------

	async getUserNodeId(username: string): Promise<string> {
		const data = await this.graphql<{ user: { id: string } }>(
			`query($login: String!) { user(login: $login) { id } }`,
			{ login: username }
		);
		return data.user.id;
	}

	// ---------------------------------------------------------------------------
	// Collect all commit SHAs authored by user in a repo (GraphQL pagination)
	// ---------------------------------------------------------------------------

	async collectCommitShas(
		owner: string,
		repo: string,
		authorId: string,
		onPage?: (count: number) => void,
		fromYear?: number
	): Promise<string[]> {
		type CommitHistory = {
			nodes: Array<{ oid: string }>;
			pageInfo: { hasNextPage: boolean; endCursor: string };
		};
		type HistoryResult = {
			repository: {
				defaultBranchRef: {
					target: { history: CommitHistory };
				} | null;
			} | null;
		};
		const shas: string[] = [];
		let cursor: string | null = null;
		const since = fromYear ? `${fromYear}-01-01T00:00:00Z` : undefined;

		while (true) {
			await this.throttle();
			try {
				const data: HistoryResult = await this.graphql<HistoryResult>(
					`
          query($owner: String!, $repo: String!, $authorId: ID!, $cursor: String, $since: GitTimestamp) {
            repository(owner: $owner, name: $repo) {
              defaultBranchRef {
                target {
                  ... on Commit {
                    history(author: { id: $authorId }, first: 100, after: $cursor, since: $since) {
                      nodes { oid }
                      pageInfo { hasNextPage endCursor }
                    }
                  }
                }
              }
            }
          }
        `,
					{ owner, repo: repo, authorId, cursor, since }
				);

				const history: CommitHistory | undefined =
					data?.repository?.defaultBranchRef?.target?.history;
				if (!history) break;

				for (const node of history.nodes) {
					shas.push(node.oid);
				}

				onPage?.(shas.length);

				if (!history.pageInfo.hasNextPage) break;
				cursor = history.pageInfo.endCursor;
			} catch (err) {
				process.stderr.write(
					`  Warning: error fetching commits for ${owner}/${repo}: ${String(err)}\n`
				);
				break;
			}
		}

		return shas;
	}

	// ---------------------------------------------------------------------------
	// Fetch commit detail (files changed) via REST
	// ---------------------------------------------------------------------------

	async fetchCommitDetail(
		owner: string,
		repo: string,
		sha: string
	): Promise<CommitDetail | null> {
		await this.throttle();
		const url = `${GH_REST}/repos/${owner}/${repo}/commits/${sha}`;
		const res = await fetch(url, { headers: this.headers() });
		this.updateRateLimitFromHeaders(res.headers);

		if (res.status === 404 || res.status === 422) return null;
		if (!res.ok) {
			if (res.status === 429 || res.status === 403) {
				// Secondary rate limit — wait and retry once
				const retryAfter = parseInt(res.headers.get("retry-after") ?? "60", 10);
				process.stderr.write(
					`\nSecondary rate limit hit. Waiting ${retryAfter}s...\n`
				);
				await sleep(retryAfter * 1000);
				return this.fetchCommitDetail(owner, repo, sha);
			}
			throw new Error(
				`fetchCommitDetail failed (${res.status}) for ${owner}/${repo}@${sha}`
			);
		}

		const json = (await res.json()) as {
			sha: string;
			commit?: { author?: { date?: string } };
			files?: Array<{
				filename: string;
				additions: number;
				deletions: number;
				status: string;
			}>;
		};

		return {
			sha: json.sha,
			date: json.commit?.author?.date ? Date.parse(json.commit.author.date) : 0,
			files: (json.files ?? []).map((f) => ({
				filename: f.filename,
				additions: f.additions,
				deletions: f.deletions,
				status: f.status
			}))
		};
	}

	// ---------------------------------------------------------------------------
	// Fetch PR count for a repository (authored by user)
	// Uses the search API for efficiency
	// 
	// IMPORTANT: GitHub Search API has a separate rate limit of 30 requests/minute
	// (not the standard 5000/hour REST API limit). Callers should add ~2s delays
	// between requests to avoid hitting this limit.
	// ---------------------------------------------------------------------------

	async fetchPRCount(
		owner: string,
		repo: string,
		username: string
	): Promise<number> {
		await this.throttle();
		// Search for PRs authored by user in this repo
		const query = `author:${username} type:pr repo:${owner}/${repo}`;
		const url = `${GH_REST}/search/issues?q=${encodeURIComponent(query)}&per_page=1`;
		const res = await fetch(url, { headers: this.headers() });
		this.updateRateLimitFromHeaders(res.headers);

		if (res.status === 404 || res.status === 422) return 0;
		if (!res.ok) {
			if (res.status === 429 || res.status === 403) {
				// Secondary rate limit — wait and retry once
				const retryAfter = parseInt(res.headers.get("retry-after") ?? "60", 10);
				process.stderr.write(
					`\nSecondary rate limit hit. Waiting ${retryAfter}s...\n`
				);
				await sleep(retryAfter * 1000);
				return this.fetchPRCount(owner, repo, username);
			}
			throw new Error(
				`fetchPRCount failed (${res.status}) for ${owner}/${repo}`
			);
		}

		const json = (await res.json()) as {
			total_count: number;
		};

		return json.total_count;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
