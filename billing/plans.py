"""
Autonomous Prime — Plan definitions and limit enforcement

Plans:
  starter  $49/mo  — 1 brand, 30 pipeline runs/mo, blog + image only, 1 seat
  pro      $149/mo — 3 brands, 100 pipeline runs/mo, full pipeline (blog+image+audio+video),
                     comment auto-reply, autonomous mode, AI topics, 3 seats
  agency   $399/mo — 10 brands, unlimited runs, everything in Pro + named AI personas, 10 seats
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

PlanTier = Literal["starter", "pro", "agency"]


@dataclass(frozen=True)
class Plan:
    tier: PlanTier
    display_name: str
    price_monthly_usd: int          # cents omitted — whole dollars for display
    stripe_price_id: str            # set via STRIPE_PRICE_ID_* env vars or override at runtime

    # Limits  (-1 = unlimited)
    brands: int
    jobs_per_month: int
    voice_minutes_per_month: int
    video_jobs_per_month: int
    wp_sites: int
    team_seats: int

    # Feature flags
    image_gen: bool = True
    voice_gen: bool = False
    video_gen: bool = False
    full_pipeline: bool = False       # blog + image + audio + video in one run
    comment_auto_reply: bool = False  # auto-reply engine across all platforms
    autonomous_mode: bool = False     # disable approval gates
    ai_topics: bool = False           # AI-generated daily topics
    named_personas: bool = False      # per-brand named AI personas
    priority_queue: bool = False
    revenue_attribution: bool = False
    white_label: bool = False

    # Module access (controls which UI routes are enabled)
    modules: frozenset[str] = field(default_factory=frozenset)


import os

PLANS: dict[PlanTier, Plan] = {
    "starter": Plan(
        tier="starter",
        display_name="Starter",
        price_monthly_usd=49,
        stripe_price_id=os.getenv("STRIPE_PRICE_ID_STARTER", "price_starter_placeholder"),
        brands=1,
        jobs_per_month=30,
        voice_minutes_per_month=0,
        video_jobs_per_month=0,
        wp_sites=1,
        team_seats=1,
        image_gen=True,
        voice_gen=False,
        video_gen=False,
        full_pipeline=False,
        comment_auto_reply=False,
        autonomous_mode=False,
        ai_topics=False,
        named_personas=False,
        priority_queue=False,
        revenue_attribution=False,
        white_label=False,
        modules=frozenset({"queue", "calendar", "review", "revenue_basic", "integrations", "settings"}),
    ),
    "pro": Plan(
        tier="pro",
        display_name="Pro",
        price_monthly_usd=149,
        stripe_price_id=os.getenv("STRIPE_PRICE_ID_PRO", "price_pro_placeholder"),
        brands=3,
        jobs_per_month=100,
        voice_minutes_per_month=-1,
        video_jobs_per_month=-1,
        wp_sites=3,
        team_seats=3,
        image_gen=True,
        voice_gen=True,
        video_gen=True,
        full_pipeline=True,
        comment_auto_reply=True,
        autonomous_mode=True,
        ai_topics=True,
        named_personas=False,
        priority_queue=True,
        revenue_attribution=True,
        white_label=False,
        modules=frozenset({"queue", "calendar", "review", "revenue_full", "assets", "integrations", "settings"}),
    ),
    "agency": Plan(
        tier="agency",
        display_name="Agency",
        price_monthly_usd=399,
        stripe_price_id=os.getenv("STRIPE_PRICE_ID_AGENCY", "price_agency_placeholder"),
        brands=10,
        jobs_per_month=-1,
        voice_minutes_per_month=-1,
        video_jobs_per_month=-1,
        wp_sites=10,
        team_seats=10,
        image_gen=True,
        voice_gen=True,
        video_gen=True,
        full_pipeline=True,
        comment_auto_reply=True,
        autonomous_mode=True,
        ai_topics=True,
        named_personas=True,
        priority_queue=True,
        revenue_attribution=True,
        white_label=True,
        modules=frozenset({
            "queue", "calendar", "review", "revenue_full", "assets",
            "integrations", "settings", "white_label",
        }),
    ),
}


def get_plan(tier: str) -> Plan:
    """Return Plan for a given tier string. Defaults to starter if unknown."""
    return PLANS.get(tier, PLANS["starter"])  # type: ignore[arg-type]


def plan_allows(tier: str, feature: str) -> bool:
    """Check whether a plan tier enables a named feature or module.

    Usage:
        plan_allows("pro", "voice_gen")     → True
        plan_allows("starter", "video_gen") → False
        plan_allows("agency", "white_label")→ True
        plan_allows("pro", "revenue_full")  → True  (module check)
    """
    plan = get_plan(tier)
    # Check boolean flags first
    if hasattr(plan, feature):
        return bool(getattr(plan, feature))
    # Then check module set
    return feature in plan.modules


def jobs_remaining(tier: str, used: int) -> int:
    """Return jobs remaining this month. -1 means unlimited."""
    plan = get_plan(tier)
    if plan.jobs_per_month == -1:
        return -1
    return max(0, plan.jobs_per_month - used)


def within_brand_limit(tier: str, brand_count: int) -> bool:
    """True if the org can create another brand under this plan."""
    return brand_count < get_plan(tier).brands


def within_job_limit(tier: str, jobs_used_this_month: int) -> bool:
    """True if the org can submit another job this billing period."""
    plan = get_plan(tier)
    if plan.jobs_per_month == -1:
        return True
    return jobs_used_this_month < plan.jobs_per_month
