"""
Sync app — the cloud side of the desktop's offline-first outbox.

The desktop (`desktop/src/main/sync.js`) has been fully built and pointed
at `/api/sync/push/` since it was written — every product, stock batch,
and sale rung up offline gets queued locally and retried every 15s. This
endpoint not existing yet was the entire reason none of it ever reached
the cloud: every push got a 404, which sync.js's own error handling
correctly treats as "still offline," so it just quietly kept the queue
`pending` forever instead of failing loudly. Nothing below changes that
contract — same request/response shape sync.js already sends and expects.
"""
from django.db import transaction
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from core.utils import get_shop_for_user
from customers.models import Customer
from inventory.models import InventoryItem, StockBatch
from realtime.events import broadcast
from sales.models import Sale, SaleItem, next_invoice_number
from sales.views import _allocate_stock, _restore_stock

from .models import SyncOperation


class _Skip(Exception):
    """Raised when an operation can't be applied yet because something it
    depends on (a sale_item's Sale header, a stock_batch's product) hasn't
    landed in this or an earlier batch. This is NOT a rejection: the
    caller leaves the op out of `results` entirely, and sync.js already
    treats an id missing from `results` as "retry next tick" — so a
    sale_item that arrives one batch ahead of its Sale (shouldn't happen
    given queue ordering, but the network can still reorder retries)
    resolves itself automatically instead of being permanently dropped.
    """


# --- one handler per entity_type sync.js can send --------------------------

def _apply_product(shop, entity_id, operation, payload):
    if operation == 'delete':
        InventoryItem.objects.filter(id=entity_id, shop=shop).update(is_deleted=True)
        return
    defaults = {
        'name': payload.get('name', ''),
        'short_code': payload.get('short_code') or '',
        'barcode': payload.get('barcode') or None,
        'category': payload.get('category') or 'other',
        'unit': payload.get('unit') or 'PIECE',
        'sell_price': payload.get('sell_price') or 0,
        'min_stock': payload.get('min_stock') if payload.get('min_stock') is not None else 2,
    }
    InventoryItem.objects.update_or_create(id=entity_id, shop=shop, defaults=defaults)


def _apply_stock_batch(shop, entity_id, operation, payload):
    if operation == 'delete':
        StockBatch.objects.filter(id=entity_id, shop=shop).update(is_deleted=True)
        return
    try:
        item = InventoryItem.objects.get(id=payload['product_id'], shop=shop)
    except (InventoryItem.DoesNotExist, KeyError):
        raise _Skip()  # the product this batch belongs to hasn't synced yet

    # The desktop's local schema doesn't carry a per-batch selling_price
    # (only cost_price) — it keeps one sell_price on the product itself.
    # StockBatch.selling_price is required cloud-side, so fall back to the
    # item's current price rather than rejecting the whole batch over a
    # field the desktop was never asked to track.
    selling_price = payload.get('selling_price')
    if selling_price in (None, ''):
        selling_price = item.sell_price

    defaults = {
        'item': item,
        'batch_number': payload.get('batch_number') or '',
        'quantity_received': payload.get('quantity_received') or 0,
        'quantity_remaining': payload.get('quantity_remaining') or 0,
        'cost_price': payload.get('cost_price') or 0,
        'selling_price': selling_price,
        'expiry_date': payload.get('expiry_date') or None,
    }
    StockBatch.objects.update_or_create(id=entity_id, shop=shop, defaults=defaults)


def _apply_customer(shop, entity_id, operation, payload):
    if operation == 'delete':
        Customer.objects.filter(id=entity_id, shop=shop).update(is_deleted=True)
        return
    defaults = {
        'name': payload.get('name', ''),
        'phone': payload.get('phone') or '',
        'email': payload.get('email') or '',
        'address': payload.get('address') or '',
        'notes': payload.get('notes') or '',
    }
    Customer.objects.update_or_create(id=entity_id, shop=shop, defaults=defaults)


def _apply_sale(shop, entity_id, operation, payload):
    if operation == 'delete':
        try:
            sale = Sale.objects.get(id=entity_id, shop=shop)
        except Sale.DoesNotExist:
            return  # never arrived and now it's deleted too — nothing to do
        for sale_item in sale.items.all():
            _restore_stock(sale_item)
            sale_item.is_deleted = True
            sale_item.save(update_fields=['is_deleted', 'updated_at'])
        sale.is_deleted = True
        sale.save(update_fields=['is_deleted', 'updated_at'])
        return

    defaults = {
        'customer_name': payload.get('customer_name') or 'Walk-in',
        'staff_name': payload.get('staff_name') or '',
        'payment_method': payload.get('payment_method') or 'cash',
        'status': payload.get('status') or 'completed',
        'amount_paid': payload.get('amount_paid') or 0,
    }
    customer_id = payload.get('customer_id')
    if customer_id:
        customer = Customer.objects.filter(id=customer_id, shop=shop).first()
        if customer is None:
            raise _Skip()  # this sale's customer hasn't synced yet
        defaults['customer'] = customer
    invoice_number = payload.get('invoice_number')
    if invoice_number:
        # The desktop sends its own offline-assigned number (see the
        # field's help_text on the model) — always trust it when present,
        # create or update, so a payment-update push never renumbers a
        # sale that already has one.
        defaults['invoice_number'] = invoice_number
    elif operation == 'create' and not Sale.objects.filter(id=entity_id, shop=shop).exists():
        # Only assign a fresh cloud number on a genuine first-time create
        # from an older client that never sent one — never on an update,
        # which would silently renumber an already-numbered sale.
        defaults['invoice_number'] = next_invoice_number(shop)
    Sale.objects.update_or_create(id=entity_id, shop=shop, defaults=defaults)


def _apply_sale_item(shop, entity_id, operation, payload):
    if operation == 'delete':
        SaleItem.objects.filter(id=entity_id, shop=shop).update(is_deleted=True)
        return

    try:
        sale = Sale.objects.get(id=payload['sale_id'], shop=shop)
    except (Sale.DoesNotExist, KeyError):
        raise _Skip()  # this line's Sale header hasn't synced yet

    item = None
    product_id = payload.get('product_id')
    if product_id:
        item = InventoryItem.objects.filter(id=product_id, shop=shop).first()
        if item is None:
            raise _Skip()  # the product this line sold hasn't synced yet

    defaults = {
        'sale': sale,
        'item': item,
        'item_name': payload.get('item_name', ''),
        'category': payload.get('category') or '',
        'quantity': payload.get('quantity') or 1,
        'unit_price': payload.get('unit_price') or 0,
        'discount': payload.get('discount') or 0,
    }
    sale_item, created = SaleItem.objects.update_or_create(id=entity_id, shop=shop, defaults=defaults)

    if created and item is not None:
        # Deliberately NOT the unit_cost the desktop computed locally —
        # that was FEFO'd against the desktop's own SQLite batches. The
        # cloud independently FEFO-allocates against ITS batches, same
        # function the normal REST create-sale endpoint uses, so cost/
        # profit numbers here match what they'd be had this sale happened
        # online in the first place.
        _allocate_stock(sale_item, shop)

    if sale.status == 'completed':
        sale.amount_paid = sale.total
        sale.save(update_fields=['amount_paid'])


_HANDLERS = {
    'product': _apply_product,
    'stock_batch': _apply_stock_batch,
    'customer': _apply_customer,
    'sale': _apply_sale,
    'sale_item': _apply_sale_item,
}

# Same events a REST create/update/delete on the equivalent resource would
# fire (see core.mixins.ShopScopedMixin) — unified so the frontend listens
# for ONE set of event names regardless of whether a change came from the
# web (REST) or a desktop sync push. sync.js's names ('product',
# 'stock_batch', 'create'...) don't match Django's model_name/DRF-action
# naming on their own, so this just translates between the two vocabularies.
_EVENT_ENTITY = {
    'product': 'inventoryitem', 'stock_batch': 'stockbatch',
    'customer': 'customer', 'sale': 'sale', 'sale_item': 'saleitem',
}
_EVENT_VERB = {'create': 'created', 'update': 'updated', 'delete': 'deleted'}


class SyncPushView(APIView):
    """POST /api/sync/push/

    Body:  {"operations": [{id, entity_type, entity_id, operation,
             payload, client_timestamp}, ...]} — exactly what
             desktop/src/main/sync.js already sends.
    Reply: {"results": [{"id": <op id>, "status": "applied" |
             "already_applied" | "rejected", "error"?: str}, ...]}

    Idempotent per operation id (see SyncOperation) — replaying the same
    batch after a dropped response is safe and returns `already_applied`
    instead of double-applying anything.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        shop = get_shop_for_user(request.user)
        operations = request.data.get('operations') or []
        results = []

        for op in operations:
            op_id = op.get('id')
            entity_type = op.get('entity_type')
            entity_id = op.get('entity_id')
            operation = op.get('operation')
            payload = op.get('payload') or {}

            if not op_id or not entity_id:
                continue  # malformed — nothing to key on, skip rather than crash the whole batch

            if SyncOperation.objects.filter(id=op_id).exists():
                results.append({'id': op_id, 'status': 'already_applied'})
                continue

            handler = _HANDLERS.get(entity_type)
            if handler is None:
                results.append({
                    'id': op_id, 'status': 'rejected',
                    'error': f'unknown entity_type "{entity_type}"',
                })
                continue

            try:
                with transaction.atomic():
                    handler(shop, entity_id, operation, payload)
                    SyncOperation.objects.create(
                        id=op_id, shop=shop, entity_type=entity_type,
                        entity_id=entity_id, operation=operation,
                    )
            except _Skip:
                continue  # leave it out of `results` — sync.js retries it next tick
            except Exception as exc:
                results.append({'id': op_id, 'status': 'rejected', 'error': str(exc)})
                continue

            broadcast(
                shop,
                f'{_EVENT_ENTITY.get(entity_type, entity_type)}.{_EVENT_VERB.get(operation, operation)}',
                {'id': entity_id},
            )
            results.append({'id': op_id, 'status': 'applied'})

        return Response({'results': results})


def _serialize_product(o):
    return {
        'id': str(o.id), 'name': o.name, 'short_code': o.short_code, 'barcode': o.barcode,
        'category': o.category, 'unit': o.unit,
        'sell_price': str(o.sell_price), 'min_stock': o.min_stock,
    }


def _serialize_stock_batch(o):
    return {
        'id': str(o.id), 'product_id': str(o.item_id),
        'batch_number': o.batch_number,
        'quantity_received': o.quantity_received,
        'quantity_remaining': o.quantity_remaining,
        'cost_price': str(o.cost_price), 'selling_price': str(o.selling_price),
        'expiry_date': o.expiry_date.isoformat() if o.expiry_date else None,
    }


def _serialize_customer(o):
    return {
        'id': str(o.id), 'name': o.name, 'phone': o.phone,
        'email': o.email, 'address': o.address, 'notes': o.notes,
    }


class SyncPullView(APIView):
    """GET /api/sync/pull/?since=<ISO8601>&entity_types=product,stock_batch

    Delta pull for rows changed in the cloud after `since` (everything, if
    omitted) — the other half of the sync design. Nothing on the desktop
    calls this yet (sync.js is push-only today); this lays the foundation
    so a future pull loop has a stable shape to feed into the same local
    tables. Scoped to products and stock batches for now — pulling sales
    down safely (without ever double-counting a sale the desktop rang up
    itself) needs its own pass, deliberately left for later.
    """
    permission_classes = [IsAuthenticated]
    serializers = {
        'product': (InventoryItem, _serialize_product),
        'stock_batch': (StockBatch, _serialize_stock_batch),
        'customer': (Customer, _serialize_customer),
    }

    def get(self, request):
        shop = get_shop_for_user(request.user)
        since_param = request.query_params.get('since')
        since = parse_datetime(since_param) if since_param else None
        requested = request.query_params.get('entity_types')
        entity_types = requested.split(',') if requested else list(self.serializers)

        operations = []
        for entity_type in entity_types:
            spec = self.serializers.get(entity_type)
            if spec is None:
                continue
            model, serialize = spec
            qs = model.objects.filter(shop=shop)
            if since:
                qs = qs.filter(updated_at__gt=since)
            for obj in qs:
                operations.append({
                    'entity_type': entity_type,
                    'entity_id': str(obj.id),
                    'operation': 'delete' if obj.is_deleted else 'update',
                    'payload': serialize(obj),
                    'updated_at': obj.updated_at.isoformat(),
                })

        return Response({'operations': operations, 'server_time': timezone.now().isoformat()})
