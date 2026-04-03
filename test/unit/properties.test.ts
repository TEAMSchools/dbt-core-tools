import * as assert from "assert";
import { scaffoldYaml } from "../../src/features/properties";

describe("scaffoldYaml", () => {
  it("includes version: 2 header", () => {
    const result = scaffoldYaml("my_model", []);
    assert.ok(result.includes("version: 2"), "expected 'version: 2' in output");
  });

  it("includes 'models:' section", () => {
    const result = scaffoldYaml("my_model", []);
    assert.ok(result.includes("models:"), "expected 'models:' in output");
  });

  it("includes the model name entry", () => {
    const result = scaffoldYaml("my_model", []);
    assert.ok(
      result.includes("- name: my_model"),
      "expected '- name: my_model' in output",
    );
  });

  it("includes all column names when columns are provided", () => {
    const result = scaffoldYaml("orders", [
      "order_id",
      "customer_id",
      "amount",
    ]);
    assert.ok(
      result.includes("- name: order_id"),
      "expected '- name: order_id'",
    );
    assert.ok(
      result.includes("- name: customer_id"),
      "expected '- name: customer_id'",
    );
    assert.ok(result.includes("- name: amount"), "expected '- name: amount'");
  });

  it("includes 'columns:' section when columns are provided", () => {
    const result = scaffoldYaml("orders", ["order_id", "customer_id"]);
    assert.ok(result.includes("columns:"), "expected 'columns:' in output");
  });

  it("does not include 'description:' keys", () => {
    const result = scaffoldYaml("orders", ["order_id", "customer_id"]);
    assert.ok(
      !result.includes("description:"),
      "unexpected 'description:' in output",
    );
  });

  it("does not include 'columns:' section when no columns provided", () => {
    const result = scaffoldYaml("my_model", []);
    assert.ok(
      !result.includes("columns:"),
      "unexpected 'columns:' when no columns given",
    );
  });

  it("handles a model with a single column", () => {
    const result = scaffoldYaml("dim_users", ["user_id"]);
    assert.ok(
      result.includes("- name: dim_users"),
      "expected model name entry",
    );
    assert.ok(result.includes("- name: user_id"), "expected column entry");
    assert.ok(!result.includes("description:"), "unexpected 'description:'");
  });

  it("produces valid indented YAML structure with columns", () => {
    const result = scaffoldYaml("stg_orders", ["id", "status"]);
    // columns: should appear after the model name line
    const modelIdx = result.indexOf("- name: stg_orders");
    const columnsIdx = result.indexOf("columns:");
    assert.ok(modelIdx >= 0, "model entry not found");
    assert.ok(columnsIdx > modelIdx, "'columns:' should come after model name");
  });
});
