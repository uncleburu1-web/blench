from django.contrib.auth.models import User
from rest_framework import serializers
from .models import Worker


class WorkerSerializer(serializers.ModelSerializer):
    can_login = serializers.ReadOnlyField()
    username = serializers.SerializerMethodField()

    # Write-only, used only when creating/updating a login-enabled worker.
    login_username = serializers.CharField(write_only=True, required=False, allow_blank=True)
    login_password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Worker
        fields = [
            'id', 'full_name', 'role', 'phone', 'salary', 'hire_date', 'is_active',
            'notes', 'can_login', 'username', 'login_username', 'login_password', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def get_username(self, obj):
        return obj.user.username if obj.user else None

    def validate(self, attrs):
        username = attrs.get('login_username')
        password = attrs.get('login_password')
        if username and not password and not self.instance:
            raise serializers.ValidationError('Set a password for this worker\'s login.')
        if username:
            qs = User.objects.filter(username=username)
            if self.instance and self.instance.user_id:
                qs = qs.exclude(id=self.instance.user_id)
            if qs.exists():
                raise serializers.ValidationError({'login_username': 'That username is already taken.'})
        return attrs

    def create(self, validated_data):
        username = validated_data.pop('login_username', '')
        password = validated_data.pop('login_password', '')
        worker = Worker.objects.create(**validated_data)
        if username and password:
            user = User.objects.create_user(username=username, password=password)
            worker.user = user
            worker.save(update_fields=['user'])
        return worker

    def update(self, instance, validated_data):
        username = validated_data.pop('login_username', '')
        password = validated_data.pop('login_password', '')

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if username and password and not instance.user_id:
            user = User.objects.create_user(username=username, password=password)
            instance.user = user
            instance.save(update_fields=['user'])
        elif instance.user_id and password:
            instance.user.set_password(password)
            instance.user.save(update_fields=['password'])

        if instance.user_id:
            # Keep the login account's active state in sync with the worker record.
            if instance.user.is_active != instance.is_active:
                instance.user.is_active = instance.is_active
                instance.user.save(update_fields=['is_active'])

        return instance
