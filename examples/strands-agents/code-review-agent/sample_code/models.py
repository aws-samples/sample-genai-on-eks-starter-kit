"""Data models for the e-commerce order service."""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional


class OrderStatus(Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    SHIPPED = "shipped"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"


class PaymentMethod(Enum):
    CREDIT_CARD = "credit_card"
    DEBIT_CARD = "debit_card"
    BANK_TRANSFER = "bank_transfer"


@dataclass
class Product:
    id: str
    name: str
    price: float
    stock: int
    category: str
    description: Optional[str] = None

    def is_available(self) -> bool:
        return self.stock > 0


@dataclass
class Customer:
    id: str
    name: str
    email: str
    address: str
    phone: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)

    def validate_email(self) -> bool:
        return "@" in self.email and "." in self.email


@dataclass
class OrderItem:
    product: Product
    quantity: int

    @property
    def subtotal(self) -> float:
        return self.product.price * self.quantity


@dataclass
class Order:
    id: str
    customer: Customer
    items: list[OrderItem] = field(default_factory=list)
    status: OrderStatus = OrderStatus.PENDING
    payment_method: Optional[PaymentMethod] = None
    created_at: datetime = field(default_factory=datetime.now)
    notes: Optional[str] = None

    @property
    def total(self) -> float:
        return sum(item.subtotal for item in self.items)
