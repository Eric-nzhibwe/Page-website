# Generated migration for media support

from django.db import migrations, models
import messenger.models


class Migration(migrations.Migration):

    dependencies = [
        ('messenger', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='message_type',
            field=models.CharField(choices=[('text', 'Text'), ('image', 'Image'), ('video', 'Video'), ('audio', 'Audio'), ('file', 'File')], default='text', max_length=10),
        ),
        migrations.AddField(
            model_name='message',
            name='media_file',
            field=models.FileField(blank=True, null=True, upload_to=messenger.models.message_media_path),
        ),
        migrations.AddField(
            model_name='message',
            name='media_thumbnail',
            field=models.ImageField(blank=True, null=True, upload_to=messenger.models.message_media_path),
        ),
        migrations.AddField(
            model_name='message',
            name='media_duration',
            field=models.IntegerField(blank=True, help_text='Duration in seconds for audio/video', null=True),
        ),
        migrations.AlterField(
            model_name='message',
            name='text',
            field=models.TextField(blank=True, null=True),
        ),
    ]
