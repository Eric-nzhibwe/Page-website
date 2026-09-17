from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('social', '0002_story_add_media_file'),
    ]

    operations = [
        # Allow content to be blank (voice/media posts may have no text)
        migrations.AlterField(
            model_name='post',
            name='content',
            field=models.TextField(max_length=5000, blank=True),
        ),
        # Add 'voice' post type
        migrations.AlterField(
            model_name='post',
            name='post_type',
            field=models.CharField(
                max_length=20,
                choices=[
                    ('text', 'Text'),
                    ('achievement', 'Achievement'),
                    ('challenge', 'Challenge'),
                    ('media', 'Media'),
                    ('voice', 'Voice'),
                ],
                default='text',
            ),
        ),
        # Allow 'audio' as a media_type
        migrations.AlterField(
            model_name='post',
            name='media_type',
            field=models.CharField(
                max_length=20,
                choices=[('image', 'Image'), ('video', 'Video'), ('audio', 'Audio')],
                blank=True,
            ),
        ),
        # Uploaded media file (image / video)
        migrations.AddField(
            model_name='post',
            name='media_file',
            field=models.FileField(upload_to='posts/media/', blank=True, null=True),
        ),
        # Uploaded voice file
        migrations.AddField(
            model_name='post',
            name='voice_file',
            field=models.FileField(upload_to='posts/voice/', blank=True, null=True),
        ),
        # Voice duration in seconds
        migrations.AddField(
            model_name='post',
            name='voice_duration',
            field=models.IntegerField(
                blank=True,
                null=True,
                help_text='Duration in seconds for voice posts',
            ),
        ),
    ]
