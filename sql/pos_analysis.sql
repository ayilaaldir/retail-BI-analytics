CREATE OR REPLACE VIEW kpi_summary AS
SELECT
    ROUND(SUM(net_sales), 2) AS net_sales,
    ROUND(SUM(gross_profit), 2) AS gross_profit,
    SUM(gross_profit) / NULLIF(SUM(net_sales), 0) AS gross_margin,
    COUNT(DISTINCT transaction_id) AS transactions,
    SUM(net_sales) / NULLIF(COUNT(DISTINCT transaction_id), 0) AS average_ticket,
    SUM(qty) AS items_net
FROM retail;

CREATE OR REPLACE VIEW monthly_performance AS
SELECT
    strftime(date, '%Y-%m') AS month,
    ROUND(SUM(net_sales), 2) AS net_sales,
    ROUND(SUM(gross_profit), 2) AS gross_profit,
    SUM(gross_profit) / NULLIF(SUM(net_sales), 0) AS gross_margin,
    COUNT(DISTINCT transaction_id) AS transactions
FROM retail
GROUP BY 1;

CREATE OR REPLACE VIEW category_performance AS
SELECT
    category,
    ROUND(SUM(net_sales), 2) AS net_sales,
    ROUND(SUM(gross_profit), 2) AS gross_profit,
    SUM(gross_profit) / NULLIF(SUM(net_sales), 0) AS gross_margin,
    COUNT(DISTINCT transaction_id) AS transactions
FROM retail
GROUP BY 1;

CREATE OR REPLACE VIEW location_performance AS
SELECT
    location,
    ROUND(SUM(net_sales), 2) AS net_sales,
    ROUND(SUM(gross_profit), 2) AS gross_profit,
    SUM(gross_profit) / NULLIF(SUM(net_sales), 0) AS gross_margin,
    COUNT(DISTINCT transaction_id) AS transactions
FROM retail
GROUP BY 1;

CREATE OR REPLACE VIEW discount_effectiveness AS
SELECT
    CASE
        WHEN discounts = 0 THEN 'No discount'
        WHEN -discounts / NULLIF(gross_sales, 0) <= 0.10 THEN '1–10%'
        WHEN -discounts / NULLIF(gross_sales, 0) <= 0.20 THEN '11–20%'
        ELSE 'Above 20%'
    END AS discount_band,
    ROUND(SUM(net_sales), 2) AS net_sales,
    ROUND(SUM(gross_profit), 2) AS gross_profit,
    SUM(gross_profit) / NULLIF(SUM(net_sales), 0) AS gross_margin,
    COUNT(DISTINCT transaction_id) AS transactions
FROM retail
WHERE event_type = 'Payment'
GROUP BY 1;

CREATE OR REPLACE VIEW refund_summary AS
SELECT
    category,
    COUNT(DISTINCT transaction_id) AS refund_transactions,
    ROUND(SUM(net_sales), 2) AS refund_net_sales,
    ROUND(SUM(gross_profit), 2) AS refund_gross_profit
FROM retail
WHERE event_type = 'Refund'
GROUP BY 1;
