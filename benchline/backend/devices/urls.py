from django.urls import path
from .views import HeartbeatView, DeviceListView

urlpatterns = [
    path('devices/heartbeat/', HeartbeatView.as_view(), name='device-heartbeat'),
    path('devices/', DeviceListView.as_view(), name='device-list'),
]
