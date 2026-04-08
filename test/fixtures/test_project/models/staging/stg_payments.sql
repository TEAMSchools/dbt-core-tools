select
    id as payment_id,
    order_id,
    amount,
    payment_method
from {{ source('jaffle_shop', 'raw_payments') }}
