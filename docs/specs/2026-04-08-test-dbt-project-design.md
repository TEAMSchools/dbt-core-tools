# Test dbt Project Design

A minimal Jaffle Shop-style dbt project at `test/fixtures/test_project/` that exercises every feature of the dbt-core-tools VS Code extension.

## Project Structure

```text
test/fixtures/test_project/
├── dbt_project.yml
├── profiles.yml
├── packages.yml
├── defer_manifest/              # pre-built manifest for defer testing
│   └── manifest.json
├── seeds/
│   ├── raw_customers.csv        # 5 rows: id, first_name, last_name
│   ├── raw_orders.csv           # 5 rows: id, customer_id, order_date, status
│   └── raw_payments.csv         # 5 rows: id, order_id, amount, payment_method
├── models/
│   ├── staging/
│   │   ├── _sources.yml         # source defs for jaffle_shop + external source
│   │   ├── stg_customers.sql    # SELECT from source('jaffle_shop', 'raw_customers')
│   │   ├── stg_orders.sql       # SELECT from source('jaffle_shop', 'raw_orders')
│   │   └── stg_payments.sql     # SELECT from source('jaffle_shop', 'raw_payments')
│   └── marts/
│       ├── _models.yml          # properties, columns, descriptions, generic tests, contract
│       ├── customers.sql        # ref() to all 3 staging + cents_to_dollars macro
│       └── orders.sql           # ref() to stg_orders + stg_payments + cents_to_dollars
├── snapshots/
│   └── orders_snapshot.sql      # snapshot of stg_orders for resource_type coverage
├── tests/
│   └── assert_positive_totals.sql  # singular test on orders.total_amount
└── macros/
    └── cents_to_dollars.sql     # custom macro: {{ cents_to_dollars(column) }}
```

## Adapter

DuckDB. Zero infrastructure. Database file at `target/jaffle_shop.duckdb` (gitignored).

`profiles.yml`:

```yaml
jaffle_shop:
  target: dev
  outputs:
    dev:
      type: duckdb
      path: target/jaffle_shop.duckdb
      schema: main
```

## Package Dependencies

`packages.yml`:

```yaml
packages:
  - package: dbt-labs/dbt_utils
    version: [">=1.0.0", "<2.0.0"]
  - package: dbt-labs/dbt_external_tables
    version: [">=0.9.0", "<1.0.0"]
```

- `dbt-utils`: exercises package macro completion, go-to-definition (resolves via `dbt_packages/dbt_utils/`), and provides useful macros like `generate_surrogate_key`
- `dbt_external_tables`: provides `stage_external_sources` macro for the stage external sources command

## Data

Seeds are the data source. 5 rows each, enough to be queryable via `dbt show`.

### raw_customers.csv

```csv
id,first_name,last_name
1,Alice,Smith
2,Bob,Jones
3,Carol,White
4,Dave,Brown
5,Eve,Davis
```

### raw_orders.csv

```csv
id,customer_id,order_date,status
1,1,2024-01-01,completed
2,2,2024-01-02,completed
3,3,2024-01-03,returned
4,1,2024-01-04,completed
5,4,2024-01-05,pending
```

### raw_payments.csv

```csv
id,order_id,amount,payment_method
1,1,1000,credit_card
2,2,2500,bank_transfer
3,3,500,credit_card
4,4,1500,coupon
5,5,3000,credit_card
```

Amounts are in cents (integer). The `cents_to_dollars` macro divides by 100.

## Sources

`_sources.yml` defines:

1. **`jaffle_shop`** source with 3 tables (`raw_customers`, `raw_orders`, `raw_payments`) — these point at the seeded tables. Column metadata included for hover/completion.

2. **An external source** for `stage_external_sources` testing. DuckDB supports `read_csv_auto()`, so the external source points at a local CSV. The source definition includes `external: location` metadata that `dbt_external_tables` uses:

```yaml
- name: external_data
  tables:
    - name: raw_reviews
      external:
        location: "seeds/raw_reviews.csv"
        file_format: csv
```

A corresponding `seeds/raw_reviews.csv` (not loaded via `dbt seed` — just a file on disk) provides the backing data. Note: `dbt_external_tables` DuckDB support may require adapter-specific configuration; if incompatible at setup time, this source can be dropped without affecting other features.

## Models

### Staging (3 models)

Thin transforms with `source()` calls. Each selects all columns with clean aliases.

```sql
-- stg_customers.sql
select
    id as customer_id,
    first_name,
    last_name
from {{ source('jaffle_shop', 'raw_customers') }}
```

Similar pattern for `stg_orders` and `stg_payments`.

### Marts (2 models)

**`customers.sql`** — joins all 3 staging models. Uses `ref()` (autocomplete/go-to-def), `cents_to_dollars` macro (custom macro resolution), and produces typed columns (hover/column sync).

```sql
with customers as (
    select * from {{ ref('stg_customers') }}
),
orders as (
    select * from {{ ref('stg_orders') }}
),
payments as (
    select * from {{ ref('stg_payments') }}
),
customer_orders as (
    select
        customer_id,
        count(*) as order_count,
        sum({{ cents_to_dollars('amount') }}) as total_amount
    from orders
    left join payments on orders.order_id = payments.order_id
    group by customer_id
)
select
    customers.customer_id,
    customers.first_name,
    customers.last_name,
    coalesce(customer_orders.order_count, 0) as order_count,
    coalesce(customer_orders.total_amount, 0) as total_amount
from customers
left join customer_orders using (customer_id)
```

**`orders.sql`** — joins `stg_orders` + `stg_payments`, uses `cents_to_dollars`.

### Properties (`_models.yml`)

Defines properties for `customers` and `orders`:

- Column names, types, descriptions (exercises hover)
- Generic tests: `not_null` and `unique` on primary keys (exercises lineage test counts)
- `contract: { enforced: true }` on `customers` (exercises column sync contract path)

## Snapshot

`orders_snapshot.sql` — SCD Type 2 snapshot of `stg_orders`:

```sql
{% snapshot orders_snapshot %}
{{
    config(
      target_schema='snapshots',
      unique_key='order_id',
      strategy='check',
      check_cols=['status'],
    )
}}
select * from {{ ref('stg_orders') }}
{% endsnapshot %}
```

Exercises the `snapshot.*` resource type in lineage and completion.

## Singular Test

`assert_positive_totals.sql`:

```sql
select order_id, total_amount
from {{ ref('orders') }}
where total_amount < 0
```

Returns rows where the assertion fails. Exercises singular tests in lineage graph.

## Custom Macro

`cents_to_dollars.sql`:

```sql
{% macro cents_to_dollars(column_name) %}
    ({{ column_name }} / 100.0)
{% endmacro %}
```

Exercises: macro completion, go-to-definition for project macros.

## Defer Setup

`defer_manifest/manifest.json` — a copy of a previously generated manifest. Created during initial setup by copying `target/manifest.json` after a full `dbt build`. The extension uses this as the `--state` path when defer is toggled on.

This is not committed as a static file — it's generated during setup and gitignored. The directory has a `.gitkeep` so it exists in the repo. The README documents the setup step.

## dbt_project.yml

```yaml
name: jaffle_shop
version: "1.0.0"
profile: jaffle_shop # matches profiles.yml key

clean-targets:
  - target
  - dbt_packages

snapshot-paths: ["snapshots"]
```

## Feature Coverage Matrix

| Extension Feature             | Project Element                       | How It's Exercised                                                                      |
| ----------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- |
| **Lineage viewer**            | All models + sources + snapshot       | 3-hop graph (sources → staging → marts), snapshot branch, test counts                   |
| **Compiled SQL viewer**       | Any model after `dbt compile`         | Jinja `ref()`/`source()`/macro calls resolved to SQL                                    |
| **Jump-to-properties**        | `_models.yml` ↔ mart `.sql` files     | Toggle between `customers.sql` and its `_models.yml` entry                              |
| **Column sync**               | `customers` model + `_models.yml`     | Columns with descriptions; `contract.enforced` triggers warning                         |
| **Autocomplete (ref)**        | 5 models + 1 snapshot                 | `ref('stg_...')`, `ref('customers')`, `ref('orders')`                                   |
| **Autocomplete (source)**     | `jaffle_shop` source, 3 tables        | `source('jaffle_shop', '...')` completes table names                                    |
| **Autocomplete (macro)**      | `cents_to_dollars` + dbt-utils        | Custom + package macros in `{{ }}` completion                                           |
| **Go-to-definition (model)**  | `ref()` calls in marts                | Ctrl+click → opens staging `.sql`                                                       |
| **Go-to-definition (source)** | `source()` calls in staging           | Ctrl+click → opens `_sources.yml`                                                       |
| **Go-to-definition (macro)**  | `cents_to_dollars` + dbt-utils macros | Project macro → `macros/`, package macro → `dbt_packages/`                              |
| **Hover (columns)**           | `customers` + source columns          | Shows `data_type`, `description` on hover                                               |
| **Model preview**             | Any model                             | `dbt show --select customers` against DuckDB                                            |
| **Command runner**            | Whole project                         | `dbt run`, `dbt build`, `dbt test`, `dbt parse`, `dbt compile`, `dbt clean`, `dbt deps` |
| **Generic tests**             | `_models.yml` tests                   | `not_null`, `unique` — show as test counts on lineage nodes                             |
| **Singular tests**            | `assert_positive_totals.sql`          | Appears in lineage graph as test node                                                   |
| **Seeds**                     | 3 CSV files                           | `dbt seed` populates DuckDB; sources reference seeded tables                            |
| **Snapshots**                 | `orders_snapshot.sql`                 | `snapshot.*` resource type in lineage, completion                                       |
| **Parse-on-save**             | Any `.sql` edit                       | Triggers automatic `dbt parse`                                                          |
| **Defer**                     | `defer_manifest/manifest.json`        | Toggle defer on, commands get `--defer --state` flags                                   |
| **Stage external sources**    | External source in `_sources.yml`     | `dbt run-operation stage_external_sources` via command                                  |
| **Package macro resolution**  | `dbt-utils` dependency                | `original_file_path` resolved via `dbt_packages/dbt_utils/`                             |

## Setup Instructions (for README)

```bash
cd test/fixtures/test_project

# Install Python deps (if not already)
pip install dbt-core dbt-duckdb

# Install dbt packages
dbt deps

# Seed data and build everything
dbt build

# Copy manifest for defer testing
cp target/manifest.json defer_manifest/manifest.json
```

After setup, open the `test/fixtures/test_project` folder (or its parent) in VS Code with the dbt-core-tools extension installed.

## What's NOT Covered

| Gap                            | Reason                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------- |
| Multi-project workspace        | Config variation, not project structure — would need a second `dbt_project.yml` |
| `propertiesLocation: "inline"` | VS Code setting toggle, not a project concern                                   |
| Deep subdirectory nesting      | Edge case for path resolution; 2 levels (`staging/`, `marts/`) is sufficient    |
