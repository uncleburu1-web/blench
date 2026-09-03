from decimal import Decimal
from django.db import transaction
from rest_framework import viewsets, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from core.mixins import ShopScopedMixin
from realtime.events import broadcast
from .models import Sale, SaleItem, SaleAllocation, next_invoice_number
from .serializers import SaleSerializer, AddPaymentSerializer, ReplaceSaleItemSerializer


def _allocate_stock(sale_item, shop):
    """FEFO stock deduction for one cart line — same logic the old
    single-item Sale used, just scoped to a SaleItem now instead of the
    whole sale."""
    item = sale_item.item
    if item is None:
        return
    remaining_to_take = sale_item.quantity
    batches = item.batches.filter(
        quantity_remaining__gt=0, is_deleted=False
    ).order_by('expiry_date', 'received_date')
    total_cost = 0
    total_taken = 0
    for batch in batches:
        if remaining_to_take <= 0:
            break
        take = min(batch.quantity_remaining, remaining_to_take)
        batch.quantity_remaining -= take
        batch.save(update_fields=['quantity_remaining'])
        SaleAllocation.objects.create(sale_item=sale_item, batch=batch, quantity=take, shop=shop)
        total_cost += take * batch.cost_price
        total_taken += take
        remaining_to_take -= take

    if total_taken:
        sale_item.unit_cost = round(total_cost / total_taken, 2)
        sale_item.save(update_fields=['unit_cost'])


def _restore_stock(sale_item):
    for alloc in sale_item.allocations.select_related('batch').all():
        if alloc.batch is not None:
            alloc.batch.quantity_remaining += alloc.quantity
            alloc.batch.save(update_fields=['quantity_remaining'])
    sale_item.allocations.all().delete()


class SaleViewSet(ShopScopedMixin, viewsets.ModelViewSet):
    queryset = Sale.objects.filter(is_deleted=False).prefetch_related('items')
    serializer_class = SaleSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['payment_method', 'status']
    search_fields = ['items__item_name', 'customer_name', 'staff_name']
    ordering_fields = ['date']

    @transaction.atomic
    def perform_create(self, serializer):
        # Built manually rather than via serializer.save()/create(): FEFO
        # stock allocation needs real SaleItem instances to loop over, and
        # `sale.total` (used to settle amount_paid on a completed sale)
        # only makes sense once every line item actually exists.
        shop = self.get_current_shop()
        validated_data = dict(serializer.validated_data)
        items_data = validated_data.pop('items')

        worker = getattr(self.request.user, 'worker', None)
        if worker is not None:
            validated_data.setdefault('worker', worker)
            if not validated_data.get('staff_name'):
                validated_data['staff_name'] = worker.full_name

        sale = Sale.objects.create(shop=shop, invoice_number=next_invoice_number(shop), **validated_data)

        for item_data in items_data:
            item = item_data.get('item')
            if item is not None and not item_data.get('category'):
                item_data['category'] = item.category
            sale_item = SaleItem.objects.create(sale=sale, shop=shop, **item_data)
            _allocate_stock(sale_item, shop)

        if sale.status == 'completed':
            sale.amount_paid = sale.total
            sale.save(update_fields=['amount_paid'])

        serializer.instance = sale
        broadcast(shop, 'sale.created', {
            'id': str(sale.id), 'invoice_number': sale.invoice_number,
            'total': str(sale.total), 'customer_name': sale.customer_name,
        })

    @transaction.atomic
    def perform_destroy(self, instance):
        # Soft delete, cascaded by hand: a hard DELETE never reaches the
        # sync queue (see ShopScopedMixin.perform_destroy), and reports
        # query SaleItem directly — if the header were tombstoned but its
        # lines weren't, a "deleted" sale's items would keep showing up in
        # sales-by-item / best-selling / tax reports.
        for sale_item in instance.items.all():
            # Allocations are internal bookkeeping (which batch a line drew
            # from) rather than something reports or the sync engine need
            # to see independently — restoring stock and clearing them here
            # (see _restore_stock) is enough; only the SaleItem and Sale
            # rows themselves need the soft-delete tombstone.
            _restore_stock(sale_item)
            sale_item.is_deleted = True
            sale_item.save(update_fields=['is_deleted', 'updated_at'])
        instance.is_deleted = True
        instance.save(update_fields=['is_deleted', 'updated_at'])
        broadcast(instance.shop, 'sale.deleted', {'id': str(instance.id)})

    @action(detail=True, methods=['post'], url_path='add-payment')
    def add_payment(self, request, pk=None):
        sale = self.get_object()
        serializer = AddPaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        amount = serializer.validated_data['amount']

        sale.amount_paid = min(sale.amount_paid + amount, sale.total)
        if sale.amount_paid >= sale.total:
            sale.status = 'completed'
        sale.save()
        broadcast(sale.shop, 'sale.updated', {
            'id': str(sale.id), 'invoice_number': sale.invoice_number,
            'status': sale.status, 'balance_due': str(sale.balance_due),
        })
        return Response(SaleSerializer(sale).data)

    @action(detail=True, methods=['post'], url_path='replace-item')
    @transaction.atomic
    def replace_item(self, request, pk=None):
        """Swap one cart line for a different item — e.g. the customer
        bought a ₦5,000 charger and wants a ₦6,000 one instead. Restores
        stock for the old line, deducts stock for the new one (FEFO), and
        reports whether the customer owes more or is due a refund, on the
        sale as a whole (money is collected per sale, not per line).

        Replaces the old single-item `replace` action. If the sale has
        exactly one item, `sale_item` can be omitted for backward
        compatibility — otherwise it must name which line to swap.
        """
        sale = self.get_object()
        serializer = ReplaceSaleItemSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        sale_item = data.get('sale_item')
        if sale_item is None:
            if sale.items.count() != 1:
                return Response(
                    {'sale_item': 'This sale has more than one item — specify which one to replace.'},
                    status=400,
                )
            sale_item = sale.items.first()
        elif sale_item.sale_id != sale.id:
            return Response({'sale_item': 'That item does not belong to this sale.'}, status=400)

        old_total = sale.total

        _restore_stock(sale_item)

        new_item = data.get('item')
        sale_item.item = new_item
        sale_item.item_name = data['item_name']
        sale_item.quantity = data['quantity']
        sale_item.unit_price = data['unit_price']
        sale_item.unit_cost = data.get('unit_cost') or Decimal('0.00')
        if new_item is not None:
            sale_item.category = new_item.category
        sale_item.save()

        _allocate_stock(sale_item, sale.shop)

        # `sale` was fetched via a prefetch_related('items') queryset in
        # get_object() — that cache is now stale since we just mutated a
        # different (freshly-queried) SaleItem instance above, not the ones
        # cached on `sale`. Re-fetch before computing totals or serializing
        # so everything below reflects the swapped line, not the old one.
        sale = Sale.objects.prefetch_related('items').get(pk=sale.pk)

        # If this was a completed sale, keep amount_paid matched to the new
        # total so a completed sale doesn't silently become "outstanding".
        if sale.status == 'completed':
            sale.amount_paid = sale.total
            sale.save(update_fields=['amount_paid'])

        new_total = sale.total
        balance = new_total - old_total  # positive = customer owes more, negative = refund due

        return Response({
            'sale': SaleSerializer(sale).data,
            'old_total': old_total,
            'new_total': new_total,
            'balance': balance,
        })
