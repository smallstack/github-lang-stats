export interface Repo {
	owner: string;
	name: string;
}

export interface CommitSha {
	owner: string;
	repo: string;
	sha: string;
}

export interface CommitFileDetail {
	filename: string;
	additions: number;
	deletions: number;
	status: string;
}

export interface CommitDetail {
	sha: string;
	files: CommitFileDetail[];
}

export interface RepoLanguageStats {
	repo: string;
	languages: Record<string, number>;
}

export interface AggregatedStats {
	/** Total lines changed (additions + deletions) per language across all repos */
	totals: Record<string, number>;
	/** Per-repo breakdown: { "owner/repo": { TypeScript: 1234, ... } } */
	byRepo: Record<string, Record<string, number>>;
	/** Metadata */
	meta: {
		user: string;
		generatedAt: string;
		totalCommitsProcessed: number;
		totalRepos: number;
		unit: "lines_changed";
	};
}

export interface Cache {
	version: number;
	repos: Repo[];
	/** Repos whose commit SHAs have been fully collected */
	completedRepos: string[];
	/** Map of "owner/repo" → array of commit SHAs */
	commitsByRepo: Record<string, string[]>;
	/** Map of "<sha>" → CommitDetail (or null if 404/error) */
	commitDetails: Record<string, CommitDetail | null>;
}

export interface RateLimitInfo {
	limit: number;
	remaining: number;
	reset: number; // unix timestamp
}
