import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkout } from '../src/checkout.ts';

test('checkout of a cart with a coupon', () => {
  const receipt = checkout({
    id: 'A-1042',
    couponCode: 'SAVE20',
    items: [
      { name: 'Headphones', category: 'electronics', price: 120 },
      { name: 'Gift card', category: 'gift-cards', price: 50 },
    ],
  });

  assert.equal(receipt.subtotal, 170);
  assert.equal(receipt.discount, 24);
  assert.equal(receipt.shipping, 0);
  assert.equal(receipt.total, 146);
});
