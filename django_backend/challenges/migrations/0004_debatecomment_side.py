from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('challenges', '0003_polls_debates_qa_xpoints'),
    ]

    operations = [
        migrations.AddField(
            model_name='debatecomment',
            name='side',
            field=models.CharField(
                choices=[('a', 'Side A'), ('b', 'Side B')],
                default='b',
                help_text='Which side of the debate this comment supports',
                max_length=1,
            ),
        ),
    ]
