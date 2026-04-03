/**
 * Regex patterns and extraction utilities for ref() and source() references
 * in dbt SQL files. Used by definition, hover, completion providers and the
 * stage external sources command.
 */

export interface SourceRef {
  sourceName: string;
  tableName: string;
}

// Regex source strings — fresh RegExp instances are created per call to avoid
// stateful lastIndex bugs with global regexes.
const REF_SOURCE = String.raw`ref\s*\(\s*['"]([^'"]+)['"]\s*\)`;
const SOURCE_SOURCE = String.raw`source\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)`;

// Non-global patterns for single-match functions
const REF_PATTERN = new RegExp(REF_SOURCE);
const SOURCE_PATTERN = new RegExp(SOURCE_SOURCE);

/**
 * Extracts the model name from a single `ref()` call in text.
 * Returns null if no ref() is found.
 */
export function extractRef(text: string): string | null {
  const match = REF_PATTERN.exec(text);
  return match ? match[1] : null;
}

/**
 * Extracts `{sourceName, tableName}` from a single `source()` call in text.
 * Returns null if no source() is found or the call has fewer than two arguments.
 */
export function extractSource(text: string): SourceRef | null {
  const match = SOURCE_PATTERN.exec(text);
  return match ? { sourceName: match[1], tableName: match[2] } : null;
}

/**
 * Extracts all unique source() calls from a SQL string.
 * Used by the Stage External Sources command to enumerate sources in a file.
 */
export function extractSourceCalls(sql: string): SourceRef[] {
  const seen = new Set<string>();
  const results: SourceRef[] = [];
  const pattern = new RegExp(SOURCE_SOURCE, "g");

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    const sourceName = match[1];
    const tableName = match[2];
    const key = `${sourceName}:${tableName}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ sourceName, tableName });
    }
  }

  return results;
}

/**
 * Returns the model name if the cursor position (character index) falls within
 * a `ref()` call on the given line. Returns null otherwise.
 */
export function findRefAtPosition(
  line: string,
  character: number
): string | null {
  const pattern = new RegExp(REF_SOURCE, "g");

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length - 1;
    if (character >= start && character <= end) {
      return match[1];
    }
  }

  return null;
}

/**
 * Returns `{sourceName, tableName}` if the cursor position (character index)
 * falls within a `source()` call on the given line. Returns null otherwise.
 */
export function findSourceAtPosition(
  line: string,
  character: number
): SourceRef | null {
  const pattern = new RegExp(SOURCE_SOURCE, "g");

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length - 1;
    if (character >= start && character <= end) {
      return { sourceName: match[1], tableName: match[2] };
    }
  }

  return null;
}
