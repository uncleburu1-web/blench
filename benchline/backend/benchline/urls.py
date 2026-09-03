from django.contrib import admin
from django.urls import path, include
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

admin.site.site_header = 'GPS LAPTOP'
admin.site.site_title = 'GPS LAPTOP Admin'
admin.site.index_title = 'Shop Management'

from core.views import RegisterView

urlpatterns = [
    path('admin/', admin.site.urls),

    # Auth
    path('api/auth/register/', RegisterView.as_view(), name='register'),
    path('api/auth/login/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),

    # App routes
    path('api/', include('core.urls')),
    path('api/', include('staff.urls')),
    path('api/', include('suppliers.urls')),
    path('api/inventory/', include('inventory.urls')),
    path('api/repairs/', include('repairs.urls')),
    path('api/', include('sales.urls')),
    path('api/', include('liabilities.urls')),
    path('api/reports/', include('reports.urls')),
    path('api/', include('devices.urls')),
    path('api/', include('subscriptions.urls')),
    path('api/', include('sync.urls')),
    path('api/', include('customers.urls')),
    path('api/', include('branches.urls')),
]
