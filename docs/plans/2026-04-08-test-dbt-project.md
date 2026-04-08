# Test dbt Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a minimal Jaffle Shop dbt project at `test/fixtures/test_project/` that exercises every feature of the dbt-core-tools VS Code extension.

**Architecture:** A DuckDB-backed dbt project with seeds as the data source, a staging/marts layer pattern, sources, a snapshot, custom + package macros, generic + singular tests, properties with contracts, and a defer manifest. All features (lineage, compiled SQL, autocomplete, go-to-def, hover, column sync, preview, stage external sources, defer) are covered.

**Tech Stack:** dbt-core, dbt-duckdb, dbt-utils, dbt-external-tables, DuckDB

---

## File Structure

All files under `test/fixtures/test_project/`:

| File                               | Responsibility                                                       |
| ---------------------------------- | -------------------------------------------------------------------- |
| `dbt_project.yml`                  | Project config — name, profile, paths                                |
| `profiles.yml`                     | DuckDB connection config                                             |
| `packages.yml`                     | dbt-utils + dbt-external-tables deps                                 |
| `.gitignore`                       | Ignore `target/`, `dbt_packages/`, `logs/`, DuckDB files             |
| `defer_manifest/.gitkeep`          | Empty dir for defer manifest (generated at setup)                    |
| `seeds/raw_customers.csv`          | Customer seed data (5 rows)                                          |
| `seeds/raw_orders.csv`             | Order seed data (5 rows)                                             |
| `seeds/raw_payments.csv`           | Payment seed data (5 rows)                                           |
| `seeds/raw_reviews.csv`            | Review data for external source (not seeded, file-only)              |
| `models/staging/_sources.yml`      | Source definitions: jaffle_shop (3 tables) + external_data (1 table) |
| `models/staging/stg_customers.sql` | Staging model — source('jaffle_shop', 'raw_customers')               |
| `models/staging/stg_orders.sql`    | Staging model — source('jaffle_shop', 'raw_orders')                  |
| `models/staging/stg_payments.sql`  | Staging model — source('jaffle_shop', 'raw_payments')                |
| `models/marts/_models.yml`         | Properties: columns, descriptions, generic tests, contract           |
| `models/marts/customers.sql`       | Mart model — refs all 3 staging, uses cents_to_dollars macro         |
| `models/marts/orders.sql`          | Mart model — refs stg_orders + stg_payments, uses cents_to_dollars   |
| `snapshots/orders_snapshot.sql`    | SCD2 snapshot of stg_orders                                          |
| `tests/assert_positive_totals.sql` | Singular test on orders.total_amount                                 |
| `macros/cents_to_dollars.sql`      | Custom macro: divide by 100                                          |
| `README.md`                        | Setup instructions                                                   |

---

### Task 1: Project Config Files

**Files:**

- Create: `test/fixtures/test_project/dbt_project.yml`
- Create: `test/fixtures/test_project/profiles.yml`
- Create: `test/fixtures/test_project/packages.yml`
- Create: `test/fixtures/test_project/.gitignore`
- Create: `test/fixtures/test_project/defer_manifest/.gitkeep`

- [ ] **Step 1: Create dbt_project.yml**

```yaml
name: jaffle_shop
version: "1.0.0"
profile: jaffle_shop

clean-targets:
  - target
  - dbt_packages

snapshot-paths: ["snapshots"]
```

- [ ] **Step 2: Create profiles.yml**

```yaml
jaffle_shop:
  target: dev
  outputs:
    dev:
      type: duckdb
      path: target/jaffle_shop.duckdb
      schema: main
```

- [ ] **Step 3: Create packages.yml**

```yaml
packages:
  - package: dbt-labs/dbt_utils
    version: [">=1.0.0", "<2.0.0"]
  - package: dbt-labs/dbt_external_tables
    version: [">=0.9.0", "<1.0.0"]
```

- [ ] **Step 4: Create .gitignore**

```
target/
dbt_packages/
logs/
*.duckdb
*.duckdb.wal
defer_manifest/manifest.json
```

- [ ] **Step 5: Create defer_manifest/.gitkeep**

Empty file. This directory will hold a copy of `manifest.json` for defer testing.

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/test_project/dbt_project.yml test/fixtures/test_project/profiles.yml test/fixtures/test_project/packages.yml test/fixtures/test_project/.gitignore test/fixtures/test_project/defer_manifest/.gitkeep
git commit -m "feat: add test dbt project config files"
```

---

### Task 2: Seed Data

**Files:**

- Create: `test/fixtures/test_project/seeds/raw_customers.csv`
- Create: `test/fixtures/test_project/seeds/raw_orders.csv`
- Create: `test/fixtures/test_project/seeds/raw_payments.csv`
- Create: `test/fixtures/test_project/seeds/raw_reviews.csv`

- [ ] **Step 1: Create raw_customers.csv**

```csv
id,first_name,last_name
1,Alice,Smith
2,Bob,Jones
3,Carol,White
4,Dave,Brown
5,Eve,Davis
```

- [ ] **Step 2: Create raw_orders.csv**

```csv
id,customer_id,order_date,status
1,1,2024-01-01,completed
2,2,2024-01-02,completed
3,3,2024-01-03,returned
4,1,2024-01-04,completed
5,4,2024-01-05,pending
```

- [ ] **Step 3: Create raw_payments.csv**

```csv
id,order_id,amount,payment_method
1,1,1000,credit_card
2,2,2500,bank_transfer
3,3,500,credit_card
4,4,1500,coupon
5,5,3000,credit_card
```

- [ ] **Step 4: Create raw_reviews.csv**

This file is NOT loaded via `dbt seed` — it's a flat file for the external source (`dbt_external_tables`).

```csv
id,order_id,rating,review_text
1,1,5,Great product
2,2,4,Good value
3,3,2,Not as expected
```

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/test_project/seeds/
git commit -m "feat: add seed CSV files for test dbt project"
```

---

### Task 3: Custom Macro

**Files:**

- Create: `test/fixtures/test_project/macros/cents_to_dollars.sql`

- [ ] **Step 1: Create cents_to_dollars.sql**

```sql
{% macro cents_to_dollars(column_name) %}
    ({{ column_name }} / 100.0)
{% endmacro %}
```

- [ ] **Step 2: Commit**

```bash
git add test/fixtures/test_project/macros/cents_to_dollars.sql
git commit -m "feat: add cents_to_dollars custom macro"
```

---

### Task 4: Sources and Staging Models

**Files:**

- Create: `test/fixtures/test_project/models/staging/_sources.yml`
- Create: `test/fixtures/test_project/models/staging/stg_customers.sql`
- Create: `test/fixtures/test_project/models/staging/stg_orders.sql`
- Create: `test/fixtures/test_project/models/staging/stg_payments.sql`

- [ ] **Step 1: Create \_sources.yml**

Defines the `jaffle_shop` source (3 tables from seeds) with column metadata for hover, plus an `external_data` source for `stage_external_sources`.

```yaml
version: 2

sources:
  - name: jaffle_shop
    schema: main
    description: Raw jaffle shop data loaded from seeds
    tables:
      - name: raw_customers
        description: Raw customer data
        columns:
          - name: id
            description: Primary key
            data_type: integer
          - name: first_name
            description: Customer first name
            data_type: varchar
          - name: last_name
            description: Customer last name
            data_type: varchar

      - name: raw_orders
        description: Raw order data
        columns:
          - name: id
            description: Primary key
            data_type: integer
          - name: customer_id
            description: Foreign key to raw_customers
            data_type: integer
          - name: order_date
            description: Date the order was placed
            data_type: date
          - name: status
            description: "Order status: completed, returned, or pending"
            data_type: varchar

      - name: raw_payments
        description: Raw payment data (amounts in cents)
        columns:
          - name: id
            description: Primary key
            data_type: integer
          - name: order_id
            description: Foreign key to raw_orders
            data_type: integer
          - name: amount
            description: Payment amount in cents
            data_type: integer
          - name: payment_method
            description: "Payment method: credit_card, bank_transfer, or coupon"
            data_type: varchar

  - name: external_data
    schema: main
    description: External data sources for stage_external_sources testing
    tables:
      - name: raw_reviews
        description: Product reviews loaded from external CSV
        external:
          location: "seeds/raw_reviews.csv"
          file_format: csv
```

- [ ] **Step 2: Create stg_customers.sql**

```sql
select
    id as customer_id,
    first_name,
    last_name
from {{ source('jaffle_shop', 'raw_customers') }}
```

- [ ] **Step 3: Create stg_orders.sql**

```sql
select
    id as order_id,
    customer_id,
    order_date,
    status
from {{ source('jaffle_shop', 'raw_orders') }}
```

- [ ] **Step 4: Create stg_payments.sql**

```sql
select
    id as payment_id,
    order_id,
    amount,
    payment_method
from {{ source('jaffle_shop', 'raw_payments') }}
```

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/test_project/models/staging/
git commit -m "feat: add sources and staging models"
```

---

### Task 5: Mart Models and Properties

**Files:**

- Create: `test/fixtures/test_project/models/marts/customers.sql`
- Create: `test/fixtures/test_project/models/marts/orders.sql`
- Create: `test/fixtures/test_project/models/marts/_models.yml`

- [ ] **Step 1: Create customers.sql**

Joins all 3 staging models, uses `cents_to_dollars` macro, produces typed columns.

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
        orders.customer_id,
        count(orders.order_id) as order_count,
        sum({{ cents_to_dollars('payments.amount') }}) as total_amount
    from orders
    left join payments on orders.order_id = payments.order_id
    group by orders.customer_id
)

select
    customers.customer_id,
    customers.first_name,
    customers.last_name,
    coalesce(customer_orders.order_count, 0) as order_count,
    coalesce(customer_orders.total_amount, 0) as total_amount
from customers
left join customer_orders on customers.customer_id = customer_orders.customer_id
```

- [ ] **Step 2: Create orders.sql**

```sql
select
    stg_orders.order_id,
    stg_orders.customer_id,
    stg_orders.order_date,
    stg_orders.status,
    {{ cents_to_dollars('stg_payments.amount') }} as total_amount,
    stg_payments.payment_method
from {{ ref('stg_orders') }} as stg_orders
left join {{ ref('stg_payments') }} as stg_payments
    on stg_orders.order_id = stg_payments.order_id
```

- [ ] **Step 3: Create \_models.yml**

Properties with columns, descriptions, generic tests, and contract on `customers`.

```yaml
version: 2

models:
  - name: customers
    description: One row per customer with lifetime order summary
    config:
      contract:
        enforced: true
    columns:
      - name: customer_id
        description: Primary key — unique customer identifier
        data_type: integer
        tests:
          - unique
          - not_null
      - name: first_name
        description: Customer first name
        data_type: varchar
      - name: last_name
        description: Customer last name
        data_type: varchar
      - name: order_count
        description: Total number of orders placed by this customer
        data_type: integer
      - name: total_amount
        description: Lifetime spend in dollars
        data_type: double

  - name: orders
    description: One row per order with payment info
    columns:
      - name: order_id
        description: Primary key — unique order identifier
        data_type: integer
        tests:
          - unique
          - not_null
      - name: customer_id
        description: Foreign key to customers
        data_type: integer
        tests:
          - not_null
      - name: order_date
        description: Date the order was placed
        data_type: date
      - name: status
        description: "Order status: completed, returned, or pending"
        data_type: varchar
      - name: total_amount
        description: Order total in dollars
        data_type: double
      - name: payment_method
        description: "Payment method: credit_card, bank_transfer, or coupon"
        data_type: varchar
```

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/test_project/models/marts/
git commit -m "feat: add mart models with properties and contract"
```

---

### Task 6: Snapshot

**Files:**

- Create: `test/fixtures/test_project/snapshots/orders_snapshot.sql`

- [ ] **Step 1: Create orders_snapshot.sql**

```sql
{% snapshot orders_snapshot %}

{{
    config(
      target_schema='snapshots',
      unique_key='order_id',
      strategy='check',
      check_cols=['status']
    )
}}

select * from {{ ref('stg_orders') }}

{% endsnapshot %}
```

- [ ] **Step 2: Commit**

```bash
git add test/fixtures/test_project/snapshots/orders_snapshot.sql
git commit -m "feat: add orders snapshot for resource_type coverage"
```

---

### Task 7: Singular Test

**Files:**

- Create: `test/fixtures/test_project/tests/assert_positive_totals.sql`

- [ ] **Step 1: Create assert_positive_totals.sql**

```sql
-- Singular test: fails if any order has a negative total
select
    order_id,
    total_amount
from {{ ref('orders') }}
where total_amount < 0
```

- [ ] **Step 2: Commit**

```bash
git add test/fixtures/test_project/tests/assert_positive_totals.sql
git commit -m "feat: add singular test for lineage graph coverage"
```

---

### Task 8: README with Setup Instructions

**Files:**

- Create: `test/fixtures/test_project/README.md`

- [ ] **Step 1: Create README.md**

````markdown
# Test dbt Project (Jaffle Shop)

Minimal dbt project for testing the dbt-core-tools VS Code extension. Covers: lineage, compiled SQL, autocomplete, go-to-definition, hover, column sync, model preview, command runner, defer, and stage external sources.

## Prerequisites

- Python 3.9+
- `dbt-core` and `dbt-duckdb` installed (`pip install dbt-core dbt-duckdb`)

## Setup

```bash
cd test/fixtures/test_project

# Install dbt packages (dbt-utils, dbt-external-tables)
dbt deps

# Load seed data into DuckDB
dbt seed

# Build everything (run models, snapshots, tests)
dbt build

# Generate defer manifest (for defer toggle testing)
cp target/manifest.json defer_manifest/manifest.json
```
````

## Testing Extension Features

| Feature                    | How to Test                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| **Lineage**                | Open any `.sql` model, run "Show Lineage" command                                            |
| **Compiled SQL**           | Open a model, run "Show Compiled SQL"                                                        |
| **Autocomplete**           | Type `ref('` or `source('jaffle_shop', '` or `{{ ` in a model                                |
| **Go-to-definition**       | Ctrl+click on `ref('stg_customers')` or `source(...)` or `cents_to_dollars`                  |
| **Hover**                  | Hover over column names in models with properties                                            |
| **Jump-to-properties**     | Open `customers.sql`, run "Toggle Properties"                                                |
| **Column sync**            | Modify columns in `customers.sql`, run "Sync Columns"                                        |
| **Model preview**          | Open a model, run "Preview Model"                                                            |
| **Defer**                  | Set `dbtCoreTools.deferManifestPath` to `{"jaffle_shop": "defer_manifest"}`, toggle defer on |
| **Stage external sources** | Open `_sources.yml`, run "Stage External Sources"                                            |

## Data

Seeds contain 5 rows each. Amounts are in cents — the `cents_to_dollars` macro converts them.

````

- [ ] **Step 2: Commit**

```bash
git add test/fixtures/test_project/README.md
git commit -m "docs: add README with setup instructions for test project"
````

---

### Task 9: Verify the Project Builds

- [ ] **Step 1: Install Python dependencies (if needed)**

```bash
pip install dbt-core dbt-duckdb
```

Expected: successful install.

- [ ] **Step 2: Install dbt packages**

```bash
cd test/fixtures/test_project && dbt deps
```

Expected: `dbt_utils` and `dbt_external_tables` installed to `dbt_packages/`.

- [ ] **Step 3: Seed data**

```bash
cd test/fixtures/test_project && dbt seed
```

Expected: 3 seeds loaded (raw_customers, raw_orders, raw_payments), 5 rows each.

- [ ] **Step 4: Build everything**

```bash
cd test/fixtures/test_project && dbt build
```

Expected: all models run, snapshot created, all tests pass.

- [ ] **Step 5: Verify manifest has expected nodes**

```bash
cd test/fixtures/test_project && python3 -c "
import json
m = json.load(open('target/manifest.json'))
nodes = list(m['nodes'].keys())
sources = list(m['sources'].keys())
macros = [k for k in m['macros'].keys() if 'jaffle_shop' in k]
print(f'Nodes ({len(nodes)}):')
for n in sorted(nodes): print(f'  {n}')
print(f'Sources ({len(sources)}):')
for s in sorted(sources): print(f'  {s}')
print(f'Project macros ({len(macros)}):')
for m_name in sorted(macros): print(f'  {m_name}')
print(f'parent_map entries: {len(m.get(\"parent_map\", {}))}')
print(f'child_map entries: {len(m.get(\"child_map\", {}))}')
"
```

Expected: 5 models (3 staging + 2 marts), 1 snapshot, ~6 tests (4 generic + 1 singular + possibly schema tests), 3-4 sources, 1 project macro, populated parent_map and child_map.

- [ ] **Step 6: Create defer manifest**

```bash
cp test/fixtures/test_project/target/manifest.json test/fixtures/test_project/defer_manifest/manifest.json
```

- [ ] **Step 7: Verify compiled SQL exists**

```bash
cd test/fixtures/test_project && python3 -c "
import json
m = json.load(open('target/manifest.json'))
for k, v in m['nodes'].items():
    if v['resource_type'] == 'model':
        has_compiled = bool(v.get('compiled_code'))
        print(f'{k}: compiled={has_compiled}')
"
```

Expected: all models show `compiled=True` (since `dbt build` runs compile).

- [ ] **Step 8: Final commit if any adjustments were needed**

```bash
git add -A test/fixtures/test_project/
git commit -m "fix: adjustments from verification run"
```

Only if changes were needed. Skip if everything worked on first try.
