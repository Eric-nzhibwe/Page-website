"""
Messenger serializers for ARTX Platform
"""
from rest_framework import serializers
from .models import Conversation, Message
from users.models import User


class ParticipantSerializer(serializers.ModelSerializer):
    """Minimal user info attached to conversations and messages."""
    profile_image_url = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()

    class Meta:
        model  = User
        fields = ['id', 'username', 'display_name', 'access_tier',
                  'prestige_points', 'profile_image_url']

    def get_profile_image_url(self, obj):
        request = self.context.get('request')
        if not obj.profile_image:
            return None
        try:
            if obj.profile_image.storage.exists(obj.profile_image.name):
                if request:
                    return request.build_absolute_uri(obj.profile_image.url)
                return obj.profile_image.url
        except Exception:
            pass
        return None

    def get_display_name(self, obj):
        return obj.display_name or obj.username


class MessageSerializer(serializers.ModelSerializer):
    """Individual message."""
    sender        = ParticipantSerializer(read_only=True)
    media_url     = serializers.SerializerMethodField()

    class Meta:
        model  = Message
        fields = [
            'id', 'conversation', 'sender', 'message_type',
            'text', 'media_url', 'media_duration',
            'timestamp', 'read',
        ]
        read_only_fields = ['id', 'timestamp', 'read']

    def get_media_url(self, obj):
        if not obj.media_file:
            return None
        request = self.context.get('request')
        try:
            if request:
                return request.build_absolute_uri(obj.media_file.url)
            return obj.media_file.url
        except Exception:
            return None


class ConversationListSerializer(serializers.ModelSerializer):
    """
    Conversation summary used in the sidebar list.
    Includes the other participant's profile and the last message.
    """
    participants  = ParticipantSerializer(many=True, read_only=True)
    last_message  = serializers.SerializerMethodField()
    unread_count  = serializers.SerializerMethodField()

    class Meta:
        model  = Conversation
        fields = ['id', 'participants', 'last_message', 'unread_count',
                  'created_at', 'updated_at']

    def get_last_message(self, obj):
        msg = obj.get_last_message()
        if not msg:
            return None
        return {
            'id':           msg.id,
            'message_type': msg.message_type,
            'text':         msg.text,
            'sender_id':    msg.sender_id,
            'timestamp':    msg.timestamp.isoformat(),
            'read':         msg.read,
        }

    def get_unread_count(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return 0
        return obj.messages.filter(read=False).exclude(
            sender=request.user
        ).count()


class ConversationDetailSerializer(ConversationListSerializer):
    """
    Full conversation detail — includes first page of messages.
    Used when opening a conversation.
    """
    messages = serializers.SerializerMethodField()

    class Meta(ConversationListSerializer.Meta):
        fields = ConversationListSerializer.Meta.fields + ['messages']

    def get_messages(self, obj):
        # Return last 50 messages oldest-first
        msgs = obj.messages.order_by('-timestamp')[:50]
        msgs = list(reversed(msgs))
        return MessageSerializer(
            msgs, many=True, context=self.context
        ).data
