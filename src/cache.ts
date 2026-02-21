import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Cache, CommitDetail, Repo } from "./types.js";

const CACHE_VERSION = 3;

function emptyCache(): Cache {
	return {
		version: CACHE_VERSION,
		repos: [],
		completedRepos: [],
		commitsByRepo: {},
		commitDetails: {},
		prCountByRepo: {},
		completedPRRepos: []
	};
}

export class CacheStore {
	private path: string;
	private data: Cache;

	constructor(cachePath: string) {
		this.path = cachePath;
		this.data = this.load();
	}

	private load(): Cache {
		if (!existsSync(this.path)) return emptyCache();
		try {
			const raw = readFileSync(this.path, "utf-8");
			const parsed = JSON.parse(raw) as Cache;
			if (parsed.version !== CACHE_VERSION) {
				console.warn(
					`Cache version mismatch (got ${parsed.version}, expected ${CACHE_VERSION}). Starting fresh.`
				);
				return emptyCache();
			}
			return parsed;
		} catch {
			console.warn("Failed to read cache, starting fresh.");
			return emptyCache();
		}
	}

	save(): void {
		const dir = dirname(this.path);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(this.path, JSON.stringify(this.data, null, 2), "utf-8");
	}

	get repos(): Repo[] {
		return this.data.repos;
	}

	set repos(repos: Repo[]) {
		this.data.repos = repos;
	}

	get completedRepos(): string[] {
		return this.data.completedRepos;
	}

	isRepoComplete(owner: string, repo: string): boolean {
		return this.data.completedRepos.includes(`${owner}/${repo}`);
	}

	markRepoComplete(owner: string, repo: string): void {
		const key = `${owner}/${repo}`;
		if (!this.data.completedRepos.includes(key)) {
			this.data.completedRepos.push(key);
		}
	}

	getCommits(owner: string, repo: string): string[] {
		return this.data.commitsByRepo[`${owner}/${repo}`] ?? [];
	}

	addCommits(owner: string, repo: string, shas: string[]): void {
		const key = `${owner}/${repo}`;
		const existing = this.data.commitsByRepo[key] ?? [];
		const existingSet = new Set(existing);
		const newShas = shas.filter((s) => !existingSet.has(s));
		this.data.commitsByRepo[key] = [...existing, ...newShas];
	}

	hasCommitDetail(sha: string): boolean {
		return sha in this.data.commitDetails;
	}

	getCommitDetail(sha: string): CommitDetail | null | undefined {
		return this.data.commitDetails[sha];
	}

	setCommitDetail(sha: string, detail: CommitDetail | null): void {
		this.data.commitDetails[sha] = detail;
	}

	/** How many commit details we still need to fetch */
	pendingCommitCount(): number {
		let count = 0;
		for (const shas of Object.values(this.data.commitsByRepo)) {
			for (const sha of shas) {
				if (!this.hasCommitDetail(sha)) count++;
			}
		}
		return count;
	}

	totalCommitShas(): number {
		let count = 0;
		for (const shas of Object.values(this.data.commitsByRepo)) {
			count += shas.length;
		}
		return count;
	}

	/** Returns cache file path */
	get filePath(): string {
		return this.path;
	}

	/** Returns a snapshot of the raw data needed for aggregation */
	getAggregationData(): {
		commitsByRepo: Record<string, string[]>;
		commitDetails: Record<string, CommitDetail | null>;
		prCountByRepo: Record<string, number>;
	} {
		return {
			commitsByRepo: this.data.commitsByRepo,
			commitDetails: this.data.commitDetails,
			prCountByRepo: this.data.prCountByRepo ?? {}
		};
	}

	/** Clear all cached data */
	reset(): void {
		this.data = emptyCache();
	}

	// ─── PR Count Methods ─────────────────────────────────────────────────────

	isRepoPRComplete(owner: string, repo: string): boolean {
		const key = `${owner}/${repo}`;
		return (this.data.completedPRRepos ?? []).includes(key);
	}

	markRepoPRComplete(owner: string, repo: string): void {
		const key = `${owner}/${repo}`;
		if (!this.data.completedPRRepos) this.data.completedPRRepos = [];
		if (!this.data.completedPRRepos.includes(key)) {
			this.data.completedPRRepos.push(key);
		}
	}

	getPRCount(owner: string, repo: string): number | undefined {
		const key = `${owner}/${repo}`;
		return this.data.prCountByRepo?.[key];
	}

	setPRCount(owner: string, repo: string, count: number): void {
		const key = `${owner}/${repo}`;
		if (!this.data.prCountByRepo) this.data.prCountByRepo = {};
		this.data.prCountByRepo[key] = count;
	}
}

export function defaultCachePath(user: string): string {
	return join(process.cwd(), ".github-lang-stats-cache", `${user}.json`);
}
