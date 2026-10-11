'use strict';

const DISCOUNTS = {
  WELCOME: 0.1,
  VIP: 0.25,
};

function calculateSubtotal(items) {
  const lines = items.map((item) => ({
    sku: item.sku,
    quantity: item.quantity,
    total: item.unitPrice * item.quantity,
  }));
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
  return { lines, subtotal };
}

function applyDiscount(subtotal, couponCode) {
  const rate = DISCOUNTS[couponCode] ?? 0;
  const discount = Math.round(subtotal * rate);
  return { rate, discount, total: subtotal - discount };
}

function formatAmount(amount, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

function buildOrderNotification(order) {
  const { lines, subtotal } = calculateSubtotal(order.items);
  const pricing = applyDiscount(subtotal, order.couponCode);
  const amountText = formatAmount(pricing.total, order.currency);
  const discountText =
    pricing.discount > 0 ? ` (you saved ${formatAmount(pricing.discount, order.currency)})` : '';
  return {
    title: `Order ${order.id} confirmed`,
    body: `Hi ${order.customer.name}, your order of ${lines.length} items for ${amountText}${discountText} is on its way.`,
  };
}

module.exports = { calculateSubtotal, applyDiscount, formatAmount, buildOrderNotification };
