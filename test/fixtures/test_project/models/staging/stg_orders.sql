select
    id as order_id,
    customer_id,
    order_date,
    status
from {{ source('jaffle_shop', 'raw_orders') }}
