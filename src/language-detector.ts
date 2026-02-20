/**
 * Maps file extensions (and special filenames) to GitHub Linguist-style language names.
 * Only includes languages commonly seen in software repos.
 */
const EXT_MAP: Record<string, string> = {
	// TypeScript / JavaScript
	".ts": "TypeScript",
	".tsx": "TypeScript",
	".mts": "TypeScript",
	".cts": "TypeScript",
	".js": "JavaScript",
	".jsx": "JavaScript",
	".mjs": "JavaScript",
	".cjs": "JavaScript",
	// Web
	".html": "HTML",
	".htm": "HTML",
	".css": "CSS",
	".scss": "SCSS",
	".sass": "Sass",
	".less": "Less",
	".svelte": "Svelte",
	".vue": "Vue",
	".astro": "Astro",
	// Backend / Systems
	".py": "Python",
	".rb": "Ruby",
	".go": "Go",
	".rs": "Rust",
	".java": "Java",
	".kt": "Kotlin",
	".kts": "Kotlin",
	".cs": "C#",
	".cpp": "C++",
	".cc": "C++",
	".cxx": "C++",
	".c": "C",
	".h": "C",
	".hpp": "C++",
	".swift": "Swift",
	".php": "PHP",
	".scala": "Scala",
	".clj": "Clojure",
	".cljs": "ClojureScript",
	".ex": "Elixir",
	".exs": "Elixir",
	".erl": "Erlang",
	".hrl": "Erlang",
	".hs": "Haskell",
	".lhs": "Haskell",
	".ml": "OCaml",
	".mli": "OCaml",
	".fs": "F#",
	".fsi": "F#",
	".fsx": "F#",
	".dart": "Dart",
	".lua": "Lua",
	".r": "R",
	".R": "R",
	".m": "MATLAB",
	".julia": "Julia",
	".jl": "Julia",
	".nim": "Nim",
	".zig": "Zig",
	".cr": "Crystal",
	".d": "D",
	// Shell / Scripts
	".sh": "Shell",
	".bash": "Shell",
	".zsh": "Shell",
	".fish": "Shell",
	".ps1": "PowerShell",
	".psm1": "PowerShell",
	".bat": "Batchfile",
	".cmd": "Batchfile",
	// Data / Config
	".json": "JSON",
	".json5": "JSON5",
	".jsonc": "JSON",
	".yaml": "YAML",
	".yml": "YAML",
	".toml": "TOML",
	".xml": "XML",
	".csv": "CSV",
	".tsv": "TSV",
	".ini": "INI",
	".env": "Shell",
	// Infrastructure / Cloud
	".tf": "HCL",
	".tfvars": "HCL",
	".hcl": "HCL",
	".bicep": "Bicep",
	".dockerfile": "Dockerfile",
	// SQL
	".sql": "SQL",
	".pgsql": "SQL",
	".mysql": "SQL",
	// Documentation
	".md": "Markdown",
	".mdx": "MDX",
	".rst": "reStructuredText",
	".tex": "TeX",
	// GraphQL / API
	".graphql": "GraphQL",
	".gql": "GraphQL",
	".proto": "Protocol Buffer",
	// Other
	".nix": "Nix",
	".pkl": "Pkl",
	".wasm": "WebAssembly",
	".wat": "WebAssembly"
};

/** Special filenames with no extension */
const FILENAME_MAP: Record<string, string> = {
	Dockerfile: "Dockerfile",
	Makefile: "Makefile",
	Gemfile: "Ruby",
	Rakefile: "Ruby",
	Podfile: "Ruby",
	Vagrantfile: "Ruby",
	Brewfile: "Ruby",
	".eslintrc": "JSON",
	".prettierrc": "JSON",
	".babelrc": "JSON",
	".nvmrc": "Shell",
	".node-version": "Shell"
};

/** Languages to exclude from the output (not meaningful for a dev's skill radar) */
const EXCLUDED_LANGUAGES = new Set([
	"JSON",
	"YAML",
	"TOML",
	"XML",
	"CSV",
	"TSV",
	"INI",
	"Markdown",
	"MDX",
	"reStructuredText",
	"TeX"
]);

export function detectLanguage(filename: string): string | null {
	// Check special filenames first (basename only)
	const basename = filename.split("/").pop() ?? filename;
	if (FILENAME_MAP[basename]) return FILENAME_MAP[basename];

	// Get extension
	const dotIndex = basename.lastIndexOf(".");
	if (dotIndex === -1) return null;
	const ext = basename.slice(dotIndex).toLowerCase();

	return EXT_MAP[ext] ?? null;
}

export function isExcludedLanguage(language: string): boolean {
	return EXCLUDED_LANGUAGES.has(language);
}
