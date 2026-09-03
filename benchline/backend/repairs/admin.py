from django.contrib import admin
from .models import RepairTicket


@admin.register(RepairTicket)
class RepairTicketAdmin(admin.ModelAdmin):
    list_display = ('ticket_no', 'customer_name', 'device', 'status', 'cost', 'date_in', 'date_out')
    list_filter = ('status',)
    search_fields = ('ticket_no', 'customer_name', 'device')
