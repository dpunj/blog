---
title: Versa as Pudge
description: Mapping Dota's Butcher to outbound sales mechanics.
image: "https://docs.astro.build/default-og-image.png"
pubDate: "2025-01-15"
tags: ["versa", "gaming", "product", "dota", "wip"]
---

I've been thinking about Versa as Pudge from Dota. Specifically once I add the outbound campaign features that should turn into conversations that convert into sales—I see it as a parallel to using Pudge's Meat Hook to pull an enemy and eat it. Pretty nasty, but yeah, you get the idea.

## Pudge's Kit → Versa's Funnel

| Ability | Sales Parallel |
|---------|----------------|
| **Meat Hook** | Outbound campaigns—a skill shot into the void. Requires good aim (targeting/ICP). Can miss. Pulls them into *your* territory. |
| **Rot** | Nurture/engagement loop—once hooked, constant proximity damage. Multi-touch, keeps them slowed (not drifting to competitors). You take some damage too (cost of engagement). |
| **Flesh Heap** | Data flywheel—every interaction (even failed hooks) adds to your stack. More campaigns = more intelligence = more resilient. Passive gain. |
| **Dismember** | The close—locks them in, channels until complete. High damage (value extraction) + healing (revenue). Requires setup first, can't ult cold. |

## Conceptual Extensions

**Hook accuracy** as a real metric—what % of outbound actually pulls someone into a conversation? A Pudge with 80% hook accuracy is terrifying. So is a campaign with 80% reply rate.

**Positioning matters**—Pudge doesn't hook from base, he hides in trees near where enemies walk. Your campaigns need to be where prospects are (right channel, right timing, right context).

**The fog of war**—Prospects don't see the hook coming. Cold outbound works best when it doesn't feel like a sales missile.

**Blink + Hook combos**—Some setup makes the hook easier. Warm intros, content marketing, brand awareness = reducing the skill shot difficulty.

---

## The Pudge Feature Map

### MEAT HOOK — Campaign Launcher

**What it does:** Throws messages into the void, pulls prospects into conversations.

| Feature | Description |
|---------|-------------|
| **Hook Editor** | Craft outbound message templates. First message = the hook. Character limits, personalization tokens, A/B variants. |
| **Target Lists** | Import/build prospect lists. Phone numbers + metadata (name, segment, source). The "where you aim." |
| **Hook Scheduler** | Timing matters. Schedule hooks for optimal windows. Avoid spam patterns. |
| **Hook Analytics** | Reply rate, conversation started rate, time-to-reply. Your "hook accuracy %." |
| **Multi-Hook Sequences** | If first hook misses, follow-up hooks (drip sequences). Pudge can throw again. |

**Tool ideas:**
```
launch_campaign(list_id, template_id, schedule)
get_hook_accuracy(campaign_id) → reply_rate, open_rate
```

---

### ROT — Engagement Engine

**What it does:** Once hooked, keep them close. Continuous engagement that wears down resistance.

| Feature | Description |
|---------|-------------|
| **Conversation AI** | The existing Claude orchestration—but now triggered by hook success. Same tools (orders, appointments, enrollments) but for hooked prospects. |
| **Objection Handling** | Pre-loaded responses to common pushback. "Not interested" → rot through it. |
| **Multi-channel Rot** | WhatsApp + SMS + Email proximity damage. Surround them. |
| **Slow Effect** | Urgency injection. Limited offers, expiring discounts. Prevents them from drifting. |
| **Rot Radius** | Segment-based messaging. Different rot intensity for hot vs cold leads. |

**Tool ideas:**
```
escalate_engagement(conversation_id, intensity)
inject_urgency(conversation_id, offer_type, expiry)
```

---

### FLESH HEAP — Intelligence Accumulator

**What it does:** Every interaction (win or loss) makes the system stronger. Passive stacking.

| Feature | Description |
|---------|-------------|
| **Conversation Memory** | Already have Redis history. Expand to long-term vector storage (LanceDB). |
| **Pattern Learning** | What hooks work for what segments? Auto-optimize templates. |
| **Objection Library** | Every "no" gets cataloged. Build resistance over time. |
| **Win/Loss Tagging** | Tag conversations with outcomes. Train on what converts. |
| **Cross-Client Learning** | Anonymized patterns across merchants. Rising tide for all. |

**Tool ideas:**
```
log_outcome(conversation_id, outcome, tags)
get_segment_insights(segment_id) → best_hooks, common_objections
```

---

### DISMEMBER — Conversion Lock

**What it does:** The close. Lock them in, channel until complete, extract value while healing (revenue).

| Feature | Description |
|---------|-------------|
| **Checkout Channeling** | Existing `submit_order`, `submit_enrollment`, `submit_appointment`. The dismember. |
| **Abandon Recovery** | If they escape mid-dismember (cart abandon), re-hook them. |
| **Upsell During Channel** | While locked in checkout, add more damage (cross-sells). |
| **Payment Lock** | Multiple payment methods already built. Ensure they can't escape due to friction. |
| **Heal Tracking** | Revenue attribution back to campaign. Which hooks led to dismembers? |

**Tool ideas:**
```
recover_abandoned(conversation_id, incentive?)
attribute_conversion(order_id) → campaign_id, hook_template, time_to_convert
```

---

## New Tables/Models Needed

```
Campaign
├── id, name, client_id
├── hook_template (first message)
├── follow_up_sequences[]
├── target_list_id
├── schedule
└── status (draft, active, paused, completed)

Prospect
├── id, phone, name, metadata{}
├── segment, source
├── campaigns[] (many-to-many)
└── lifetime_value

ConversationOutcome
├── conversation_id
├── campaign_id (nullable - inbound has none)
├── outcome (converted, lost, pending)
├── revenue
└── tags[]
```

---

## The Full Combo

```
[Target List]
    → HOOK (campaign blast)
    → [Reply]
    → ROT (nurture conversation)
    → [Intent Signal]
    → DISMEMBER (checkout flow)
    → [Revenue]
    → FLESH HEAP (learnings stack)
    → [Better Hooks]
```

The Butcher doesn't just kill—he feeds. Every fight makes him harder to kill. That's the flywheel. That's Versa.
