from django.conf import settings
from django.db import models
from core.models import SyncModel


class Worker(SyncModel):
    """The shop-scoped staff profile. NOTE: this is a deliberate interim
    shape — `user` still points at Django's built-in auth.User (integer PK,
    no shop of its own). A proper multi-tenant `accounts` app with a custom,
    shop-aware User model is called out as step 2 in the architecture doc;
    swapping AUTH_USER_MODEL after migrations already exist is destructive,
    so it's done there deliberately rather than folded into this retrofit.
    """
    ROLE_CHOICES = [
        ('owner', 'Owner / Admin'),
        ('branch_manager', 'Branch manager'),
        ('seller', 'Seller (can log in and sell)'),
        ('technician', 'Repair technician'),
        ('attendant', 'Shop attendant'),
        ('other', 'Other'),
    ]

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='worker',
        help_text='Linked login account — only set for workers who can access the system.',
    )
    full_name = models.CharField(max_length=150)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='attendant')
    phone = models.CharField(max_length=30, blank=True)
    salary = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    hire_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    # created_at / updated_at / is_deleted / shop / id (UUID) come from SyncModel.

    class Meta:
        ordering = ['full_name']

    def __str__(self):
        return f'{self.full_name} ({self.get_role_display()})'

    @property
    def can_login(self):
        return self.user_id is not None
