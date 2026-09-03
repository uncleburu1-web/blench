import json

from channels.generic.websocket import AsyncWebsocketConsumer

from .events import shop_group_name


class ShopEventsConsumer(AsyncWebsocketConsumer):
    """One connection per logged-in browser tab / device, joined to its
    shop's broadcast group. Deliberately dumb: no state, no business
    logic, nothing persisted here. If this connection drops, nothing is
    lost — the next HTTP fetch (on reconnect, or on whatever the client
    already does) is what's actually correct; this only exists so that
    fetch doesn't have to wait for the user to hit refresh.
    """

    async def connect(self):
        shop = self.scope.get('shop')
        user = self.scope.get('user')
        if shop is None or user is None or not getattr(user, 'is_authenticated', False):
            await self.close(code=4001)
            return
        self.group_name = shop_group_name(shop.id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def shop_event(self, event):
        # group_send sends {'type': 'shop.event', ...} — Channels maps
        # 'shop.event' to this method name (dots -> underscores).
        await self.send(text_data=json.dumps({'event': event['event'], 'payload': event['payload']}))
