from rest_framework import viewsets, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from core.mixins import ShopScopedMixin
from .models import RepairTicket
from .serializers import RepairTicketSerializer, AddPaymentSerializer


class RepairTicketViewSet(ShopScopedMixin, viewsets.ModelViewSet):
    queryset = RepairTicket.objects.filter(is_deleted=False)
    serializer_class = RepairTicketSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['status', 'payment_status']
    search_fields = ['ticket_no', 'customer_name', 'device']
    ordering_fields = ['date_in', 'status']

    @action(detail=True, methods=['post'], url_path='add-payment')
    def add_payment(self, request, pk=None):
        ticket = self.get_object()
        serializer = AddPaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ticket.apply_payment(serializer.validated_data['amount'])
        return Response(RepairTicketSerializer(ticket).data)
