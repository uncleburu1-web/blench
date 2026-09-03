import uuid

from django.conf import settings
from django.db import models


class Organization(models.Model):
    """The top of the hierarchy: Organization -> Branch (Shop) -> business
    records. One Organization per paying customer/CEO. A solo shop owner
    still gets an Organization (with exactly one Branch under it) --
    there's no separate "simple" data model, just an org that happens to
    have one branch instead of several. See Shop below for why the
    existing `shop` FK name is kept everywhere rather than renamed.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='owned_organizations',
        null=True, blank=True,  # null only for the one legacy default-org row — see core.utils.DEFAULT_SHOP_ID
        help_text='The CEO — organization-wide access to every branch. NOT the same as a '
                   'branch-level Worker(role="owner"), which is scoped to one branch only.',
    )
    # Enterprise billing lives here, not as a per-branch Subscription, since
    # it's ONE flat price covering unlimited branches -- see
    # subscriptions.models for how this is checked alongside per-branch
    # subscriptions.
    enterprise_until = models.DateTimeField(
        null=True, blank=True,
        help_text='If set and in the future, every branch under this org has cloud services '
                   'enabled regardless of its own individual subscription.',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

    @property
    def has_enterprise_access(self):
        from django.utils import timezone
        return bool(self.enterprise_until and timezone.now() <= self.enterprise_until)


class Shop(models.Model):
    """A Branch. Kept the name `Shop` (not renamed to `Branch`) on purpose
    -- it's the FK target on every single syncable model in the app
    (InventoryItem, Sale, Customer, ... via SyncModel below), and renaming
    it would mean touching every app's models/migrations for a purely
    cosmetic reason. Conceptually this IS "Branch" now: it belongs to an
    Organization, has a branch_code, a manager, a status, etc. — the
    multi-branch architecture the CEO asked for maps onto this model
    directly, just under its original name.
    """
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('inactive', 'Inactive'),
        ('suspended', 'Suspended'),
        ('archived', 'Archived'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name='branches',
        null=True, blank=True,  # null only for the one legacy default-shop row — see core.utils.DEFAULT_SHOP_ID
    )
    name = models.CharField(max_length=200)
    branch_code = models.CharField(max_length=30, blank=True, help_text='Unique within the organization, e.g. "WUSE001".')
    address = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    manager = models.ForeignKey(
        'staff.Worker', on_delete=models.SET_NULL, null=True, blank=True, related_name='managed_branches',
    )
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='active')
    opening_date = models.DateField(null=True, blank=True)
    timezone = models.CharField(max_length=50, default='Africa/Lagos')
    currency = models.CharField(max_length=10, default='NGN')
    description = models.TextField(blank=True)
    tax_rate_default = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(
                fields=['organization', 'branch_code'],
                condition=~models.Q(branch_code=''),
                name='unique_branch_code_per_organization',
            ),
        ]

    def __str__(self):
        return self.name

    @property
    def is_operational(self):
        """SUSPENDED/ARCHIVED branches keep their historical records fully
        readable (reports, audits) but block new business activity — see
        sales/views.py and the other create paths that check this."""
        return self.status == 'active'


class SyncModel(models.Model):
    """Abstract base for every table that needs to sync between the cloud
    and the offline-first desktop client (architecture doc §2 / §7).

    - id: UUID, not autoincrement. Client-generated on the desktop so a
      record created offline never collides with one created on another
      device or on the cloud before they've ever talked to each other.
    - shop: branch partition (see Shop's docstring for why the field is
      still named `shop`, not `branch`). Every syncable row belongs to
      exactly one branch so per-branch AND organization-wide (aggregated
      across branches) scoping can both work cleanly.
    - updated_at: last-write timestamp. This is both the field the conflict
      resolver compares on for master-data (field-level last-write-wins)
      and the cursor `/sync/pull/?since=<updated_at>` uses for delta pulls —
      every syncable table must expose it under this exact name.
    - is_deleted: soft delete. A deletion has to flow through the sync
      queue like any other operation instead of disappearing before it's
      had a chance to sync, so we never hard-delete syncable rows.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name='%(class)ss')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)
    is_deleted = models.BooleanField(default=False)

    class Meta:
        abstract = True
