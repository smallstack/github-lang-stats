#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import checkbox from "@inquirer/checkbox";
import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { aggregate } from "./aggregator.js";
import { CacheStore, defaultCachePath } from "./cache.js";
import { GitHubClient } from "./github-client.js";

const DEFAULT_FROM_YEAR = new Date().getFullYear() - 10;

const program = new Command();

program
	.name("gls")
	.alias("github-lang-stats")
	.description(
		"Compute per-author GitHub language statistics by analysing commit file changes.\n" +
			"Fetches only commits authored by --user, then inspects changed files via REST.\n" +
			"Progress is cached locally so interrupted runs can be resumed."
	)
	.version("1.0.0")
	.option("-u, --user <username>", "GitHub username (default: resolved from token via viewer query)")
	.requiredOption(
		"-t, --token <pat>",
		"GitHub Personal Access Token (needs repo + read:user scopes)"
	)
	.option("-o, --output <path>", "Path to write JSON output (default: stdout)")
	.option("--cache <path>", "Override cache file path")
	.option("--no-cache", "Disable cache (start fresh each run)")
	.option(
		"--concurrency <n>",
		"Concurrent REST requests for commit details",
		"5"
	)
	.option(
		"--from-year <year>",
		`Earliest year to include (default: ${DEFAULT_FROM_YEAR}, i.e. 10 years ago)`,
		String(DEFAULT_FROM_YEAR)
	)
	.option(
		"--exclude-langs <langs>",
		"Comma-separated language names to exclude (e.g. JSON,YAML)"
	)
	.option(
		"--select-repos",
		"Interactively select which repositories to analyse after fetching commit counts"
	)
	.option(
		"--stats-only",
		"Skip fetching new data, just aggregate from existing cache"
	)
	.option("--reset", "Delete cache and start fresh")
	.option(
		"--exclude-commit-dates",
		"Exclude commit dates from output (dates are included by default for heatmap visualization)"
	)
	.option(
		"--exclude-pr-counts",
		"Exclude PR counts from output (PR counts are included by default for activity metrics)"
	)
	.parse(process.argv);

const opts = program.opts<{
	user?: string;
	token: string;
	output?: string;
	cache?: string;
	noCache: boolean;
	concurrency: string;
	fromYear: string;
	excludeLangs?: string;
	selectRepos: boolean;
	statsOnly: boolean;
	reset: boolean;
	excludeCommitDates: boolean;
	excludePrCounts: boolean;
}>();

const concurrency = parseInt(opts.concurrency, 10);
const fromYear = parseInt(opts.fromYear, 10);
const excludeLanguages = opts.excludeLangs
	? opts.excludeLangs.split(",").map((s) => s.trim())
	: [];

// ─── Setup ────────────────────────────────────────────────────────────────────

const client = new GitHubClient(opts.token);

// Resolve username (and optionally node ID) from the token if --user was omitted
let user: string;
let cachedAuthorId: string | undefined;
if (opts.user) {
	user = opts.user;
} else {
	const spinner0 = ora("Resolving user from token…").start();
	const viewer = await client.getViewer();
	user = viewer.login;
	cachedAuthorId = viewer.id;
	spinner0.succeed(`Resolved user: ${chalk.bold(user)}`);
}

const cachePath = opts.cache ?? defaultCachePath(user);
const cache = new CacheStore(cachePath);

if (opts.reset) {
	console.log(chalk.yellow(`Resetting cache at ${cachePath}`));
	cache.reset();
	cache.save();
}

console.log(
	chalk.bold(`\ngithub-lang-stats`) +
		chalk.gray(` — user: ${user}`) +
		chalk.gray(` — from ${fromYear}`)
);
if (!opts.noCache) console.log(chalk.gray(`Cache: ${cachePath}`));
console.log();

// ─── Phase 1: Discover repos ──────────────────────────────────────────────────

if (!opts.statsOnly) {
	if (cache.repos.length === 0) {
		const spinner = ora(
			"Discovering contributed repositories (year-by-year)…"
		).start();
		let currentYear = 0;
		const repos = await client.discoverContributedRepos(
			user,
			fromYear,
			(year) => {
				currentYear = year;
				spinner.text = `Scanning contributions for ${year}…`;
			}
		);
		cache.repos = repos;
		if (!opts.noCache) cache.save();
		spinner.succeed(
			`Found ${chalk.bold(repos.length)} repositories (${fromYear}–${currentYear} scanned)`
		);
	} else {
		console.log(
			chalk.green(`✓`) +
				` Using cached repo list: ${chalk.bold(cache.repos.length)} repos`
		);
	}

	// ─── Phase 1.5: Interactive repo selection ────────────────────────────────────

	if (opts.selectRepos) {
		const repoEntries = cache.repos
			.map((r) => ({
				repo: r,
				key: `${r.owner}/${r.name}`
			}))
			.sort((a, b) => a.key.localeCompare(b.key));

		console.log(
			`\n${chalk.bold("Select repositories to analyse")} ` +
				chalk.gray("(space=toggle, a=toggle all, i=invert, enter=confirm)\n")
		);

		const selected = await checkbox({
			message: `Choose repos (${repoEntries.length} total)`,
			choices: repoEntries.map(({ key }) => ({
				name: key,
				value: key,
				checked: true
			})),
			pageSize: 20,
			loop: false
		});

		if (selected.length === 0) {
			console.log(chalk.red("No repositories selected — nothing to do."));
			process.exit(0);
		}

		const selectedSet = new Set(selected);
		cache.repos = cache.repos.filter((r) =>
			selectedSet.has(`${r.owner}/${r.name}`)
		);
		console.log(
			chalk.green(`✓`) +
				` Analysing ${chalk.bold(cache.repos.length)} selected repos\n`
		);
	}

	// ─── Phase 2: Collect commit SHAs per repo ──────────────────────────────────

	const incompleteRepos = cache.repos.filter(
		(r) => !cache.isRepoComplete(r.owner, r.name)
	);

	if (incompleteRepos.length > 0) {
		console.log(
			`\nCollecting commit SHAs for ${chalk.bold(incompleteRepos.length)} repos…`
		);

		// Use the user's GitHub node ID for reliable author filtering
		// (email-based filtering misses commits made with different local git emails)
		const authorId =
			cachedAuthorId ??
			await (async () => {
				const spinner0 = ora("Fetching GitHub user node ID…").start();
				const id = await client.getUserNodeId(user);
				spinner0.succeed(`Author ID: ${chalk.gray(id)}`);
				return id;
			})();

		let repoIdx = 0;
		for (const repo of incompleteRepos) {
			repoIdx++;
			const spinner = ora(
				`[${repoIdx}/${incompleteRepos.length}] ${repo.owner}/${repo.name}…`
			).start();

			const existing = cache.getCommits(repo.owner, repo.name);
			const shas = await client.collectCommitShas(
				repo.owner,
				repo.name,
				authorId,
				(count) => {
					spinner.text = `[${repoIdx}/${incompleteRepos.length}] ${repo.owner}/${repo.name} — ${count} commits…`;
				},
				fromYear
			);

			cache.addCommits(repo.owner, repo.name, shas);
			cache.markRepoComplete(repo.owner, repo.name);
			if (!opts.noCache) cache.save();

			const fresh = shas.length - existing.length;
			spinner.succeed(
				`[${repoIdx}/${incompleteRepos.length}] ${repo.owner}/${repo.name} — ` +
					`${chalk.bold(shas.length)} commits` +
					(fresh > 0 ? chalk.gray(` (+${fresh} new)`) : "")
			);
		}
	} else {
		console.log(`${chalk.green(`✓`)} All repo commit SHAs already cached`);
	}

	// ─── Phase 3: Fetch commit file details (REST) ──────────────────────────────

	const pending = cache.pendingCommitCount();
	const total = cache.totalCommitShas();
	const done = total - pending;

	if (pending > 0) {
		const rl0 = client.getRateLimitInfo();
		const usablePerHour = rl0.limit - rl0.reserved;
		console.log(
			`\nFetching commit details: ${chalk.bold(pending)} remaining` +
				(done > 0 ? chalk.gray(` (${done} already cached)`) : "") +
				`\n` +
				chalk.gray(
					`  Rate limit: ${rl0.limit}/hr total, ${rl0.reserved} reserved → ${usablePerHour} usable by this tool\n` +
						`  Estimated time at ${usablePerHour} req/hr with concurrency=${concurrency}: ` +
						`~${formatMinutes(pending / (usablePerHour / 60 / 60) / concurrency)}`
				)
		);

		// Build work list: [{owner, repo, sha}, ...]
		type Work = { owner: string; repo: string; sha: string };
		const workList: Work[] = [];
		for (const repo of cache.repos) {
			const shas = cache.getCommits(repo.owner, repo.name);
			for (const sha of shas) {
				if (!cache.hasCommitDetail(sha)) {
					workList.push({ owner: repo.owner, repo: repo.name, sha });
				}
			}
		}

		let fetched = 0;
		let errors = 0;
		let saveCounter = 0;

		const bar = ora(`Fetching 0 / ${workList.length}…`).start();

		// Process in batches of `concurrency`
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
				if (result.status === "fulfilled") {
					cache.setCommitDetail(sha, result.value);
					fetched++;
				} else {
					cache.setCommitDetail(sha, null);
					errors++;
				}
			}

			saveCounter += batch.length;
			if (!opts.noCache && saveCounter >= 50) {
				cache.save();
				saveCounter = 0;
			}

			const pct = Math.round(((fetched + errors) / workList.length) * 100);
			const rl = client.getRateLimitInfo();
			const rlColor =
				rl.availableForTool < 200
					? chalk.red
					: rl.availableForTool < 500
						? chalk.yellow
						: chalk.gray;
			bar.text =
				`Fetching ${fetched + errors} / ${workList.length} (${pct}%) — ` +
				rlColor(
					`${rl.availableForTool} / ${rl.limit - rl.reserved} req remaining (${rl.reserved} reserved)`
				);
		}

		if (!opts.noCache) cache.save();
		bar.succeed(`Fetched ${chalk.bold(fetched)} commits (${errors} errors)`);
	} else {
		console.log(
			`${chalk.green(`✓`)} All commit details already cached (${total} commits)`
		);
	}

	// ─── Phase 3.5: Collect PR counts ────────────────────────────────────────────

	if (!opts.excludePrCounts) {
		const incompletePRRepos = cache.repos.filter(
			(r) => !cache.isRepoPRComplete(r.owner, r.name)
		);

		if (incompletePRRepos.length > 0) {
			const totalPRRepos = cache.repos.length;
			const alreadyDone = totalPRRepos - incompletePRRepos.length;

			console.log(
				`\nCollecting PR counts: ${chalk.bold(incompletePRRepos.length)} remaining` +
					(alreadyDone > 0 ? chalk.gray(` (${alreadyDone} already cached)`) : "") +
					chalk.gray(`\n  Note: Search API limited to 30 req/min, this will take ~${Math.ceil(incompletePRRepos.length / 30)} min`)
			);

			let prRepoIdx = 0;
			let totalPRCount = 0;
			const prBar = ora(
				`Collecting PR counts 0 / ${incompletePRRepos.length}…`
			).start();

			for (const repo of incompletePRRepos) {
				prRepoIdx++;
				try {
					const prCount = await client.fetchPRCount(repo.owner, repo.name, user);
					cache.setPRCount(repo.owner, repo.name, prCount);
					cache.markRepoPRComplete(repo.owner, repo.name);
					totalPRCount += prCount;

					if (!opts.noCache && prRepoIdx % 10 === 0) {
						cache.save();
					}

					const pct = Math.round((prRepoIdx / incompletePRRepos.length) * 100);
					prBar.text = `Collecting PR counts ${prRepoIdx} / ${incompletePRRepos.length} (${pct}%)`;

					// Add delay to respect Search API rate limit (30 req/min = 2s between requests)
					if (prRepoIdx < incompletePRRepos.length) {
						await new Promise(r => setTimeout(r, 2000));
					}
				} catch (err) {
					process.stderr.write(
						`\n  Warning: failed to fetch PR count for ${repo.owner}/${repo.name}: ${String(err)}\n`
					);
					// Mark as complete even on error to avoid retrying indefinitely
					cache.markRepoPRComplete(repo.owner, repo.name);
				}
			}

			if (!opts.noCache) cache.save();
			prBar.succeed(
				`Collected PR counts for ${chalk.bold(incompletePRRepos.length)} repos (${totalPRCount} PRs total)`
			);
		} else {
			console.log(`${chalk.green(`✓`)} All PR counts already cached`);
		}
	}
}

// ─── Phase 4: Aggregate ───────────────────────────────────────────────────────

console.log(chalk.gray("\nAggregating…"));

const { commitsByRepo, commitDetails, prCountByRepo } =
	cache.getAggregationData();
const stats = aggregate(
	user,
	commitsByRepo,
	commitDetails,
	excludeLanguages,
	!opts.excludeCommitDates, // Include by default, exclude if flag is set
	prCountByRepo,
	cache.repos,
	!opts.excludePrCounts // Include by default, exclude if flag is set
);

const json = JSON.stringify(stats, null, 2);

if (opts.output) {
	const outPath = resolve(opts.output);
	const outDir = dirname(outPath);
	if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
	writeFileSync(outPath, json, "utf-8");
	console.log(chalk.green(`\n✓ Output written to ${outPath}`));
} else {
	process.stdout.write(`${json}\n`);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(chalk.bold("\nTop languages (lines changed):"));
const topN = Object.entries(stats.totals).slice(0, 10);
const maxLines = topN[0]?.[1] ?? 1;
for (const [lang, lines] of topN) {
	const bar = "█".repeat(Math.round((lines / maxLines) * 20));
	console.log(`  ${lang.padEnd(20)} ${bar.padEnd(20)} ${formatNum(lines)}`);
}

// Calculate total PRs if included
let summaryText = `\nProcessed ${stats.meta.totalCommitsProcessed} commits`;
if (!opts.excludePrCounts) {
	const totalPRs = Object.values(prCountByRepo).reduce((sum, count) => sum + count, 0);
	summaryText += `, ${totalPRs} PRs`;
}
summaryText += ` across ${stats.meta.totalRepos} repos`;
if (opts.excludePrCounts) {
	summaryText += ` (PR collection skipped)`;
}

console.log(chalk.gray(summaryText));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMinutes(minutes: number): string {
	if (minutes < 1) return "< 1 min";
	if (minutes < 60) return `~${Math.round(minutes)} min`;
	const h = Math.floor(minutes / 60);
	const m = Math.round(minutes % 60);
	return `~${h}h ${m}m`;
}

function formatNum(n: number): string {
	return n.toLocaleString("en-US");
}
