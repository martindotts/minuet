'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildOrderNotification } = require('../src/orders');

test('builds the notification of an order with a coupon', () => {
  const order = {
    id: 'A-1001',
    currency: 'USD',
    couponCode: 'WELCOME',
    customer: { name: 'Ana', email: 'ana@example.com' },
    items: [
      { sku: 'COFFEE-250', unitPrice: 45, quantity: 2 },
      { sku: 'MUG-01', unitPrice: 30, quantity: 1 },
    ],
  };

  const notification = buildOrderNotification(order);

  assert.equal(notification.title, 'Order A-1001 confirmed');
  assert.equal(notification.body, 'Hi Ana, your order of 2 items for $108.00 (you saved $12.00) is on its way.');
});
