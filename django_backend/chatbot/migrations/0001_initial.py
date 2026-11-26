from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def create_tables(apps, schema_editor):
    """
    Use raw SQL with IF NOT EXISTS so this is safe to run on a database that
    already has the tables (re-deploy, manual run, etc.) and will always
    create them on a fresh database regardless of migration history.
    """
    db = schema_editor.connection.vendor  # 'postgresql', 'sqlite', etc.

    User = apps.get_model(*settings.AUTH_USER_MODEL.split('.'))
    user_table = User._meta.db_table

    if db == 'postgresql':
        schema_editor.execute(f"""
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id         BIGSERIAL    PRIMARY KEY,
                title      VARCHAR(200) NOT NULL DEFAULT 'New chat',
                created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                user_id    INTEGER      NOT NULL
                    REFERENCES "{user_table}"(id) ON DELETE CASCADE
            )
        """)
        schema_editor.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id         BIGSERIAL   PRIMARY KEY,
                role       VARCHAR(12) NOT NULL,
                content    TEXT        NOT NULL,
                meta       JSONB       NOT NULL DEFAULT '{}',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                session_id BIGINT      NOT NULL
                    REFERENCES chat_sessions(id) ON DELETE CASCADE
            )
        """)
        schema_editor.execute("""
            CREATE INDEX IF NOT EXISTS chatmsg_session_idx
                ON chat_messages (session_id)
        """)
        schema_editor.execute("""
            CREATE INDEX IF NOT EXISTS chatsess_user_idx
                ON chat_sessions (user_id)
        """)
        schema_editor.execute("""
            CREATE INDEX IF NOT EXISTS chatsess_updated_idx
                ON chat_sessions (updated_at DESC)
        """)
    else:
        # SQLite fallback (local dev) — Django ORM handles this via CreateModel
        # state_operations below, but we still create the tables explicitly.
        schema_editor.execute(f"""
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                title      VARCHAR(200) NOT NULL DEFAULT 'New chat',
                created_at DATETIME     NOT NULL,
                updated_at DATETIME     NOT NULL,
                user_id    INTEGER      NOT NULL
                    REFERENCES "{user_table}"(id) DEFERRABLE INITIALLY DEFERRED
            )
        """)
        schema_editor.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                role       VARCHAR(12) NOT NULL,
                content    TEXT        NOT NULL,
                meta       TEXT        NOT NULL DEFAULT '{}',
                created_at DATETIME    NOT NULL,
                session_id INTEGER     NOT NULL
                    REFERENCES chat_sessions(id) DEFERRABLE INITIALLY DEFERRED
            )
        """)


def drop_tables(apps, schema_editor):
    schema_editor.execute("DROP TABLE IF EXISTS chat_messages")
    schema_editor.execute("DROP TABLE IF EXISTS chat_sessions")


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # RunPython physically creates the tables with IF NOT EXISTS
        migrations.RunPython(create_tables, reverse_code=drop_tables),

        # SeparateDatabaseAndState lets Django know what ORM state these tables
        # correspond to — without touching the DB a second time.
        migrations.SeparateDatabaseAndState(
            database_operations=[],   # DB already done above
            state_operations=[
                migrations.CreateModel(
                    name='ChatSession',
                    fields=[
                        ('id',         models.BigAutoField(auto_created=True, primary_key=True,
                                                           serialize=False, verbose_name='ID')),
                        ('title',      models.CharField(default='New chat', max_length=200)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('updated_at', models.DateTimeField(auto_now=True)),
                        ('user',       models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                                         related_name='chat_sessions',
                                                         to=settings.AUTH_USER_MODEL)),
                    ],
                    options={'db_table': 'chat_sessions', 'ordering': ['-updated_at']},
                ),
                migrations.CreateModel(
                    name='ChatMessage',
                    fields=[
                        ('id',         models.BigAutoField(auto_created=True, primary_key=True,
                                                           serialize=False, verbose_name='ID')),
                        ('role',       models.CharField(choices=[('user', 'User'),
                                                                  ('assistant', 'Assistant')],
                                                        max_length=12)),
                        ('content',    models.TextField()),
                        ('meta',       models.JSONField(blank=True, default=dict)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('session',    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                                         related_name='messages',
                                                         to='chatbot.chatsession')),
                    ],
                    options={'db_table': 'chat_messages', 'ordering': ['created_at']},
                ),
            ],
        ),
    ]
