from django.urls import path
from .views import DashboardStatsView, RecentActivityView, HealthCheckView, MeView, CeoShopStatusView

urlpatterns = [
    path('health/', HealthCheckView.as_view(), name='health'),
    path('me/', MeView.as_view(), name='me'),
    path('dashboard/stats/', DashboardStatsView.as_view(), name='dashboard-stats'),
    path('dashboard/activity/', RecentActivityView.as_view(), name='dashboard-activity'),
    path('ceo/shop-status/', CeoShopStatusView.as_view(), name='ceo-shop-status'),
]
