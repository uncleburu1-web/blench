from django.contrib import admin
from .models import Shop


@admin.register(Shop)
class ShopAdmin(admin.ModelAdmin):
    list_display = ('name', 'currency', 'tax_rate_default', 'created_at')
    search_fields = ('name',)
