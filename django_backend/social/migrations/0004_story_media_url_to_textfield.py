from django.db import migrations, models


class Migration(migrations.Migration):
    """
    Change Story.media_url from URLField to TextField so it can store
    base64 data URIs (data:image/jpeg;base64,...) as well as regular URLs.
    """

    dependencies = [
        ('social', '0003_post_media_file_voice'),
    ]

    operations = [
        migrations.AlterField(
            model_name='story',
            name='media_url',
            field=models.TextField(
                blank=True,
                default='',
                help_text='Base64 data URI (data:image/jpeg;base64,...) or external URL.',
            ),
        ),
    ]
