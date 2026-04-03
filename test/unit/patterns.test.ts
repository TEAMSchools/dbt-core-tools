import * as assert from "assert";
import {
  extractRef,
  extractSource,
  extractSourceCalls,
  findRefAtPosition,
  findSourceAtPosition,
} from "../../src/utils/patterns";

describe("extractRef", () => {
  it("extracts model name from double-quoted ref", () => {
    assert.strictEqual(extractRef('ref("my_model")'), "my_model");
  });

  it("extracts model name from single-quoted ref", () => {
    assert.strictEqual(extractRef("ref('my_model')"), "my_model");
  });

  it("handles whitespace inside ref()", () => {
    assert.strictEqual(extractRef('ref(  "my_model"  )'), "my_model");
  });

  it("handles whitespace between ref and parenthesis", () => {
    assert.strictEqual(extractRef('ref  (  "my_model"  )'), "my_model");
  });

  it("returns null for non-ref text", () => {
    assert.strictEqual(extractRef("source('schema', 'table')"), null);
  });

  it("returns null for empty string", () => {
    assert.strictEqual(extractRef(""), null);
  });

  it("returns null for plain model name", () => {
    assert.strictEqual(extractRef("my_model"), null);
  });

  it("extracts model name with underscores and numbers", () => {
    assert.strictEqual(extractRef('ref("stg_orders_v2")'), "stg_orders_v2");
  });
});

describe("extractSource", () => {
  it("extracts sourceName and tableName from double-quoted source", () => {
    const result = extractSource('source("jaffle_shop", "orders")');
    assert.deepStrictEqual(result, {
      sourceName: "jaffle_shop",
      tableName: "orders",
    });
  });

  it("extracts sourceName and tableName from single-quoted source", () => {
    const result = extractSource("source('jaffle_shop', 'orders')");
    assert.deepStrictEqual(result, {
      sourceName: "jaffle_shop",
      tableName: "orders",
    });
  });

  it("handles whitespace inside source()", () => {
    const result = extractSource('source(  "jaffle_shop"  ,  "orders"  )');
    assert.deepStrictEqual(result, {
      sourceName: "jaffle_shop",
      tableName: "orders",
    });
  });

  it("handles whitespace between source and parenthesis", () => {
    const result = extractSource('source  (  "jaffle_shop"  ,  "orders"  )');
    assert.deepStrictEqual(result, {
      sourceName: "jaffle_shop",
      tableName: "orders",
    });
  });

  it("returns null for non-source text", () => {
    assert.strictEqual(extractSource('ref("my_model")'), null);
  });

  it("returns null for empty string", () => {
    assert.strictEqual(extractSource(""), null);
  });

  it("returns null for source with only one argument", () => {
    assert.strictEqual(extractSource('source("jaffle_shop")'), null);
  });
});

describe("extractSourceCalls", () => {
  it("extracts all source calls from a SQL string", () => {
    const sql = `
      SELECT *
      FROM {{ source('jaffle_shop', 'orders') }}
      JOIN {{ source('jaffle_shop', 'customers') }} USING (customer_id)
    `;
    const result = extractSourceCalls(sql);
    assert.deepStrictEqual(result, [
      { sourceName: "jaffle_shop", tableName: "orders" },
      { sourceName: "jaffle_shop", tableName: "customers" },
    ]);
  });

  it("returns empty array when no source calls are found", () => {
    const sql = `SELECT * FROM {{ ref('my_model') }}`;
    assert.deepStrictEqual(extractSourceCalls(sql), []);
  });

  it("returns empty array for empty string", () => {
    assert.deepStrictEqual(extractSourceCalls(""), []);
  });

  it("extracts a single source call", () => {
    const sql = `SELECT id FROM {{ source("raw", "events") }}`;
    const result = extractSourceCalls(sql);
    assert.deepStrictEqual(result, [
      { sourceName: "raw", tableName: "events" },
    ]);
  });

  it("handles source calls with mixed quotes", () => {
    const sql = `SELECT * FROM {{ source("schema_a", "tbl_1") }}, {{ source('schema_b', 'tbl_2') }}`;
    const result = extractSourceCalls(sql);
    assert.deepStrictEqual(result, [
      { sourceName: "schema_a", tableName: "tbl_1" },
      { sourceName: "schema_b", tableName: "tbl_2" },
    ]);
  });

  it("deduplicates identical source calls", () => {
    const sql = `
      SELECT * FROM {{ source('raw', 'events') }}
      UNION ALL
      SELECT * FROM {{ source('raw', 'events') }}
    `;
    const result = extractSourceCalls(sql);
    assert.deepStrictEqual(result, [
      { sourceName: "raw", tableName: "events" },
    ]);
  });
});

describe("findRefAtPosition", () => {
  it("returns model name when cursor is inside a ref()", () => {
    const line = `SELECT * FROM {{ ref('my_model') }}`;
    // cursor at position 22, inside 'my_model'
    const result = findRefAtPosition(line, 22);
    assert.strictEqual(result, "my_model");
  });

  it("returns model name when cursor is at the start of the ref call", () => {
    const line = `{{ ref('orders') }}`;
    // cursor at position 3, on 'r' of ref
    const result = findRefAtPosition(line, 3);
    assert.strictEqual(result, "orders");
  });

  it("returns model name when cursor is at the end of the ref call", () => {
    const line = `{{ ref('orders') }}`;
    // position 15 is the closing ')'
    const result = findRefAtPosition(line, 15);
    assert.strictEqual(result, "orders");
  });

  it("returns null when cursor is outside any ref()", () => {
    const line = `SELECT * FROM {{ ref('my_model') }}`;
    // cursor far after the ref
    const result = findRefAtPosition(line, 34);
    assert.strictEqual(result, null);
  });

  it("returns null for a line with no ref()", () => {
    const line = `SELECT id, name FROM orders`;
    const result = findRefAtPosition(line, 5);
    assert.strictEqual(result, null);
  });

  it("returns correct model when multiple refs are on the same line", () => {
    const line = `{{ ref('model_a') }} JOIN {{ ref('model_b') }}`;
    // cursor at position 10, inside 'model_a'
    const resultA = findRefAtPosition(line, 10);
    assert.strictEqual(resultA, "model_a");
    // cursor at position 35, inside 'model_b'
    const resultB = findRefAtPosition(line, 35);
    assert.strictEqual(resultB, "model_b");
  });
});

describe("findSourceAtPosition", () => {
  it("returns source info when cursor is inside a source()", () => {
    const line = `SELECT * FROM {{ source('jaffle_shop', 'orders') }}`;
    // cursor at position 25, inside 'jaffle_shop'
    const result = findSourceAtPosition(line, 25);
    assert.deepStrictEqual(result, {
      sourceName: "jaffle_shop",
      tableName: "orders",
    });
  });

  it("returns source info when cursor is at the start of the source call", () => {
    const line = `{{ source('raw', 'events') }}`;
    // cursor at position 3, on 's' of source
    const result = findSourceAtPosition(line, 3);
    assert.deepStrictEqual(result, { sourceName: "raw", tableName: "events" });
  });

  it("returns source info when cursor is at the end of the source call", () => {
    const line = `{{ source('raw', 'events') }}`;
    // position 24 is the closing ')'
    const result = findSourceAtPosition(line, 24);
    assert.deepStrictEqual(result, { sourceName: "raw", tableName: "events" });
  });

  it("returns null when cursor is outside any source()", () => {
    const line = `SELECT * FROM {{ source('raw', 'events') }}`;
    // cursor far after the source
    const result = findSourceAtPosition(line, 42);
    assert.strictEqual(result, null);
  });

  it("returns null for a line with no source()", () => {
    const line = `SELECT * FROM {{ ref('my_model') }}`;
    const result = findSourceAtPosition(line, 10);
    assert.strictEqual(result, null);
  });

  it("returns correct source when multiple sources are on the same line", () => {
    const line = `{{ source('schema_a', 'tbl_1') }} JOIN {{ source('schema_b', 'tbl_2') }}`;
    // cursor at position 12, inside 'schema_a'
    const resultA = findSourceAtPosition(line, 12);
    assert.deepStrictEqual(resultA, {
      sourceName: "schema_a",
      tableName: "tbl_1",
    });
    // cursor at position 52, inside 'schema_b'
    const resultB = findSourceAtPosition(line, 52);
    assert.deepStrictEqual(resultB, {
      sourceName: "schema_b",
      tableName: "tbl_2",
    });
  });
});
