## Starting point

The test `test/orders.test.js` calls `buildOrderNotification` with an order of **2 products** and the coupon `WELCOME`.

We want to see, with real values, where each part of the text comes from:

- the subtotal per line,
- the coupon discount,
- the amount formatting,
- how the final `body` is assembled.
