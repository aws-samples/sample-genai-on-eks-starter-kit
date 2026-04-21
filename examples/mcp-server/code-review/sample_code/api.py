"""FastAPI route handlers for the order service."""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from .service import OrderService
from .database import init_db

app = FastAPI(title="Order Service")
service = OrderService()


class CreateOrderRequest(BaseModel):
    customer_id: str
    items: list[dict]


class PaymentRequest(BaseModel):
    payment_method: str
    tracking_number: str | None = None


@app.on_event("startup")
def startup():
    init_db()


# ISSUE: no input validation on items structure
@app.post("/orders")
def create_order(request: CreateOrderRequest):
    try:
        order = service.create_order(request.customer_id, request.items)
        return {"order_id": order.id, "total": order.total, "status": order.status.value}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ISSUE: no authentication or authorization
@app.get("/orders/{order_id}")
def get_order(order_id: str):
    order = service.get_order(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@app.get("/orders")
def list_orders(customer_id: str = None, status: str = None):
    return service.list_orders(customer_id, status)


@app.post("/orders/{order_id}/cancel")
def cancel_order(order_id: str):
    if not service.cancel_order(order_id):
        raise HTTPException(status_code=404, detail="Order not found")
    return {"message": "Order cancelled"}


# ISSUE: no idempotency key for payment processing
@app.post("/orders/{order_id}/pay")
def process_payment(order_id: str, request: PaymentRequest):
    try:
        service.process_payment_and_ship(
            order_id, request.payment_method, request.tracking_number
        )
        return {"message": "Payment processed"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
