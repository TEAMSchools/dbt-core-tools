# Test dbt Project (Jaffle Shop)

Minimal dbt project for testing the dbt-core-tools VS Code extension. Covers: lineage, compiled SQL, autocomplete, go-to-definition, hover, column sync, model preview, command runner, defer, and stage external sources.

## Prerequisites

- Python 3.9+
- `dbt-core` and `dbt-duckdb` installed (`pip install dbt-core dbt-duckdb`)

## Setup

```bash
cd test/fixtures/test_project

# Install dbt packages (dbt-utils, dbt-external-tables)
uv run dbt deps

# Load seed data into DuckDB
uv run dbt seed

# Build everything (run models, snapshots, tests)
uv run dbt build

# Generate defer manifest (for defer toggle testing)
cp target/manifest.json defer_manifest/manifest.json
```

## Testing Extension Features

| Feature                    | How to Test                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| **Lineage**                | Open any `.sql` model, run "Show Lineage" command                                            |
| **Compiled SQL**           | Open a model, run "Show Compiled SQL"                                                        |
| **Autocomplete**           | Type `ref('` or `source('jaffle_shop', '` or `{{` in a model                                 |
| **Go-to-definition**       | Ctrl+click on `ref('stg_customers')` or `source(...)` or `cents_to_dollars`                  |
| **Hover**                  | Hover over column names in models with properties                                            |
| **Jump-to-properties**     | Open `customers.sql`, run "Toggle Properties"                                                |
| **Column sync**            | Modify columns in `customers.sql`, run "Sync Columns"                                        |
| **Model preview**          | Open a model, run "Preview Model"                                                            |
| **Defer**                  | Set `dbtCoreTools.deferManifestPath` to `{"jaffle_shop": "defer_manifest"}`, toggle defer on |
| **Stage external sources** | Open `_sources.yml`, run "Stage External Sources"                                            |

## Data

Seeds contain 5 rows each. Amounts are in cents — the `cents_to_dollars` macro converts them.
