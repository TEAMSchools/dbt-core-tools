/**
 * Parses profiles.yml using line-based logic to extract available targets
 * for a given profile name. No YAML library dependency.
 */

import * as fs from "fs";

export interface ProfileTargets {
  targets: string[];
  defaultTarget: string | null;
}

/**
 * Parses `profilesPath` (profiles.yml) and returns the list of output
 * targets for `profileName`, sorted alphabetically, along with the
 * default target value from the `target:` key.
 *
 * Returns `{ targets: [], defaultTarget: null }` if:
 * - The file does not exist or cannot be read
 * - The profile name is not found in the file
 */
export function parseProfileTargets(
  profilesPath: string,
  profileName: string,
): ProfileTargets {
  let content: string;
  try {
    content = fs.readFileSync(profilesPath, "utf8");
  } catch {
    return { targets: [], defaultTarget: null };
  }

  const lines = content.split("\n");

  type Phase = "seek_profile" | "in_profile" | "in_outputs" | "done";
  let phase: Phase = "seek_profile";
  let defaultTarget: string | null = null;
  const targets: string[] = [];
  let outputsIndent = -1;
  let targetTierIndent = -1;

  for (const rawLine of lines) {
    // Skip blank lines and comment-only lines
    if (rawLine.trim() === "" || rawLine.trimStart().startsWith("#")) {
      continue;
    }

    const indent = rawLine.length - rawLine.trimStart().length;
    const trimmed = rawLine.trimStart();

    switch (phase) {
      case "seek_profile": {
        // Profile name keys live at indent level 0 and end with ":"
        if (indent === 0 && trimmed === `${profileName}:`) {
          phase = "in_profile";
        }
        break;
      }

      case "in_profile": {
        // Any top-level key (indent === 0) means we have exited this profile
        if (indent === 0) {
          phase = "done";
          break;
        }

        // Capture `target: <value>` — the default target for this profile
        const targetMatch = /^target:\s*['"]?([^\s'"#]+)/.exec(trimmed);
        if (targetMatch) {
          defaultTarget = targetMatch[1];
          break;
        }

        // Transition into the `outputs:` block
        if (trimmed === "outputs:") {
          outputsIndent = indent;
          phase = "in_outputs";
        }
        break;
      }

      case "in_outputs": {
        // Returning to the outputs indent level or above exits the block
        if (indent <= outputsIndent) {
          phase = indent === 0 ? "done" : "in_profile";
          break;
        }

        // The first key we encounter directly below `outputs:` establishes
        // the tier at which target names live. Deeper keys are sub-properties
        // of those targets (e.g. type, project, dataset) and are ignored.
        if (targetTierIndent === -1) {
          targetTierIndent = indent;
        }

        if (indent === targetTierIndent) {
          const keyMatch = /^([A-Za-z0-9_-]+):/.exec(trimmed);
          if (keyMatch) {
            targets.push(keyMatch[1]);
          }
        }
        break;
      }

      case "done":
        break;
    }

    if (phase === "done") {
      break;
    }
  }

  targets.sort();

  return { targets, defaultTarget };
}
