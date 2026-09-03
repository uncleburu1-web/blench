from rest_framework import viewsets, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from core.permissions import IsOwnerOrReadOnly
from core.mixins import ShopScopedMixin
from .models import InventoryItem, StockBatch
from .serializers import InventoryItemSerializer, InventoryItemDetailSerializer, StockBatchSerializer


class InventoryItemViewSet(ShopScopedMixin, viewsets.ModelViewSet):
    queryset = InventoryItem.objects.filter(is_deleted=False)
    permission_classes = [IsOwnerOrReadOnly]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['category']
    search_fields = ['name', 'short_code', 'barcode', 'brand', 'category']
    ordering_fields = ['name', 'updated_at']

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return InventoryItemDetailSerializer
        return InventoryItemSerializer

    @action(detail=False, methods=['get'], url_path='by-barcode')
    def by_barcode(self, request):
        """GET /api/inventory/items/by-barcode/?code=<scanned value> — exact-match
        lookup for a barcode scanner, which types fast and hits Enter; a fuzzy
        `search=` match isn't the right tool for that, this is."""
        code = request.query_params.get('code', '').strip()
        if not code:
            return Response({'detail': 'code query param is required.'}, status=400)
        item = self.get_queryset().filter(barcode=code).first()
        if item is None:
            return Response({'detail': 'No product with that barcode.'}, status=404)
        return Response(InventoryItemSerializer(item).data)

    @action(detail=False, methods=['get'])
    def low_stock(self, request):
        items = [i for i in self.get_queryset() if i.is_low_stock]
        return Response(InventoryItemSerializer(items, many=True).data)

    @action(detail=True, methods=['get', 'post'], url_path='batches')
    def batches(self, request, pk=None):
        item = self.get_object()
        if request.method == 'GET':
            qs = item.batches.filter(is_deleted=False)
            return Response(StockBatchSerializer(qs, many=True).data)

        data = {**request.data, 'item': item.id}
        serializer = StockBatchSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save(shop=self.get_current_shop())
        item.refresh_from_db()
        return Response(InventoryItemDetailSerializer(item).data, status=201)


class StockBatchViewSet(ShopScopedMixin, viewsets.ModelViewSet):
    """Direct access to individual batches — editing, write-offs, deletion."""
    queryset = StockBatch.objects.filter(is_deleted=False).select_related('item', 'supplier')
    permission_classes = [IsOwnerOrReadOnly]
    serializer_class = StockBatchSerializer
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['item']
    ordering_fields = ['expiry_date', 'received_date']
