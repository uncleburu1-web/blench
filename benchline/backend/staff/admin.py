from django.contrib import admin
from .models import Worker


@admin.register(Worker)
class WorkerAdmin(admin.ModelAdmin):
    list_display = ('full_name', 'role', 'phone', 'is_active', 'can_login', 'hire_date')
    list_filter = ('role', 'is_active')
    search_fields = ('full_name', 'phone')
