import type { Category, Item } from './cart.ts';

export interface Coupon {
  percentOff: number;
  /** Spent on eligible items, not on the whole cart. */
  minSpend: number;
  excluded: Category[];
}

export const COUPONS: Record<string, Coupon> = {
  SAVE20: { percentOff: 20, minSpend: 100, excluded: ['gift-cards'] },
};

export function couponDiscount(coupon: Coupon, items: Item[]): { discount: number; reason?: string } {
  const eligible = items.filter((item) => !coupon.excluded.includes(item.category));
  const eligibleTotal = eligible.reduce((sum, item) => sum + item.price, 0);
  if (eligibleTotal < coupon.minSpend) {
    return { discount: 0, reason: `needs ${coupon.minSpend} on eligible items, has ${eligibleTotal}` };
  }
  return { discount: (eligibleTotal * coupon.percentOff) / 100 };
}
