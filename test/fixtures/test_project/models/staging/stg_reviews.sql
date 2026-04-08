select
    id as review_id,
    order_id,
    rating,
    review_text
from {{ source('external_data', 'raw_reviews') }}
