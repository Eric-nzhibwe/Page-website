"""
Migration 0004 — Change Message.firebase_media_url from URLField to TextField.

Reason: base64 data URIs (used to store audio voice messages server-side,
bypassing Cloudinary's image-only upload restriction) are not valid URLs and
easily exceed the previous 1024-character limit, causing a ValidationError
and a 500 response on every voice message send.

A TextField has no length limit and no URL format validation, making it
suitable for both Firebase Storage URLs and base64 data URIs.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('messenger', '0003_add_firebase_media_url_to_message'),
    ]

    operations = [
        migrations.AlterField(
            model_name='message',
            name='firebase_media_url',
            field=models.TextField(blank=True, null=True),
        ),
    ]
