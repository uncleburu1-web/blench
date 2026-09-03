from rest_framework import viewsets, filters
from django_filters.rest_framework import DjangoFilterBackend

from core.permissions import IsOwner
from core.mixins import ShopScopedMixin
from .models import Worker
from .serializers import WorkerSerializer


class WorkerViewSet(ShopScopedMixin, viewsets.ModelViewSet):
    queryset = Worker.objects.filter(is_deleted=False)
    serializer_class = WorkerSerializer
    permission_classes = [IsOwner]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['role', 'is_active']
    search_fields = ['full_name', 'phone']
