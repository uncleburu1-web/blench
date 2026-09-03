"""
Channels has no equivalent of REST_FRAMEWORK's JWTAuthentication for the
WebSocket handshake, so this is that: reads the same access token the
REST API already uses, resolves the user the same way SimpleJWT does.

The token travels as ?token=... in the URL, not an Authorization header
-- a browser's native WebSocket API cannot attach custom headers to the
handshake request, so a query-string token is the standard workaround
(same approach most JWT+WebSocket integrations use). It's sent over
wss:// in production, same as any other credential in a URL over TLS.
"""
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth import get_user_model
from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from core.utils import get_shop_for_user


@database_sync_to_async
def _resolve_user_and_shop(token_str):
    try:
        token = AccessToken(token_str)
        user = get_user_model().objects.get(id=token['user_id'])
    except (TokenError, KeyError, get_user_model().DoesNotExist):
        return None, None
    try:
        # THE tenant-isolation boundary for WebSockets: which broadcast
        # group (see realtime.events.shop_group_name) this connection
        # joins is resolved from the authenticated user, exactly like
        # every REST view now does via ShopScopedMixin/get_shop_for_user.
        # Getting this wrong doesn't just mis-scope one HTTP response --
        # it means shop A's sales/product changes would stream live into
        # shop B's browser for as long as the connection stays open.
        shop = get_shop_for_user(user)
    except PermissionDenied:
        return user, None
    return user, shop


class JWTAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        query_string = scope.get('query_string', b'').decode()
        token = parse_qs(query_string).get('token', [None])[0]
        if token:
            scope['user'], scope['shop'] = await _resolve_user_and_shop(token)
        else:
            scope['user'], scope['shop'] = None, None
        return await super().__call__(scope, receive, send)
