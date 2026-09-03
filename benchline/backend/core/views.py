from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from inventory.models import InventoryItem
from repairs.models import RepairTicket, RepairPayment
from sales.models import Sale
from core.models import Shop, Organization
from core.permissions import is_ceo
from core.utils import get_shop_for_user, get_organization_for_user
from devices.models import Device, ONLINE_THRESHOLD
from staff.models import Worker
from subscriptions.models import get_or_create_subscription


class HealthCheckView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({'status': 'ok'})


class RegisterView(APIView):
    """POST /api/auth/register/ -- the entire onboarding flow for a new
    customer: creates their Organization, its first Branch, the owner's
    login account, links them via a Worker(role='owner') on that branch,
    and starts the organization's free trial month -- all atomically, so a
    failure partway through never leaves an orphaned half-created org.

    The registering user becomes BOTH Organization.owner (org-wide CEO
    authority -- create more branches, enterprise billing) AND a branch-
    level Worker(role='owner') on their first branch (so is_owner() checks
    keep working exactly as before multi-branch existed). A solo shop
    owner never has to think about the organization/branch distinction at
    all -- they just have one branch, automatically.

    Deliberately does NOT set is_staff/is_superuser -- those are reserved
    for platform-admin accounts (me, for support), never an ordinary
    customer, however many branches they run.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        shop_name = (request.data.get('shop_name') or '').strip()
        username = (request.data.get('username') or '').strip()
        password = request.data.get('password') or ''
        email = (request.data.get('email') or '').strip()
        full_name = (request.data.get('full_name') or '').strip() or username

        if not shop_name or not username or not password:
            return Response({'detail': 'shop_name, username, and password are required.'}, status=400)
        if len(password) < 8:
            return Response({'detail': 'Password must be at least 8 characters.'}, status=400)

        User = get_user_model()
        if User.objects.filter(username=username).exists():
            return Response({'detail': 'That username is already taken.'}, status=400)

        with transaction.atomic():
            user = User.objects.create_user(username=username, password=password, email=email)
            org = Organization.objects.create(name=shop_name, owner=user)
            shop = Shop.objects.create(organization=org, name=shop_name)
            Worker.objects.create(shop=shop, user=user, full_name=full_name, role='owner')
            get_or_create_subscription(org)  # starts the free trial month immediately, no payment required yet

        refresh = RefreshToken.for_user(user)
        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
        }, status=201)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        worker = getattr(user, 'worker', None)
        is_owner_flag = user.is_staff or user.is_superuser or (worker and worker.role == 'owner')
        return Response({
            'id': user.id,
            'username': user.username,
            'is_staff': user.is_staff,
            'is_superuser': user.is_superuser,
            'is_owner': bool(is_owner_flag),
            'role': 'owner' if is_owner_flag else (worker.role if worker else 'owner'),
            'full_name': worker.full_name if worker else user.username,
        })


class DashboardStatsView(APIView):
    """Aggregated numbers for the dashboard screen -- this shop's numbers
    only. Every query below is scoped to `shop`; before multi-tenancy,
    these were global across every shop in the database (a real
    cross-tenant leak now that a second shop can exist)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        shop = get_shop_for_user(request.user)

        items = InventoryItem.objects.filter(shop=shop, is_deleted=False)
        stock_value = sum(i.quantity * i.cost_price for i in items)
        low_stock = [i for i in items if i.is_low_stock]

        active_repairs = RepairTicket.objects.filter(shop=shop, is_deleted=False).exclude(status='collected').count()

        today = timezone.localdate()
        todays_sales = Sale.objects.filter(shop=shop, date__date=today, is_deleted=False)
        today_revenue = sum(s.total for s in todays_sales)
        today_profit = sum(s.profit for s in todays_sales)

        todays_repair_payments = RepairPayment.objects.filter(shop=shop, date__date=today)
        service_revenue_today = sum(p.amount for p in todays_repair_payments)
        total_collected_today = today_revenue + service_revenue_today

        return Response({
            'stock_value': stock_value,
            'low_stock_count': len(low_stock),
            'active_repairs': active_repairs,
            'today_revenue': today_revenue,
            'today_profit': today_profit,
            'service_revenue_today': service_revenue_today,
            'total_collected_today': total_collected_today,
        })


class RecentActivityView(APIView):
    """A merged, timestamp-sorted feed of the latest restocks, tickets, and
    sales -- for this shop only (see DashboardStatsView's note on why that
    scoping matters now)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        shop = get_shop_for_user(request.user)
        events = []

        for i in InventoryItem.objects.filter(shop=shop, is_deleted=False).order_by('-updated_at')[:10]:
            events.append({
                'type': 'inventory',
                'text': f'{i.name} updated — {i.quantity} in stock',
                'timestamp': i.updated_at,
            })

        for r in RepairTicket.objects.filter(shop=shop, is_deleted=False).order_by('-date_in')[:10]:
            events.append({
                'type': 'repair',
                'text': f'New ticket {r.ticket_no} — {r.device}',
                'timestamp': r.date_in,
            })
            if r.date_out:
                events.append({
                    'type': 'repair',
                    'text': f'{r.ticket_no} collected by {r.customer_name}',
                    'timestamp': r.date_out,
                })

        for p in RepairPayment.objects.filter(shop=shop).select_related('ticket').order_by('-date')[:10]:
            events.append({
                'type': 'service',
                'text': f'Payment received on {p.ticket.ticket_no} — {p.amount}',
                'timestamp': p.date,
            })

        for s in Sale.objects.filter(shop=shop, is_deleted=False).prefetch_related('items').order_by('-date')[:10]:
            first_item = s.items.first()
            label = first_item.item_name if first_item else 'items'
            extra = s.items.count() - 1
            if extra > 0:
                label += f' +{extra} more'
            events.append({
                'type': 'sale',
                'text': f'Sold {label} to {s.customer_name or "walk-in"} — {s.total}',
                'timestamp': s.date,
            })

        events.sort(key=lambda e: e['timestamp'], reverse=True)
        return Response(events[:10])


class CeoShopStatusView(APIView):
    """The single check the Android CEO app calls right after login (and
    periodically while open) to decide what to show -- see architecture
    doc Sec8. Distinguishes the two states Django can actually observe:

    - `subscription_expired`: the subscription itself has lapsed. Takes
      priority over desktop connectivity -- an expired subscription cuts
      off cloud/remote monitoring regardless of whether the desktop
      happens to be online at this exact moment.
    - `desktop_offline`: subscription is fine, but the desktop hasn't sent
      a heartbeat recently enough to be considered connected.
    - `ok`: both fine -- the CEO app can show live data with confidence.

    A THIRD state from the architecture doc -- "cloud/database unavailable"
    -- deliberately has no representation here: if the cloud backend or its
    database were actually down, this view would never run to produce a
    response at all. That state is the Android app's own responsibility to
    detect, by catching a request timeout / connection failure / 5xx on
    this very call and showing "Shop temporarily unavailable" itself,
    rather than expecting a 200 response to ever say so.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        shop = get_shop_for_user(request.user)
        sub = get_or_create_subscription(shop.organization)
        effective = sub.effective_status

        desktop = Device.objects.filter(
            shop=shop, device_type='desktop', is_deleted=False
        ).order_by('-last_seen_at').first()
        now = timezone.now()
        desktop_connected = bool(
            desktop and desktop.last_seen_at and now - desktop.last_seen_at <= ONLINE_THRESHOLD
        )

        if effective == 'expired':
            state = 'subscription_expired'
            message = 'Subscription expired. Please renew your subscription to restore cloud synchronization.'
        elif not desktop_connected:
            state = 'desktop_offline'
            message = "Unable to connect to desktop. Please check the shop's internet connection."
        else:
            state = 'ok'
            message = None

        return Response({
            'state': state,
            'message': message,
            'subscription_status': effective,
            'subscription_in_grace': effective == 'grace',
            'desktop_connected': desktop_connected,
            'desktop_last_seen': desktop.last_seen_at if desktop else None,
            'desktop_name': desktop.name if desktop else None,
        })
