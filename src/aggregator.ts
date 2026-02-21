import { detectLanguage, isExcludedLanguage } from "./language-detector.js";
import type {
	AggregatedStats,
	CommitDetail,
	Repo,
	RepoStats
} from "./types.js";

// We accept the cache data object directly for aggregation
export function aggregate(
	user: string,
	commitsByRepo: Record<string, string[]>,
	commitDetails: Record<string, CommitDetail | null>,
	excludeLanguages: string[] = [],
	includeCommitDates: boolean = true,
	prCountByRepo: Record<string, number> = {},
	repos: Repo[] = [],
	includePRCounts: boolean = true,
	version?: string
): AggregatedStats {
	const totals: Record<string, number> = {};
	const byRepo: Record<string, RepoStats> = {};

	let totalCommitsProcessed = 0;

	// Build a repo map for quick lookup of isPrivate
	const repoMap = new Map<string, Repo>();
	for (const repo of repos) {
		repoMap.set(`${repo.owner}/${repo.name}`, repo);
	}

	for (const [repoKey, shas] of Object.entries(commitsByRepo)) {
		const repoLangs: Record<string, number> = {};
		const commitDates: string[] = [];

		for (const sha of shas) {
			const detail = commitDetails[sha];
			if (!detail) continue; // not yet fetched or errored

			totalCommitsProcessed++;

			// Collect commit date if requested
			if (includeCommitDates && detail.date) {
				const date = new Date(detail.date);
				const isoDate = date.toISOString().split("T")[0]; // YYYY-MM-DD
				commitDates.push(isoDate);
			}

			for (const file of detail.files) {
				const lang = detectLanguage(file.filename);
				if (!lang) continue;
				if (isExcludedLanguage(lang)) continue;
				if (excludeLanguages.includes(lang)) continue;

				const lines = file.additions + file.deletions;
				repoLangs[lang] = (repoLangs[lang] ?? 0) + lines;
				totals[lang] = (totals[lang] ?? 0) + lines;
			}
		}

		if (Object.keys(repoLangs).length > 0) {
			const repoData: RepoStats = {
				contributionsCountPerLanguage: repoLangs
			};

			// Add commit dates if enabled
			if (includeCommitDates && commitDates.length > 0) {
				repoData.commitDates = commitDates;
			}

			// Add PR count if enabled and available
			if (includePRCounts) {
				const prCount = prCountByRepo[repoKey];
				if (prCount !== undefined) {
					repoData.prCount = prCount;
				}
			}

			// Add isPrivate if available
			const repo = repoMap.get(repoKey);
			if (repo?.isPrivate !== undefined) {
				repoData.isPrivate = repo.isPrivate;
			}

			byRepo[repoKey] = repoData;
		}
	}

	// Sort totals descending
	const sortedTotals = Object.fromEntries(
		Object.entries(totals).sort(([, a], [, b]) => b - a)
	);

	// Sort byRepo entries descending within each repo
	const sortedByRepo = Object.fromEntries(
		Object.entries(byRepo)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([repo, data]) => {
				// Sort language entries
				const sortedLangs = Object.fromEntries(
					Object.entries(data.contributionsCountPerLanguage).sort(
						([, a], [, b]) => b - a
					)
				);
				// Build result with sorted langs and all optional fields
				const result: RepoStats = {
					contributionsCountPerLanguage: sortedLangs
				};
				if (data.commitDates) result.commitDates = data.commitDates;
				if (data.prCount !== undefined) result.prCount = data.prCount;
				if (data.isPrivate !== undefined) result.isPrivate = data.isPrivate;
				return [repo, result];
			})
	);

	return {
		totals: sortedTotals,
		byRepo: sortedByRepo,
		meta: {
			user,
			generatedAt: new Date().toISOString(),
			totalCommitsProcessed,
			totalRepos: Object.keys(byRepo).length,
			unit: "lines_changed",
			...(version ? { version } : {}),
			...(includePRCounts ? {} : { excludedPRs: true })
		}
	};
}
