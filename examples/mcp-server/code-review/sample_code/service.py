"""Business logic for the order service.

Contains order processing, validation, and inventory management.
"""

import uuid
import json
from datetime import datetime
from .models import Order, OrderItem, OrderStatus, Customer, Product
from .database import get_db


class OrderService:

    def create_order(self, customer_id: str, items: list[dict]) -> Order:
        with get_db() as conn:
            customer_row = conn.execute(
                "SELECT * FROM customers WHERE id = ?", (customer_id,)
            ).fetchone()
            if not customer_row:
                raise ValueError(f"Customer {customer_id} not found")

            customer = Customer(
                id=customer_row["id"],
                name=customer_row["name"],
                email=customer_row["email"],
                address=customer_row["address"],
            )

            order_items = []
            for item in items:
                product_row = conn.execute(
                    "SELECT * FROM products WHERE id = ?", (item["product_id"],)
                ).fetchone()
                if not product_row:
                    raise ValueError(f"Product {item['product_id']} not found")

                # BUG: no stock check before creating order
                product = Product(
                    id=product_row["id"],
                    name=product_row["name"],
                    price=product_row["price"],
                    stock=product_row["stock"],
                    category=product_row["category"],
                )
                order_items.append(OrderItem(product=product, quantity=item["quantity"]))

            order_id = str(uuid.uuid4())
            order = Order(id=order_id, customer=customer, items=order_items)

            conn.execute(
                "INSERT INTO orders (id, customer_id, status, items) VALUES (?, ?, ?, ?)",
                (order_id, customer_id, order.status.value, json.dumps(items)),
            )

            # BUG: stock should be decremented here but it's not
            return order

    def cancel_order(self, order_id: str) -> bool:
        with get_db() as conn:
            row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
            if not row:
                return False
            # BUG: allows cancelling already shipped/delivered orders
            conn.execute(
                "UPDATE orders SET status = ? WHERE id = ?",
                (OrderStatus.CANCELLED.value, order_id),
            )
            return True

    def get_order(self, order_id: str) -> dict | None:
        with get_db() as conn:
            row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
            if not row:
                return None
            return dict(row)

    def list_orders(self, customer_id: str = None, status: str = None) -> list[dict]:
        with get_db() as conn:
            query = "SELECT * FROM orders WHERE 1=1"
            params = []
            if customer_id:
                query += " AND customer_id = ?"
                params.append(customer_id)
            if status:
                query += " AND status = ?"
                params.append(status)
            rows = conn.execute(query, params).fetchall()
            return [dict(r) for r in rows]

    # CODE SMELL: this method does too many things
    def process_payment_and_ship(self, order_id, payment_method, tracking_number=None):
        with get_db() as conn:
            row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
            if not row:
                raise ValueError("Order not found")
            if row["status"] != "pending":
                raise ValueError("Order is not pending")
            conn.execute(
                "UPDATE orders SET status = ?, payment_method = ? WHERE id = ?",
                ("confirmed", payment_method, order_id),
            )
            # Immediately ship after payment (no separation of concerns)
            if tracking_number:
                conn.execute(
                    "UPDATE orders SET status = ? WHERE id = ?", ("shipped", order_id)
                )
            return True
