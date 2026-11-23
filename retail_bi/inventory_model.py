from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np
import pandas as pd


LOOKBACK = 28
SAFETY_DAYS = 3
SLOW_UNITS = 2
EXCESS_DAYS = 90
AGE_LIMITS = (30, 60, 90, 180)
BULK_MINIMUM = 72
BULK_MAX_DAILY_DEMAND = .4
HEALTH = ('Healthy', 'Replenishment attention', 'Non-moving', 'Slow-moving', 'Overstocked', 'Limited history')
MOVEMENT_SIGNS = {
    'opening_balance': 1, 'stock_receipt': 1, 'same_day_receipt': 1, 'fulfilled_sale': -1,
    'customer_return': 1, 'inventory_adjustment': 0, 'stock_transfer_in': 1,
    'stock_transfer_out': -1, 'damaged_stock': -1, 'shrinkage': -1,
}
LEDGER_FIELDS = ('opening', 'receipts', 'same_day', 'sold', 'returned', 'adjustment', 'damaged', 'shrinkage', 'closing')
LEAD_RANGES = {
    'Beauty': (3, 7), 'Apparel': (5, 12), 'Electronics': (8, 16),
    'Footwear': (6, 13), 'Home Goods': (5, 11), 'Accessories': (4, 9),
}


@dataclass
class Simulation:
    products: pd.DataFrame
    stores: pd.DataFrame
    source_daily: pd.DataFrame
    expected_daily: pd.DataFrame
    opening: pd.DataFrame
    lots: pd.DataFrame
    orders: pd.DataFrame


def simulate_inventory(pos: pd.DataFrame, seed: int) -> Simulation:
    """Simulate one network with a static catalog known at launch and a daily information cutoff."""
    products = (pos[['sku', 'item', 'price_point_name', 'category', 'unit_cost', 'unit_price']]
                .drop_duplicates().sort_values('sku').reset_index(drop=True))
    stores = pd.DataFrame({'location': sorted(pos['location'].unique())})
    rng = np.random.default_rng(seed)
    products['cost_cents'] = np.rint(products.pop('unit_cost') * 100).astype('int64')
    products['price_cents'] = np.rint(products.pop('unit_price') * 100).astype('int64')
    products['lead_days'] = [rng.integers(low, high + 1) for low, high in
                             (LEAD_RANGES.get(category, (4, 10)) for category in products['category'])]
    products['active'] = True
    start, end = pos['date'].min().normalize(), pos['date'].max().normalize()
    dates = pd.date_range(start, end)
    month_ends = {i for i, day in enumerate(dates) if day.is_month_end or day == dates[-1]}

    source = pos[['location', 'sku', 'date', 'event_type', 'qty']].copy()
    source['qty'] = source['qty'].astype('int64').abs()
    daily = source.groupby(['location', 'sku', 'date', 'event_type'])['qty'].agg(['sum', 'size'])
    daily = daily.unstack(fill_value=0).reindex(columns=pd.MultiIndex.from_product(
        [['sum', 'size'], ['Payment', 'Refund']]), fill_value=0)
    daily.columns = ['sold', 'returned', 'payment_lines', 'refund_lines']
    grid = pd.MultiIndex.from_product([stores['location'], products['sku'], dates], names=['location', 'sku', 'date'])
    totals = daily.reindex(grid, fill_value=0)
    sold_by_pair = totals['sold'].to_numpy().reshape(-1, len(dates))
    returned_by_pair = totals['returned'].to_numpy().reshape(-1, len(dates))
    values = np.zeros((len(sold_by_pair), len(dates), len(LEDGER_FIELDS)), dtype=np.int32)
    opening_records, lot_records, orders = [], [], []
    pairs = grid.droplevel('date').unique()
    costs = products.set_index('sku')['cost_cents'].to_dict()
    leads = products.set_index('sku')['lead_days'].to_dict()

    for index, (store, sku) in enumerate(pairs):
        pair_rng = np.random.default_rng(np.random.SeedSequence([seed, index, 1]))
        lead = leads[sku]
        initial = int(pair_rng.integers(5, 23))
        # A seeded minority begins with a legacy bulk buy, independently of future POS demand.
        if pair_rng.random() < .075:
            initial *= int(pair_rng.integers(4, 13))
        initial_age = int(pair_rng.integers(7, 105))
        opening_records.append((store, sku, start, start - pd.Timedelta(days=initial_age), initial, initial * costs[sku]))
        lots = deque([(-initial_age, 'opening_balance', initial)])
        scheduled_day, scheduled_qty = -1, 0
        stock, previous_demand = initial, 0
        review_day = int(pair_rng.integers(0, 7))
        variation = float(pair_rng.uniform(.85, 1.35))
        bulk_contract = pair_rng.random() < .08
        events = pair_rng.random((len(dates), 2))
        sales = sold_by_pair[index]
        for day, (sold, returned) in enumerate(zip(sales.tolist(), returned_by_pair[index].tolist(), strict=True)):
            opening = stock
            receipt = scheduled_qty if scheduled_day == day else 0
            if receipt:
                lots.append((day, 'stock_receipt', receipt))
                scheduled_qty = 0
            # The only same-day override is the observed payment requirement at fulfilment.
            # Returns arrive after fulfilment and do not finance the day's payments.
            emergency = max(0, sold - opening - receipt)
            if emergency:
                lots.append((day, 'same_day_receipt', emergency))
            if returned:
                lots.append((day, 'customer_return', returned))
            stock = opening + receipt + emergency + returned - sold
            adjustment = int(events[day, 0] < .003)
            if adjustment:
                lots.append((day, 'inventory_adjustment', adjustment))
            damaged = int(stock > 0 and .002 <= events[day, 1] < .004)
            shrinkage = int(stock > 0 and events[day, 1] < .002)
            stock += adjustment - damaged - shrinkage
            outflow = sold + damaged + shrinkage
            while outflow:
                received_on, origin, quantity = lots.popleft()
                allocated = min(quantity, outflow)
                outflow -= allocated
                if quantity > allocated:
                    lots.appendleft((received_on, origin, quantity - allocated))

            values[index, day] = (opening, receipt, emergency, sold, returned, adjustment, damaged, shrinkage, stock)
            if day in month_ends:
                lot_records.extend((store, sku, dates[day], start + pd.Timedelta(days=received_on), origin, quantity)
                                   for received_on, origin, quantity in lots)

            previous_demand += sold - (int(sales[day - LOOKBACK]) if day >= LOOKBACK else 0)
            history_days = min(day + 1, LOOKBACK)
            rate = previous_demand / history_days
            safety = max(1, (previous_demand * SAFETY_DAYS + history_days - 1) // history_days)
            reorder = (previous_demand * lead + history_days - 1) // history_days + safety
            if not scheduled_qty and rate > 0 and stock < reorder:
                # When possible, align replenishment to the store/SKU review weekday. An immediate
                # order is allowed when expected cover will not reach the next delivery opportunity.
                if day % 7 == review_day or stock * history_days < previous_demand * lead:
                    target = int(np.ceil(rate * max(lead + 7, 2 * lead + 3) * variation)) + safety
                    minimum = BULK_MINIMUM if bulk_contract and rate <= BULK_MAX_DAILY_DEMAND else 1
                    scheduled_qty = max(minimum, target - stock)
                    scheduled_day = day + lead
                    orders.append((store, sku, dates[day], dates[day] + pd.Timedelta(days=lead), scheduled_qty, minimum))

    return Simulation(
        products, stores, daily.reset_index(),
        pd.DataFrame(values.reshape(-1, len(LEDGER_FIELDS)), index=grid, columns=list(LEDGER_FIELDS)).reset_index(),
        pd.DataFrame(opening_records, columns=['location', 'sku', 'date', 'received_on', 'quantity', 'value_cents']),
        pd.DataFrame(lot_records, columns=['location', 'sku', 'date', 'received_on', 'origin', 'quantity'])
        .astype({'date': 'datetime64[ns]', 'received_on': 'datetime64[ns]', 'quantity': 'int64'}),
        pd.DataFrame(orders, columns=['location', 'sku', 'order_date', 'due_date', 'quantity', 'minimum_order_qty'])
        .astype({'order_date': 'datetime64[ns]', 'due_date': 'datetime64[ns]', 'quantity': 'int64', 'minimum_order_qty': 'int64'}),
    )
