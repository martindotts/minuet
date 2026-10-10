import unittest

from orders import build_order_notification


class BuildOrderNotificationTest(unittest.TestCase):
    def test_welcome_coupon(self):
        order = {
            "id": "A-1001",
            "customer": {"name": "Ana"},
            "coupon_code": "WELCOME",
            "items": [
                {"sku": "MUG", "quantity": 2, "unit_price": 40},
                {"sku": "TEE", "quantity": 1, "unit_price": 40},
            ],
        }
        notification = build_order_notification(order)
        self.assertEqual(
            notification["body"],
            "Hi Ana, your order of 2 items for $108.00 (you saved $12.00) is on its way.",
        )


if __name__ == "__main__":
    unittest.main()
