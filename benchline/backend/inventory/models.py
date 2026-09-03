from django.db import models
from decimal import Decimal
from core.models import SyncModel


class InventoryItem(SyncModel):
    CATEGORY_CHOICES = [
        ('laptop', 'Laptop'),
        ('part', 'Part'),
        ('accessory', 'Accessory'),
        ('consumable', 'Consumable'),
        ('other', 'Other'),
    ]

    name = models.CharField(max_length=200)
    short_code = models.CharField(max_length=40, blank=True, help_text='Short label e.g. "Para500"')
    barcode = models.CharField(
        max_length=64, null=True, blank=True, unique=True, db_index=True,
        help_text='Scanned/printed barcode (UPC/EAN or a shop-assigned code). Null (not empty string) when '
                   'unset so multiple barcode-less products never collide on the unique constraint.',
    )
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default='other')
    brand = models.CharField(max_length=100, blank=True)
    unit = models.CharField(max_length=30, default='PIECE', help_text='e.g. TABLET, PIECE, BOX, PACK')
    spec = models.CharField(max_length=100, blank=True, help_text='e.g. 200mg, 15.6-inch')
    min_stock = models.PositiveIntegerField(default=2, help_text='Reorder alert threshold')
    sell_price = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal('0.00'),
        help_text='Current default unit selling price (kept in sync with the latest batch, editable)',
    )
    # created_at / updated_at / is_deleted / shop / id (UUID) come from SyncModel.

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.quantity} in stock)'

    # --- computed from batches -------------------------------------------------
    @property
    def quantity(self):
        return self.batches.filter(is_deleted=False).aggregate(
            models.Sum('quantity_remaining')
        )['quantity_remaining__sum'] or 0

    @property
    def cost_price(self):
        """Weighted-average cost across remaining batch stock."""
        remaining = [b for b in self.batches.filter(is_deleted=False) if b.quantity_remaining > 0]
        total_qty = sum(b.quantity_remaining for b in remaining)
        if not total_qty:
            return 0
        total_cost = sum(b.quantity_remaining * b.cost_price for b in remaining)
        return round(total_cost / total_qty, 2)

    @property
    def is_low_stock(self):
        return self.quantity <= self.min_stock

    @property
    def stock_value(self):
        return sum(b.quantity_remaining * b.cost_price for b in self.batches.filter(is_deleted=False))

    @property
    def batch_count(self):
        return self.batches.filter(is_deleted=False).count()


class StockBatch(SyncModel):
    item = models.ForeignKey(InventoryItem, on_delete=models.CASCADE, related_name='batches')
    batch_number = models.CharField(max_length=60)
    quantity_received = models.PositiveIntegerField()
    quantity_remaining = models.PositiveIntegerField()
    cost_price = models.DecimalField(max_digits=12, decimal_places=2)
    selling_price = models.DecimalField(max_digits=12, decimal_places=2)
    expiry_date = models.DateField(null=True, blank=True)
    supplier = models.ForeignKey(
        'suppliers.Supplier', on_delete=models.SET_NULL, null=True, blank=True, related_name='batches'
    )
    supplier_name = models.CharField(max_length=200, blank=True, help_text='Fallback if no linked Supplier record')
    received_date = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['expiry_date', 'received_date']

    def __str__(self):
        return f'{self.item.name} — batch {self.batch_number}'

    def save(self, *args, **kwargs):
        is_new = self._state.adding
        if is_new and not self.quantity_remaining:
            self.quantity_remaining = self.quantity_received
        super().save(*args, **kwargs)
        if is_new:
            # Keep the item's headline sell price in sync with the newest batch.
            self.item.sell_price = self.selling_price
            self.item.save(update_fields=['sell_price', 'updated_at'])

    @property
    def is_expiring_soon(self):
        if not self.expiry_date:
            return False
        from django.utils import timezone
        days_left = (self.expiry_date - timezone.localdate()).days
        return 0 <= days_left <= 30

    @property
    def is_expired(self):
        if not self.expiry_date:
            return False
        from django.utils import timezone
        return self.expiry_date < timezone.localdate()

