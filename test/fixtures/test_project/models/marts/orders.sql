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
