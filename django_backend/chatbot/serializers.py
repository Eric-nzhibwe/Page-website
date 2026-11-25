from rest_framework import serializers
from .models import ChatSession, ChatMessage


class ChatMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ChatMessage
        fields = ['id', 'role', 'content', 'meta', 'created_at']
        read_only_fields = fields


class ChatSessionSerializer(serializers.ModelSerializer):
    messages      = ChatMessageSerializer(many=True, read_only=True)
    message_count = serializers.SerializerMethodField()

    class Meta:
        model  = ChatSession
        fields = ['id', 'title', 'message_count', 'messages', 'created_at', 'updated_at']
        read_only_fields = fields

    def get_message_count(self, obj):
        return obj.messages.count()


class ChatSessionListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for sidebar list — no messages included."""
    message_count = serializers.SerializerMethodField()

    class Meta:
        model  = ChatSession
        fields = ['id', 'title', 'message_count', 'updated_at']
        read_only_fields = fields

    def get_message_count(self, obj):
        return obj.messages.count()
