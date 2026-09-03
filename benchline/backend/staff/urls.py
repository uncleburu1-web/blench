from rest_framework.routers import DefaultRouter
from .views import WorkerViewSet

router = DefaultRouter()
router.register(r'workers', WorkerViewSet, basename='worker')

urlpatterns = router.urls
