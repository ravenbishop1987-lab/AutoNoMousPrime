"""
Autonomous Prime — Stripe Billing Service

Handles:
  - Customer create / retrieve
  - Checkout session creation (hosted payment page)
  - Subscription management (create, cancel, retrieve)
  - Webhook processing (subscription lifecycle + payment events)
  - Plan tier resolution from active subscription

Usage:
    svc = StripeService()

    # Create a checkout session for a new subscriber
    session = await svc.create_checkout_session(
        org_id="org_123",
        email="user@example.com",
        plan_tier="pro",
        success_url="https://app.example.com/dashboard?activated=1",
        cancel_url="https://app.example.com/pricing",
    )
    redirect_to(session.url)

    # Handle Stripe webhook (call from your web route)
    event = await svc.handle_webhook(raw_body, stripe_signature_header)

    # Check what plan an org is on
    tier = await svc.get_active_plan_tier(stripe_customer_id)
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Literal

import stripe
from loguru import logger

from .plans import PLANS, PlanTier, get_plan

# ---------------------------------------------------------------------------
# Stripe SDK initialisation
# ---------------------------------------------------------------------------
stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")
_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")

# Map plan tier → Stripe Price ID (set in .env or Stripe dashboard)
_PRICE_IDS: dict[PlanTier, str] = {
    "starter": PLANS["starter"].stripe_price_id,
    "pro":     PLANS["pro"].stripe_price_id,
    "agency":  PLANS["agency"].stripe_price_id,
}

# Reverse map: Stripe Price ID → plan tier
_PRICE_TO_TIER: dict[str, PlanTier] = {v: k for k, v in _PRICE_IDS.items()}


# ---------------------------------------------------------------------------
# Data containers
# ---------------------------------------------------------------------------

@dataclass
class CheckoutSession:
    session_id: str
    url: str
    customer_id: str | None
    plan_tier: PlanTier


@dataclass
class SubscriptionInfo:
    subscription_id: str
    customer_id: str
    plan_tier: PlanTier
    status: str                     # active | trialing | past_due | canceled | incomplete
    current_period_end: int         # Unix timestamp
    cancel_at_period_end: bool


@dataclass
class WebhookResult:
    event_type: str
    handled: bool
    org_id: str | None              # extracted from metadata when available
    subscription: SubscriptionInfo | None = None
    invoice_paid: bool = False
    invoice_amount: int = 0         # cents


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class StripeService:
    """Thin async-friendly wrapper around the Stripe Python SDK.

    All methods are synchronous under the hood (stripe SDK is sync) but
    wrapped to be safely callable from async contexts via run_in_executor
    if needed. For the current architecture (FastAPI + asyncio) this is
    acceptable — Stripe calls are fast and infrequent.
    """

    # ------------------------------------------------------------------
    # Customer management
    # ------------------------------------------------------------------

    def get_or_create_customer(self, org_id: str, email: str, name: str | None = None) -> str:
        """Return existing Stripe customer ID or create a new one.

        We tag customers with org_id in metadata so we can look them up
        without storing the customer_id server-side (though you should
        store it anyway for performance).
        """
        existing = stripe.Customer.search(
            query=f'metadata["org_id"]:"{org_id}"',
            limit=1,
        )
        if existing.data:
            customer_id = existing.data[0].id
            logger.debug(f"[Billing] Found existing customer {customer_id} for org {org_id}")
            return customer_id

        customer = stripe.Customer.create(
            email=email,
            name=name,
            metadata={"org_id": org_id},
        )
        logger.info(f"[Billing] Created Stripe customer {customer.id} for org {org_id}")
        return customer.id

    def get_customer(self, customer_id: str) -> dict[str, Any]:
        customer = stripe.Customer.retrieve(customer_id)
        return dict(customer)

    # ------------------------------------------------------------------
    # Checkout
    # ------------------------------------------------------------------

    def create_checkout_session(
        self,
        org_id: str,
        email: str,
        plan_tier: PlanTier,
        success_url: str,
        cancel_url: str,
        trial_days: int = 0,
    ) -> CheckoutSession:
        """Create a Stripe Checkout session for the given plan tier.

        Returns a CheckoutSession with a hosted URL to redirect the user to.
        """
        price_id = _PRICE_IDS.get(plan_tier)
        if not price_id or price_id.endswith("_placeholder"):
            raise ValueError(
                f"Stripe Price ID for plan '{plan_tier}' is not configured. "
                f"Set STRIPE_PRICE_ID_{plan_tier.upper()} in your .env file."
            )

        customer_id = self.get_or_create_customer(org_id, email)

        session_params: dict[str, Any] = {
            "customer": customer_id,
            "mode": "subscription",
            "line_items": [{"price": price_id, "quantity": 1}],
            "success_url": success_url,
            "cancel_url": cancel_url,
            "metadata": {"org_id": org_id, "plan_tier": plan_tier},
            "subscription_data": {
                "metadata": {"org_id": org_id, "plan_tier": plan_tier},
            },
            "allow_promotion_codes": True,
            "billing_address_collection": "auto",
        }

        if trial_days > 0:
            session_params["subscription_data"]["trial_period_days"] = trial_days

        session = stripe.checkout.Session.create(**session_params)
        logger.info(f"[Billing] Checkout session {session.id} created for org {org_id} → {plan_tier}")

        return CheckoutSession(
            session_id=session.id,
            url=session.url,
            customer_id=customer_id,
            plan_tier=plan_tier,
        )

    # ------------------------------------------------------------------
    # Subscription management
    # ------------------------------------------------------------------

    def get_active_subscription(self, customer_id: str) -> SubscriptionInfo | None:
        """Return the first active (or trialing) subscription for a customer."""
        subs = stripe.Subscription.list(
            customer=customer_id,
            status="all",
            limit=10,
            expand=["data.items.data.price"],
        )
        for sub in subs.auto_paging_iter():
            if sub.status in ("active", "trialing", "past_due"):
                return self._parse_subscription(sub)
        return None

    def get_active_plan_tier(self, customer_id: str) -> PlanTier:
        """Return the current plan tier for a Stripe customer. Defaults to 'starter'."""
        info = self.get_active_subscription(customer_id)
        return info.plan_tier if info else "starter"

    def cancel_subscription(self, subscription_id: str, at_period_end: bool = True) -> SubscriptionInfo:
        """Cancel a subscription. By default cancels at end of billing period."""
        if at_period_end:
            sub = stripe.Subscription.modify(
                subscription_id,
                cancel_at_period_end=True,
            )
        else:
            sub = stripe.Subscription.cancel(subscription_id)
        logger.info(f"[Billing] Subscription {subscription_id} cancellation scheduled (at_period_end={at_period_end})")
        return self._parse_subscription(sub)

    def change_plan(self, subscription_id: str, new_tier: PlanTier) -> SubscriptionInfo:
        """Upgrade or downgrade a subscription to a different plan tier.

        Stripe prorates by default — charge or credit applied immediately.
        """
        price_id = _PRICE_IDS.get(new_tier)
        if not price_id or price_id.endswith("_placeholder"):
            raise ValueError(f"Stripe Price ID for plan '{new_tier}' is not configured.")

        sub = stripe.Subscription.retrieve(subscription_id, expand=["items"])
        item_id = sub["items"]["data"][0]["id"]

        updated = stripe.Subscription.modify(
            subscription_id,
            items=[{"id": item_id, "price": price_id}],
            proration_behavior="create_prorations",
            metadata={"plan_tier": new_tier},
        )
        logger.info(f"[Billing] Subscription {subscription_id} changed to {new_tier}")
        return self._parse_subscription(updated)

    # ------------------------------------------------------------------
    # Webhook processing
    # ------------------------------------------------------------------

    def handle_webhook(self, raw_body: bytes, signature: str) -> WebhookResult:
        """Verify and process a Stripe webhook event.

        Call this from your FastAPI/Express route handler:

            @app.post("/webhooks/stripe")
            async def stripe_webhook(request: Request):
                body = await request.body()
                sig  = request.headers.get("stripe-signature", "")
                result = stripe_service.handle_webhook(body, sig)
                return {"ok": result.handled}

        Returns a WebhookResult describing what was processed.
        """
        try:
            event = stripe.Webhook.construct_event(
                payload=raw_body,
                sig_header=signature,
                secret=_WEBHOOK_SECRET,
            )
        except stripe.error.SignatureVerificationError as e:
            logger.error(f"[Billing] Webhook signature invalid: {e}")
            raise ValueError("Invalid Stripe webhook signature") from e

        event_type: str = event["type"]
        data_object = event["data"]["object"]
        org_id: str | None = None
        subscription_info: SubscriptionInfo | None = None
        invoice_paid = False
        invoice_amount = 0

        logger.info(f"[Billing] Webhook received: {event_type}")

        # --- Subscription lifecycle ---
        if event_type in (
            "customer.subscription.created",
            "customer.subscription.updated",
            "customer.subscription.deleted",
        ):
            sub = stripe.Subscription.retrieve(
                data_object["id"],
                expand=["items.data.price"],
            )
            subscription_info = self._parse_subscription(sub)
            org_id = sub.get("metadata", {}).get("org_id")

            if event_type == "customer.subscription.created":
                logger.success(f"[Billing] New subscription {sub.id} → {subscription_info.plan_tier} (org={org_id})")
            elif event_type == "customer.subscription.updated":
                logger.info(f"[Billing] Subscription {sub.id} updated → {subscription_info.plan_tier} status={subscription_info.status}")
            elif event_type == "customer.subscription.deleted":
                logger.warning(f"[Billing] Subscription {sub.id} deleted (org={org_id})")

        # --- Payment events ---
        elif event_type == "invoice.payment_succeeded":
            invoice_paid = True
            invoice_amount = data_object.get("amount_paid", 0)
            org_id = data_object.get("subscription_details", {}).get("metadata", {}).get("org_id")
            logger.success(f"[Billing] Invoice paid ${invoice_amount / 100:.2f} (org={org_id})")

        elif event_type == "invoice.payment_failed":
            org_id = data_object.get("subscription_details", {}).get("metadata", {}).get("org_id")
            logger.error(f"[Billing] Invoice payment FAILED (org={org_id}) — subscription may be past_due")

        # --- Checkout completed ---
        elif event_type == "checkout.session.completed":
            org_id = data_object.get("metadata", {}).get("org_id")
            plan_tier = data_object.get("metadata", {}).get("plan_tier", "starter")
            logger.success(f"[Billing] Checkout completed: org={org_id} plan={plan_tier}")

        handled = event_type in (
            "customer.subscription.created",
            "customer.subscription.updated",
            "customer.subscription.deleted",
            "invoice.payment_succeeded",
            "invoice.payment_failed",
            "checkout.session.completed",
        )

        return WebhookResult(
            event_type=event_type,
            handled=handled,
            org_id=org_id,
            subscription=subscription_info,
            invoice_paid=invoice_paid,
            invoice_amount=invoice_amount,
        )

    # ------------------------------------------------------------------
    # Portal (customer self-service)
    # ------------------------------------------------------------------

    def create_portal_session(self, customer_id: str, return_url: str) -> str:
        """Create a Stripe Customer Portal session URL.

        Users can manage their plan, payment method, and invoices themselves.
        Requires Customer Portal to be configured in the Stripe dashboard.
        """
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=return_url,
        )
        return session.url

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _parse_subscription(self, sub: Any) -> SubscriptionInfo:
        """Extract a clean SubscriptionInfo from a Stripe Subscription object."""
        price_id = None
        items = sub.get("items", {}).get("data", [])
        if items:
            price_obj = items[0].get("price", {})
            price_id = price_obj.get("id") if isinstance(price_obj, dict) else getattr(price_obj, "id", None)

        plan_tier: PlanTier = _PRICE_TO_TIER.get(price_id or "", "starter")

        return SubscriptionInfo(
            subscription_id=sub["id"],
            customer_id=sub["customer"] if isinstance(sub["customer"], str) else sub["customer"]["id"],
            plan_tier=plan_tier,
            status=sub["status"],
            current_period_end=sub.get("current_period_end", 0),
            cancel_at_period_end=sub.get("cancel_at_period_end", False),
        )

    # ------------------------------------------------------------------
    # Utility
    # ------------------------------------------------------------------

    @staticmethod
    def is_configured() -> bool:
        """True if Stripe API key and webhook secret are set."""
        key = os.getenv("STRIPE_SECRET_KEY", "")
        webhook = os.getenv("STRIPE_WEBHOOK_SECRET", "")
        return bool(key and not key.endswith("...") and webhook)

    @staticmethod
    def tier_from_price_id(price_id: str) -> PlanTier:
        """Resolve a Stripe price ID to a plan tier string."""
        return _PRICE_TO_TIER.get(price_id, "starter")
