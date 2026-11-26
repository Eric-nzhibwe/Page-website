"""
0002_ensure_tables
------------------
Safety net: creates chat_sessions and chat_messages if they don't already
exist.  This runs even when Django thinks 0001_initial was already applied
(which can happen when the original migration was recorded in django_migrations
but the SQL never actually executed on the live database).
"""
from django.conf import settings
from django.db import migrations


def ensure_tables(apps, schema_editor):
    db = schema_editor.connection.vendor

    User       = apps.get_model(*settings.AUTH_USER_MODEL.split('.'))
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
        # SQLite (local dev)
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


class Migration(migrations.Migration):

    dependencies = [
        ('chatbot', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(ensure_tables, reverse_code=migrations.RunPython.noop),
    ]
