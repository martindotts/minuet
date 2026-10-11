export const FREE_SHIPPING_FROM = 100;
export const SHIPPING_COST = 8;

/** Free shipping looks at the whole cart: every item counts, gift cards included. */
export function shippingFor(subtotal: number): number {
  if (subtotal >= FREE_SHIPPING_FROM) {
    return 0;
  }
  return SHIPPING_COST;
}
