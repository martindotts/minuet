import { type Item, subtotalOf } from './cart.ts';
import { COUPONS, couponDiscount } from './promotions.ts';
import { shippingFor } from './shipping.ts';

export interface Order {
  id: string;
  couponCode: string;
  items: Item[];
}

export function checkout(order: Order) {
  const subtotal = subtotalOf(order.items);
  const coupon = couponDiscount(COUPONS[order.couponCode], order.items);
  const shipping = shippingFor(subtotal);
  const total = subtotal - coupon.discount + shipping;
  return { subtotal, discount: coupon.discount, couponNote: coupon.reason, shipping, total };
}
