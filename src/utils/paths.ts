/**
 * Path utilities for safely resolving manifest-derived paths within a project
 * root. Prevents path traversal via "../" sequences in manifest data.
 */

import * as path from "path";

/**
 * Joins `rootPath` with `relativePath` and verifies the result stays within
 * `rootPath`. Returns `null` if the resolved path escapes the root directory.
 */
export function safeJoinPath(
  rootPath: string,
  relativePath: string,
): string | null {
  const resolved = path.resolve(rootPath, relativePath);
  const root = path.resolve(rootPath);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return null;
  }
  return resolved;
}

/**
 * Extracts the relative file path from a dbt `patch_path` value.
 * Strips the `"project_name://"` prefix if present.
 */
export function parsePatchPath(patchPath: string): string {
  const idx = patchPath.indexOf("://");
  return idx >= 0 ? patchPath.slice(idx + 3) : patchPath;
}

/**
 * Extracts the dbt model name from a file path by taking the basename
 * and stripping the `.sql` extension. Returns an empty string if the
 * path has no filename.
 */
export function modelNameFromPath(fsPath: string): string {
  const fileName = fsPath.split(/[\\/]/).pop() ?? "";
  return fileName.replace(/\.sql$/i, "");
}
