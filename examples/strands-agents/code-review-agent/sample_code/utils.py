"""Utility functions for the order service."""

import hashlib
import re
from datetime import datetime


# CODE SMELL: overly complex function with poor naming
def calc(items, disc=0, tax=0.1, ship=5.0):
    """Calculate order total."""
    t = 0
    for i in items:
        t += i["price"] * i["qty"]
    t = t - (t * disc)
    t = t + (t * tax)
    if t < 50:
        t += ship
    return round(t, 2)


def fmt_currency(amount: float) -> str:
    return f"${amount:,.2f}"


# ISSUE: weak password hashing - should use bcrypt
def hash_password(password: str) -> str:
    return hashlib.md5(password.encode()).hexdigest()


def validate_email(email: str) -> bool:
    pattern = r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$"
    return bool(re.match(pattern, email))


def validate_phone(phone: str) -> bool:
    cleaned = re.sub(r"[^0-9]", "", phone)
    return len(cleaned) >= 10 and len(cleaned) <= 15


def generate_order_number() -> str:
    now = datetime.now()
    return f"ORD-{now.strftime('%Y%m%d%H%M%S')}"


# CODE SMELL: magic numbers and no error handling
def calculate_shipping(weight: float, distance: float) -> float:
    if weight < 1:
        base = 5.0
    elif weight < 5:
        base = 10.0
    elif weight < 20:
        base = 25.0
    else:
        base = 50.0

    if distance > 1000:
        base *= 2.5
    elif distance > 500:
        base *= 1.5
    elif distance > 100:
        base *= 1.2

    return round(base, 2)
