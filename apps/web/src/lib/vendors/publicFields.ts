/**
 * Column allow-lists for unauthenticated/customer-facing vendor reads.
 *
 * Keep private ownership, identity, verification-document, payout, commission,
 * and notification fields out of the query itself. Response redaction remains a
 * second line of defence, not the primary boundary.
 */
// These remain string literals so Supabase's query parser also type-checks the
// selected result shape at compile time.
export const PUBLIC_VENDOR_COLUMNS = "id,name,category,location,region,address,phone,description,price_range,price_min,price_max,rating,review_count,tags,style_tags,is_verified,status,business_hours,website,instagram,thumbnail_url,created_at,updated_at";

export const PUBLIC_VENDOR_PRODUCT_COLUMNS = "id,vendor_id,name,description,price,discount_price,original_price,duration,duration_minutes,is_active,is_popular,sort_order,category_fields,includes,excludes,images,created_at,updated_at";

export const PUBLIC_VENDOR_REVIEW_COLUMNS = "id,rating,content,images,reply,replied_at,created_at";

export const PUBLIC_VENDOR_TIMESLOT_COLUMNS = "id,vendor_id,day,hour,available,max_bookings";

export const PUBLIC_PRODUCT_TIMESLOT_COLUMNS = "id,product_id,day,hour,available,max_bookings";
