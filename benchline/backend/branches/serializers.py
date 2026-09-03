from rest_framework import serializers

from core.models import Shop
from staff.models import Worker


class BranchSerializer(serializers.ModelSerializer):
    manager = serializers.PrimaryKeyRelatedField(queryset=Worker.objects.all(), required=False, allow_null=True)
    manager_name = serializers.CharField(source='manager.full_name', read_only=True, default=None)
    is_operational = serializers.ReadOnlyField()

    class Meta:
        model = Shop
        fields = [
            'id', 'name', 'branch_code', 'address', 'phone', 'email',
            'manager', 'manager_name', 'status', 'is_operational', 'opening_date',
            'timezone', 'currency', 'description', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate(self, attrs):
        # The DB-level UniqueConstraint (organization, branch_code) is the
        # real guarantee, but hitting it directly means an IntegrityError
        # crashes as a raw 500 instead of a clean validation message —
        # catch it here first so a duplicate code is just an ordinary 400.
        code = attrs.get('branch_code', '').strip()
        if code:
            request = self.context.get('request')
            org = getattr(request, '_resolved_organization', None)
            if org is not None:
                qs = org.branches.filter(branch_code=code)
                if self.instance is not None:
                    qs = qs.exclude(pk=self.instance.pk)
                if qs.exists():
                    raise serializers.ValidationError(
                        {'branch_code': f'"{code}" is already used by another branch in this organization.'}
                    )
        return attrs

    def validate_manager(self, worker):
        # A branch's manager must be a worker somewhere in the SAME
        # organization -- never let one CEO assign another org's staff
        # member (or vice versa) as a manager just by guessing a Worker ID.
        request = self.context.get('request')
        org = getattr(request, '_resolved_organization', None)
        if worker is not None and org is not None and (worker.shop_id is None or worker.shop.organization_id != org.id):
            raise serializers.ValidationError('That worker is not part of this organization.')
        return worker
