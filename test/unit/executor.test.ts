/**
 * Unit tests for buildDbtCommand and resolveDbtExecutable (pure functions — no vscode dependency).
 */

import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  buildDbtCommand,
  DbtCommandOptions,
  resolveDbtExecutable,
} from "../../src/core/executor";

describe("buildDbtCommand", () => {
  it("builds a basic run command with selector and project dir", () => {
    const opts: DbtCommandOptions = {
      dbtCommand: "dbt",
      subcommand: "run",
      projectDir: "/ws",
      selector: "my_model",
    };
    const cmd = buildDbtCommand(opts);
    assert.strictEqual(cmd, "dbt run -s my_model --project-dir=/ws");
  });

  it("supports a custom dbt command (e.g. uv run dbt) and build subcommand", () => {
    const opts: DbtCommandOptions = {
      dbtCommand: "uv run dbt",
      subcommand: "build",
      projectDir: "/ws",
      selector: "+my_model+",
    };
    const cmd = buildDbtCommand(opts);
    assert.strictEqual(cmd, "uv run dbt build -s +my_model+ --project-dir=/ws");
  });

  it("includes --target flag when target is specified", () => {
    const opts: DbtCommandOptions = {
      dbtCommand: "dbt",
      subcommand: "run",
      projectDir: "/ws",
      selector: "my_model",
      target: "dev",
    };
    const cmd = buildDbtCommand(opts);
    assert.ok(cmd.includes("--target=dev"), `Expected --target=dev in: ${cmd}`);
  });

  it("includes --profiles-dir flag when profilesDir is specified", () => {
    const opts: DbtCommandOptions = {
      dbtCommand: "dbt",
      subcommand: "run",
      projectDir: "/ws",
      selector: "my_model",
      profilesDir: "/custom",
    };
    const cmd = buildDbtCommand(opts);
    assert.ok(
      cmd.includes("--profiles-dir=/custom"),
      `Expected --profiles-dir=/custom in: ${cmd}`,
    );
  });

  it("includes --defer and --state flags when deferState is specified", () => {
    const opts: DbtCommandOptions = {
      dbtCommand: "dbt",
      subcommand: "run",
      projectDir: "/ws",
      selector: "my_model",
      deferState: "/ws/target/prod",
    };
    const cmd = buildDbtCommand(opts);
    assert.ok(cmd.includes("--defer"), `Expected --defer in: ${cmd}`);
    assert.ok(
      cmd.includes("--state=/ws/target/prod"),
      `Expected --state=/ws/target/prod in: ${cmd}`,
    );
  });

  it("includes --full-refresh flag when fullRefresh is true", () => {
    const opts: DbtCommandOptions = {
      dbtCommand: "dbt",
      subcommand: "run",
      projectDir: "/ws",
      selector: "my_model",
      fullRefresh: true,
    };
    const cmd = buildDbtCommand(opts);
    assert.ok(
      cmd.includes("--full-refresh"),
      `Expected --full-refresh in: ${cmd}`,
    );
  });

  it("omits --full-refresh when fullRefresh is false or not set", () => {
    const opts: DbtCommandOptions = {
      dbtCommand: "dbt",
      subcommand: "run",
      projectDir: "/ws",
      selector: "my_model",
      fullRefresh: false,
    };
    const cmd = buildDbtCommand(opts);
    assert.ok(
      !cmd.includes("--full-refresh"),
      `Did not expect --full-refresh in: ${cmd}`,
    );
  });

  it("builds a lifecycle command (no selector) like dbt parse", () => {
    const opts: DbtCommandOptions = {
      dbtCommand: "dbt",
      subcommand: "parse",
      projectDir: "/ws",
    };
    const cmd = buildDbtCommand(opts);
    assert.strictEqual(cmd, "dbt parse --project-dir=/ws");
  });

  it("includes --vars flag when vars is specified", () => {
    const opts: DbtCommandOptions = {
      dbtCommand: "dbt",
      subcommand: "run",
      projectDir: "/ws",
      selector: "my_model",
      vars: '{"key": "value"}',
    };
    const cmd = buildDbtCommand(opts);
    assert.ok(
      cmd.includes('--vars={"key": "value"}'),
      `Expected --vars in: ${cmd}`,
    );
  });

  it("includes --limit flag when limit is specified", () => {
    const opts: DbtCommandOptions = {
      dbtCommand: "dbt",
      subcommand: "show",
      projectDir: "/ws",
      selector: "my_model",
      limit: 10,
    };
    const cmd = buildDbtCommand(opts);
    assert.ok(cmd.includes("--limit=10"), `Expected --limit=10 in: ${cmd}`);
  });

  it("appends extra args when args is specified", () => {
    const opts: DbtCommandOptions = {
      dbtCommand: "dbt",
      subcommand: "run",
      projectDir: "/ws",
      selector: "my_model",
      args: "--no-partial-parse",
    };
    const cmd = buildDbtCommand(opts);
    assert.ok(
      cmd.includes("--no-partial-parse"),
      `Expected extra args in: ${cmd}`,
    );
  });
});

describe("resolveDbtExecutable", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbt-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns venv dbt path when .venv/bin/dbt exists and dbtCommand is default", () => {
    const venvBin = path.join(tmpDir, ".venv", "bin");
    fs.mkdirSync(venvBin, { recursive: true });
    fs.writeFileSync(path.join(venvBin, "dbt"), "", { mode: 0o755 });

    const result = resolveDbtExecutable("dbt", tmpDir);
    assert.strictEqual(result, path.join(venvBin, "dbt"));
  });

  it("returns original dbtCommand when explicitly set to non-default", () => {
    const venvBin = path.join(tmpDir, ".venv", "bin");
    fs.mkdirSync(venvBin, { recursive: true });
    fs.writeFileSync(path.join(venvBin, "dbt"), "", { mode: 0o755 });

    const result = resolveDbtExecutable("uv run dbt", tmpDir);
    assert.strictEqual(result, "uv run dbt");
  });

  it("returns 'dbt' unchanged when no venv exists", () => {
    const result = resolveDbtExecutable("dbt", tmpDir);
    assert.strictEqual(result, "dbt");
  });

  it("checks VIRTUAL_ENV env var as fallback", () => {
    const venvDir = path.join(tmpDir, "custom-venv");
    const venvBin = path.join(venvDir, "bin");
    fs.mkdirSync(venvBin, { recursive: true });
    fs.writeFileSync(path.join(venvBin, "dbt"), "", { mode: 0o755 });

    const originalEnv = process.env["VIRTUAL_ENV"];
    process.env["VIRTUAL_ENV"] = venvDir;
    try {
      const result = resolveDbtExecutable("dbt", tmpDir);
      assert.strictEqual(result, path.join(venvBin, "dbt"));
    } finally {
      if (originalEnv === undefined) {
        delete process.env["VIRTUAL_ENV"];
      } else {
        process.env["VIRTUAL_ENV"] = originalEnv;
      }
    }
  });
});
