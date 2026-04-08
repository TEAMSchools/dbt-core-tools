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
