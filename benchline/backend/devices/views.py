from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response

from core.utils import get_shop_for_user
from .models import Device
from .serializers import HeartbeatSerializer, DeviceSerializer


class HeartbeatView(APIView):
    """The desktop POS calls this every 30-60s while it has connectivity —
    it's the only signal the cloud has that "the desktop is online right
    now". No heartbeat for a while (see devices.models.ONLINE_THRESHOLD)
    and the CEO app's shop-status check reports the desktop as offline,
    even though the cloud API itself is perfectly reachable.
    """

    def post(self, request):
        serializer = HeartbeatSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        shop = get_shop_for_user(request.user)

        device, _ = Device.objects.update_or_create(
            id=data['device_id'],
            defaults={
                'shop': shop,
                'device_type': data['device_type'],
                'name': data.get('name', ''),
                'app_version': data.get('app_version', ''),
                'last_seen_at': timezone.now(),
                'is_deleted': False,
            },
        )
        return Response(DeviceSerializer(device).data)


class DeviceListView(APIView):
    """Which devices (desktop tills, CEO phones) have ever connected for
    this shop, and whether each is currently considered online."""

    def get(self, request):
        shop = get_shop_for_user(request.user)
        devices = Device.objects.filter(shop=shop, is_deleted=False)
        return Response(DeviceSerializer(devices, many=True).data)
