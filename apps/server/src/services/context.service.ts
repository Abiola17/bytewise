import { createHash } from "node:crypto";
import path from "node:path";
import type { EvidenceItem, EvidenceResponse } from "@bytewise/shared";
import type { SearchableFile } from "../filesystem/text-search";

export const CONTEXT_BUDGET = {
  maxItems: 12,
  maxTotalChars: 16_000,
  maxExcerptLines: 40,
  maxTerms: 12,
  contextLines: 3,
  maxWindowsPerFile: 2,
  importHops: 2,
};

const STOPWORDS = new Set(
  (
    "the a an and or but if then else when while for to of in on at by with from into onto " +
    "is are was were be been being do does did done have has had this that these those it its " +
    "i we you they he she me my our your their them what which who whom why how where can could " +
    "should would will shall may might must not no yes so than too very just also only " +
    "please fix bug issue error problem investigate find cause propose look check help " +
    "returns return get gets got make makes made work works working broken fails failing " +
    "after before because about some any all each every there here"
  ).split(" "),
);

interface Term {
  text: string;
  /** Lowercased for matching. */
  needle: string;
  weight: number;
}

interface StackLocation {
  file: string;
  line: number;
}

/** Pulls search terms out of a natural-language request, error message or stack trace. */
export function extractTerms(query: string): Term[] {
  const terms = new Map<string, Term>();
  const add = (text: string, weight: number) => {
    const needle = text.toLowerCase();
    if (needle.length < 3 || STOPWORDS.has(needle)) return;
    const existing = terms.get(needle);
    if (!existing || existing.weight < weight) terms.set(needle, { text, needle, weight });
  };

  // Quoted phrases are the strongest signal: "exact error text" or `codeIdentifier`.
  for (const match of query.matchAll(/["'`]([^"'`\n]{3,80})["'`]/g)) add(match[1]!.trim(), 4);

  // File locations are handled by extractStackLocations; their path segments
  // (`file:///home/app/src/...`) would only add noise terms.
  const prose = query.replace(/\S*\.(?:[cm]?[jt]sx?|json):\d+(?::\d+)?\)?/g, " ");

  for (const match of prose.matchAll(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g)) {
    const token = match[0];
    const isCodeLike = /[a-z][A-Z]|_|\$|\./.test(token) || /^[A-Z][a-z]+[A-Z]/.test(token);
    if (token.includes(".")) {
      // `config.secret` → also search `secret`.
      for (const part of token.split(".")) add(part, isCodeLike ? 3 : 1);
      if (!/\.(js|ts|jsx|tsx|mjs|cjs|json)$/i.test(token)) add(token, 3);
    } else {
      add(token, isCodeLike ? 3 : 1);
    }
  }

  // Three-digit numbers are usually HTTP status codes worth matching.
  for (const match of query.matchAll(/\b[1-5]\d{2}\b/g)) add(match[0], 1);

  return [...terms.values()]
    .sort((a, b) => b.weight - a.weight || b.needle.length - a.needle.length)
    .slice(0, CONTEXT_BUDGET.maxTerms);
}

/** Finds `path/to/file.ts:12` references (as in stack traces) that exist in the project. */
export function extractStackLocations(query: string, knownPaths: string[]): StackLocation[] {
  const locations: StackLocation[] = [];
  const seen = new Set<string>();
  for (const match of query.matchAll(/([\w@./\\-]+\.(?:[cm]?[jt]sx?|json)):(\d+)/g)) {
    const raw = match[1]!.replace(/\\/g, "/");
    const line = Number(match[2]);
    const file = knownPaths.find((p) => raw === p || raw.endsWith(`/${p}`));
    if (!file || line < 1) continue;
    const key = `${file}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push({ file, line });
  }
  return locations;
}

function classify(relativePath: string): EvidenceItem["sourceType"] {
  if (/(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(relativePath)) {
    return "test_file";
  }
  const base = path.posix.basename(relativePath);
  if (/^(package\.json|tsconfig.*\.json|.*\.config\.[cm]?[jt]s|config\.[cm]?[jt]s)$/.test(base)) {
    return "config_file";
  }
  return "source_file";
}

/** Stable for identical content: a changed file yields a new id, never a stale one. */
function evidenceId(relativePath: string, startLine: number, endLine: number, text: string) {
  const hash = createHash("sha1")
    .update(`${relativePath}:${startLine}-${endLine}\n${text}`)
    .digest("hex");
  return `ev_${hash.slice(0, 12)}`;
}

function excerpt(file: SearchableFile, startLine: number, endLine: number): string {
  return file.lines.slice(startLine - 1, endLine).join("\n");
}

interface Window {
  start: number;
  end: number;
  hits: number;
  terms: Set<string>;
}

/** Groups matching lines into merged windows of surrounding context. */
function matchWindows(file: SearchableFile, terms: Term[]): Window[] {
  const windows: Window[] = [];
  const lastLine = file.lines.length;

  file.lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    const matched = terms.filter((t) => lower.includes(t.needle)).map((t) => t.text);
    if (matched.length === 0) return;

    const lineNo = index + 1;
    const start = Math.max(1, lineNo - CONTEXT_BUDGET.contextLines);
    const end = Math.min(lastLine, lineNo + CONTEXT_BUDGET.contextLines);
    const previous = windows[windows.length - 1];

    if (
      previous &&
      start <= previous.end + 1 &&
      end - previous.start < CONTEXT_BUDGET.maxExcerptLines
    ) {
      previous.end = Math.max(previous.end, end);
      previous.hits += matched.length;
      matched.forEach((m) => previous.terms.add(m));
    } else {
      windows.push({ start, end, hits: matched.length, terms: new Set(matched) });
    }
  });
  return windows;
}

/** Relative imports (`./x.js`, `../y`) of a JS/TS file, resolved to known project paths. */
export function relativeImports(file: SearchableFile, knownPaths: Set<string>): string[] {
  const source = file.lines.join("\n");
  const dir = path.posix.dirname(file.path);
  const result: string[] = [];
  const pattern =
    /(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\s*\(\s*|export\s[^'"]*?from\s*)["'](\.{1,2}\/[^"']+)["']/g;

  for (const match of source.matchAll(pattern)) {
    const base = path.posix.normalize(path.posix.join(dir, match[1]!));
    const withoutJs = base.replace(/\.[cm]?js$/, "");
    const candidates = [
      base,
      ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].map((ext) => withoutJs + ext),
      ...["/index.ts", "/index.js"].map((idx) => base + idx),
    ];
    const found = candidates.find((c) => knownPaths.has(c));
    if (found && !result.includes(found)) result.push(found);
  }
  return result;
}

/**
 * Builds a bounded, ranked set of evidence for a debugging request using
 * plain text search, stack-trace locations and one or two hops of relative
 * imports from the best-matching files.
 */
export function buildEvidence(files: SearchableFile[], query: string): EvidenceResponse {
  const terms = extractTerms(query);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const knownPaths = new Set(byPath.keys());
  const candidates: EvidenceItem[] = [];
  const covered = new Map<string, Array<[number, number]>>();

  const push = (item: Omit<EvidenceItem, "id">) => {
    const ranges = covered.get(item.relativePath) ?? [];
    if (ranges.some(([s, e]) => item.startLine >= s && item.endLine <= e)) return;
    ranges.push([item.startLine, item.endLine]);
    covered.set(item.relativePath, ranges);
    candidates.push({
      id: evidenceId(item.relativePath, item.startLine, item.endLine, item.excerpt),
      ...item,
    });
  };

  // 1. Locations named in a stack trace are the most direct evidence.
  const stackLocations = extractStackLocations(query, [...knownPaths]);
  for (const location of stackLocations) {
    const file = byPath.get(location.file)!;
    const line = Math.min(location.line, file.lines.length);
    const startLine = Math.max(1, line - 5);
    const endLine = Math.min(file.lines.length, line + 5);
    push({
      sourceType: "stack_trace_location",
      relativePath: file.path,
      startLine,
      endLine,
      excerpt: excerpt(file, startLine, endLine),
      reason: `Referenced in the provided stack trace at line ${location.line}.`,
      score: 100,
    });
  }

  // 2. Text-search matches, scored per file by distinct terms, hits and path matches.
  const scoredFiles = files
    .map((file) => {
      const windows = matchWindows(file, terms);
      const lowerPath = file.path.toLowerCase();
      const pathTerms = terms.filter((t) => lowerPath.includes(t.needle));
      const distinct = new Set(windows.flatMap((w) => [...w.terms]));
      pathTerms.forEach((t) => distinct.add(t.text));
      const termScore = terms
        .filter((t) => distinct.has(t.text))
        .reduce((sum, t) => sum + t.weight, 0);
      const hits = windows.reduce((sum, w) => sum + w.hits, 0);
      const score =
        termScore * 2 + Math.log2(1 + hits) + pathTerms.reduce((sum, t) => sum + t.weight * 2, 0);
      return { file, windows, pathTerms, score };
    })
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const { file, windows, pathTerms, score } of scoredFiles) {
    const best = [...windows]
      .sort((a, b) => b.terms.size - a.terms.size || b.hits - a.hits)
      .slice(0, CONTEXT_BUDGET.maxWindowsPerFile);

    if (best.length === 0 && pathTerms.length > 0) {
      // Filename matches but no content matches: show the top of the file.
      const endLine = Math.min(file.lines.length, CONTEXT_BUDGET.maxExcerptLines);
      push({
        sourceType: classify(file.path),
        relativePath: file.path,
        startLine: 1,
        endLine: Math.max(1, endLine),
        excerpt: excerpt(file, 1, endLine),
        reason: `File path matches ${pathTerms.map((t) => `"${t.text}"`).join(", ")}.`,
        score,
      });
      continue;
    }

    for (const window of best) {
      const matched = [...window.terms].map((t) => `"${t}"`).join(", ");
      push({
        sourceType: classify(file.path),
        relativePath: file.path,
        startLine: window.start,
        endLine: window.end,
        excerpt: excerpt(file, window.start, window.end),
        reason: `Matches ${matched} (${window.hits} ${window.hits === 1 ? "hit" : "hits"}).`,
        score: score + window.terms.size,
      });
    }
  }

  // 3. Follow relative imports from the strongest non-test matches: the cause
  //    often lives in a module the matching code calls, not the code itself.
  //    Files named in a stack trace come first: what they import is often
  //    where the bad value is defined.
  const stackSeeds = [...new Set(stackLocations.map((l) => l.file))]
    .filter((p) => classify(p) !== "test_file")
    .map((p) => ({ path: p, score: 100 }));
  const textSeeds = scoredFiles
    .filter((f) => classify(f.file.path) !== "test_file")
    .filter((f) => !stackSeeds.some((s) => s.path === f.file.path))
    .slice(0, 3)
    .map((f) => ({ path: f.file.path, score: f.score }));
  const seeds = [...stackSeeds, ...textSeeds];
  const visited = new Set(seeds.map((s) => s.path));
  let frontier = seeds;

  for (let hop = 1; hop <= CONTEXT_BUDGET.importHops && frontier.length > 0; hop++) {
    const nextFrontier: typeof frontier = [];
    for (const seed of frontier) {
      for (const imported of relativeImports(byPath.get(seed.path)!, knownPaths)) {
        if (visited.has(imported)) continue;
        visited.add(imported);
        const file = byPath.get(imported)!;
        const endLine = Math.max(1, Math.min(file.lines.length, CONTEXT_BUDGET.maxExcerptLines));
        const score = seed.score / (hop + 1);
        push({
          sourceType: classify(file.path),
          relativePath: file.path,
          startLine: 1,
          endLine,
          excerpt: excerpt(file, 1, endLine),
          reason: `Imported by ${seed.path}.`,
          score,
        });
        nextFrontier.push({ path: imported, score });
      }
    }
    frontier = nextFrontier;
  }

  // 4. Drop excerpts fully contained in a larger excerpt of the same file,
  //    keeping the larger one with the better score and reason.
  const deduped = candidates.filter(
    (item) =>
      !candidates.some(
        (other) =>
          other !== item &&
          other.relativePath === item.relativePath &&
          other.startLine <= item.startLine &&
          other.endLine >= item.endLine &&
          (other.startLine !== item.startLine || other.endLine !== item.endLine),
      ),
  );
  for (const item of deduped) {
    const absorbed = candidates.filter(
      (c) =>
        c !== item &&
        c.relativePath === item.relativePath &&
        c.startLine >= item.startLine &&
        c.endLine <= item.endLine &&
        c.score > item.score,
    );
    const best = absorbed.sort((a, b) => b.score - a.score)[0];
    if (best) {
      item.score = best.score;
      item.reason = best.reason;
      item.sourceType = best.sourceType;
    }
  }

  // 5. Apply the budget: highest score first, within item and character limits.
  deduped.sort((a, b) => b.score - a.score);
  const evidence: EvidenceItem[] = [];
  let usedChars = 0;
  let droppedItems = 0;
  for (const item of deduped) {
    if (
      evidence.length >= CONTEXT_BUDGET.maxItems ||
      usedChars + item.excerpt.length > CONTEXT_BUDGET.maxTotalChars
    ) {
      droppedItems++;
      continue;
    }
    evidence.push({ ...item, score: Math.round(item.score * 100) / 100 });
    usedChars += item.excerpt.length;
  }

  return {
    evidence,
    terms: terms.map((t) => t.text),
    budget: {
      maxItems: CONTEXT_BUDGET.maxItems,
      maxTotalChars: CONTEXT_BUDGET.maxTotalChars,
      usedChars,
      droppedItems,
    },
  };
}
