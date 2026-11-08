CREATE OR REPLACE VIEW kpi_summary AS
SELECT
    ROUND(SUM(sales), 2) AS sales,
    ROUND(SUM(profit), 2) AS profit,
    SUM(profit) / NULLIF(SUM(sales), 0) AS margin,
    COUNT(DISTINCT order_id) AS orders,
    SUM(sales) / NULLIF(COUNT(DISTINCT order_id), 0) AS average_order_value
FROM retail;

CREATE OR REPLACE VIEW monthly_performance AS
SELECT
    strftime(order_date, '%Y-%m') AS month,
    ROUND(SUM(sales), 2) AS sales,
    ROUND(SUM(profit), 2) AS profit,
    SUM(profit) / NULLIF(SUM(sales), 0) AS margin,
    COUNT(DISTINCT order_id) AS orders
FROM retail
GROUP BY 1;

CREATE OR REPLACE VIEW category_performance AS
SELECT
    category,
    ROUND(SUM(sales), 2) AS sales,
    ROUND(SUM(profit), 2) AS profit,
    SUM(profit) / NULLIF(SUM(sales), 0) AS margin,
    COUNT(DISTINCT order_id) AS orders
FROM retail
GROUP BY 1;

CREATE OR REPLACE VIEW state_performance AS
SELECT
    state,
    ROUND(SUM(sales), 2) AS sales,
    ROUND(SUM(profit), 2) AS profit,
    SUM(profit) / NULLIF(SUM(sales), 0) AS margin,
    COUNT(DISTINCT order_id) AS orders
FROM retail
GROUP BY 1;

CREATE OR REPLACE VIEW discount_effectiveness AS
SELECT
    CASE
        WHEN discount = 0 THEN 'No discount'
        WHEN discount <= 0.20 THEN '0–20%'
        WHEN discount <= 0.40 THEN '21–40%'
        ELSE 'Above 40%'
    END AS discount_band,
    ROUND(SUM(sales), 2) AS sales,
    ROUND(SUM(profit), 2) AS profit,
    SUM(profit) / NULLIF(SUM(sales), 0) AS margin,
    COUNT(*) AS line_items
FROM retail
GROUP BY 1;

CREATE OR REPLACE VIEW loss_drivers AS
SELECT category, sub_category, region,
       ROUND(SUM(sales), 2) AS sales,
       ROUND(SUM(profit), 2) AS profit,
       SUM(profit) / NULLIF(SUM(sales), 0) AS margin
FROM retail
GROUP BY 1, 2, 3
HAVING SUM(profit) < 0;
