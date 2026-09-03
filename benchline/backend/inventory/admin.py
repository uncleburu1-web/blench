from django.contrib import admin
from .models import InventoryItem, StockBatch


class StockBatchInline(admin.TabularInline):
    model = StockBatch
    extra = 0


@admin.register(InventoryItem)
class InventoryItemAdmin(admin.ModelAdmin):
    list_display = ('name', 'short_code', 'category', 'brand', 'quantity', 'min_stock', 'sell_price', 'updated_at')
    list_filter = ('category',)
    search_fields = ('name', 'short_code', 'brand')
    inlines = [StockBatchInline]


@admin.register(StockBatch)
class StockBatchAdmin(admin.ModelAdmin):
    list_display = ('item', 'batch_number', 'quantity_remaining', 'quantity_received', 'cost_price', 'selling_price', 'expiry_date', 'supplier_name')
    list_filter = ('expiry_date',)
    search_fields = ('batch_number', 'item__name')
