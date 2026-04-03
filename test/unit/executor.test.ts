/**
 * Unit tests for buildDbtCommand (pure function — no vscode dependency).
 */

import * as assert from "assert";
import { buildDbtCommand, DbtCommandOptions } from "../../src/core/executor";

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
      `Expected --profiles-dir=/custom in: ${cmd}`
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
      `Expected --state=/ws/target/prod in: ${cmd}`
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
      `Expected --full-refresh in: ${cmd}`
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
      `Did not expect --full-refresh in: ${cmd}`
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
      `Expected --vars in: ${cmd}`
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
      `Expected extra args in: ${cmd}`
    );
  });
});
