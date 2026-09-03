from decimal import Decimal
from rest_framework import serializers
from inventory.models import InventoryItem
from customers.models import Customer
from .models import Sale, SaleItem


class SaleItemSerializer(serializers.ModelSerializer):
    subtotal = serializers.ReadOnlyField()
    tax_amount = serializers.ReadOnlyField()
    total = serializers.ReadOnlyField()
    profit = serializers.ReadOnlyField()
    margin_percent = serializers.ReadOnlyField()
    item = serializers.PrimaryKeyRelatedField(
        queryset=InventoryItem.objects.all(), required=False, allow_null=True
    )

    class Meta:
        model = SaleItem
        fields = [
            'id', 'item', 'item_name', 'category', 'quantity', 'unit_price', 'unit_cost',
            'discount', 'tax_rate', 'subtotal', 'tax_amount', 'total', 'profit', 'margin_percent',
        ]
        read_only_fields = ['id']

    def validate(self, attrs):
        item = attrs.get('item')
        quantity = attrs.get('quantity', 1)
        if item is not None and item.quantity < quantity:
            raise serializers.ValidationError(
                f'Only {item.quantity} of "{item.name}" left in stock — cannot sell {quantity}.'
            )
        return attrs


class SaleSerializer(serializers.ModelSerializer):
    """The cart header. `items` is the writable line list — POST a cart as
    `{ ...header fields..., items: [ {item, quantity, unit_price, ...}, ... ] }`.
    Stock allocation (FEFO across batches) happens in the view, same as
    before, just looped per item now instead of once.
    """
    items = SaleItemSerializer(many=True)
    subtotal = serializers.ReadOnlyField()
    discount = serializers.ReadOnlyField()
    tax_amount = serializers.ReadOnlyField()
    total = serializers.ReadOnlyField()
    profit = serializers.ReadOnlyField()
    margin_percent = serializers.ReadOnlyField()
    balance_due = serializers.ReadOnlyField()
    worker_name = serializers.CharField(source='worker.full_name', read_only=True, default=None)
    customer = serializers.PrimaryKeyRelatedField(queryset=Customer.objects.all(), required=False, allow_null=True)

    class Meta:
        model = Sale
        fields = [
            'id', 'invoice_number', 'items', 'subtotal', 'discount', 'tax_amount', 'total', 'profit', 'margin_percent',
            'status', 'amount_paid', 'balance_due',
            'customer', 'customer_name', 'staff_name', 'worker_name', 'payment_method', 'date',
        ]
        read_only_fields = ['id', 'invoice_number', 'date', 'worker_name']

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError('A sale needs at least one item.')
        return value

    def validate(self, attrs):
        status = attrs.get('status', 'completed')
        amount_paid = attrs.get('amount_paid')
        if status == 'outstanding' and amount_paid in (None, 0):
            raise serializers.ValidationError(
                'Enter the amount already paid for an outstanding (installment) sale.'
            )
        return attrs

    # Actual creation (stock allocation, item rows) is handled in
    # SaleViewSet.perform_create — it needs transaction control and FEFO
    # batch logic that doesn't belong in a serializer. This create() only
    # covers the plain header+items case for anything that calls the
    # serializer directly (e.g. tests).
    def create(self, validated_data):
        items_data = validated_data.pop('items')
        sale = Sale.objects.create(**validated_data)
        for item_data in items_data:
            SaleItem.objects.create(sale=sale, shop=sale.shop, **item_data)
        return sale


class AddPaymentSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal('0.01'))


class ReplaceSaleItemSerializer(serializers.Serializer):
    """Swap what a single cart line is for — e.g. customer bought a ₦5,000
    charger and wants a ₦6,000 one instead. Recomputes stock and reports
    the balance owed either way, at the whole-sale level (since payment is
    collected per sale, not per line)."""
    sale_item = serializers.PrimaryKeyRelatedField(
        queryset=SaleItem.objects.all(), required=False,
        help_text='Which line to replace. Omit only if the sale has exactly one item.',
    )
    item = serializers.PrimaryKeyRelatedField(queryset=InventoryItem.objects.all(), required=False, allow_null=True)
    item_name = serializers.CharField()
    quantity = serializers.IntegerField(min_value=1, default=1)
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2)
    unit_cost = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, default=Decimal('0.00'))

    def validate(self, attrs):
        item = attrs.get('item')
        quantity = attrs.get('quantity', 1)
        if item is not None and item.quantity < quantity:
            raise serializers.ValidationError(
                f'Only {item.quantity} of "{item.name}" left in stock — cannot give {quantity}.'
            )
        return attrs
