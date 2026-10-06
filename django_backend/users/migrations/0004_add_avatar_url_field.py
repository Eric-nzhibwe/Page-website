from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0003_add_profile_and_preferences_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='avatar_url',
            field=models.TextField(blank=True, default='',
                                   help_text='Persistent avatar URL (base64 data URI or CDN URL). '
                                             'Set by the avatar upload endpoint — does not use file storage.'),
        ),
    ]
