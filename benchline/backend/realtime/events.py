"""
The entire real-time layer in one idea: broadcast() is called AFTER data
is already safely committed to Postgres (by whatever HTTP view or sync
handler just did it) — it just nudges anyone connected to go look. If
nobody's listening, if the channel layer is down, if this call silently
no-ops for any reason, NOTHING is lost, because nothing here is data.

This is the CAP-theorem-aware design the architecture asks for: the
desktop (and every HTTP endpoint) stays available even when this layer
is completely unreachable — a network partition here degrades to "no
live updates," never to "can't sell" or "lost a sale." Consistency
between clients is eventual, driven by the same durable HTTP fetch every
page already does — this just makes "eventual" happen in under a second
instead of whenever someone next hits refresh.
"""
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def shop_group_name(shop_id):
    return f'shop_{shop_id}'


def broadcast(shop, event_type, payload):
    """event_type examples: 'sale.created', 'product.updated',
    'product.created', 'customer.updated'. `payload` should be small and
    JSON-safe — a hint for the UI (e.g. which product changed), not a
    full authoritative record; the client re-fetches for the real data."""
    layer = get_channel_layer()
    if layer is None:
        return
    async_to_sync(layer.group_send)(
        shop_group_name(shop.id),
        {'type': 'shop.event', 'event': event_type, 'payload': payload},
    )
