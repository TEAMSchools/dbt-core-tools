-- Singular test: fails if any order has a negative total
select
    order_id,
    total_amount
from {{ ref('orders') }}
where total_amount < 0
