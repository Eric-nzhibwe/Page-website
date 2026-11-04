from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('challenges', '0006_remove_debateparticipant_unique_debate_participant_and_more'),
    ]

    operations = [
        migrations.AlterUniqueTogether(
            name='qaanswer',
            unique_together={('qa', 'user')},
        ),
    ]
