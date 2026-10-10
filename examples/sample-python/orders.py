DISCOUNTS = {
    "WELCOME": 0.1,
    "VIP": 0.25,
}


def calculate_subtotal(items):
    lines = [
        {"sku": item["sku"], "quantity": item["quantity"], "total": item["unit_price"] * item["quantity"]}
        for item in items
    ]
    subtotal = sum(line["total"] for line in lines)
    return lines, subtotal


def apply_discount(subtotal, coupon_code):
    rate = DISCOUNTS.get(coupon_code, 0)
    discount = round(subtotal * rate)
    return rate, discount, subtotal - discount


def format_amount(amount):
    return f"${amount:,.2f}"


def build_order_notification(order):
    lines, subtotal = calculate_subtotal(order["items"])
    rate, discount, total = apply_discount(subtotal, order.get("coupon_code"))
    amount_text = format_amount(total)
    discount_text = f" (you saved {format_amount(discount)})" if discount > 0 else ""
    return {
        "title": f"Order {order['id']} confirmed",
        "body": f"Hi {order['customer']['name']}, your order of {len(lines)} items for {amount_text}{discount_text} is on its way.",
    }
