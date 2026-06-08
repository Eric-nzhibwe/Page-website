"""
Chatbot serializers
"""
from rest_framework import serializers
from .models import ChatConversation, ChatMessage


class ChatMessageSerializer(serializers.ModelSerializer):
    """Chat message serializer"""
    
    class Meta:
        model = ChatMessage
        fields = ['id', 'role', 'content', 'metadata', 'created_at']
        read_only_fields = ['id', 'created_at']


class ChatConversationSerializer(serializers.ModelSerializer):
    """Chat conversation serializer"""
    messages = ChatMessageSerializer(many=True, read_only=True)
    message_count = serializers.SerializerMethodField()
    
    class Meta:
        model = ChatConversation
        fields = ['id', 'title', 'is_active', 'message_count', 'messages', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']
    
    def get_message_count(self, obj):
        return obj.messages.count()


class ChatRequestSerializer(serializers.Serializer):
    """Chat request serializer"""
    message = serializers.CharField(max_length=2000)
    conversation_id = serializers.IntegerField(required=False, allow_null=True)
