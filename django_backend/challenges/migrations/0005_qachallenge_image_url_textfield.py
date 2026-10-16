from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('challenges', '0004_debatecomment_side'),
    ]

    operations = [
        migrations.AlterField(
            model_name='qachallenge',
            name='image_url',
            field=models.TextField(blank=True),
        ),
    ]
