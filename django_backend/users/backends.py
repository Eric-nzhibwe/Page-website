"""
Custom authentication backends for PAGE Platform.

Allows login with either email or username, case-insensitively.
"""
import logging
from django.contrib.auth.backends import ModelBackend
from django.contrib.auth import get_user_model

logger = logging.getLogger(__name__)
User = get_user_model()


class EmailOrUsernameBackend(ModelBackend):
    """
    Authenticates against email OR username (case-insensitive).

    Django's default backend only matches USERNAME_FIELD exactly.
    Since our USERNAME_FIELD is 'email', logging in by username would
    otherwise fail. This backend resolves both forms cleanly.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        if not username or not password:
            return None

        # Resolve to a User object by email or username
        user = self._get_user(username)
        if user is None:
            logger.warning(
                'EmailOrUsernameBackend: no user found for identifier=%r', username
            )
            # Run the default password hasher anyway to prevent timing attacks
            User().set_password(password)
            return None

        if not user.has_usable_password():
            logger.warning(
                'EmailOrUsernameBackend: user %r has no usable password '
                '(may have been created via Firebase — use firebase-login instead)',
                user.email,
            )
            return None

        if user.check_password(password) and self.user_can_authenticate(user):
            logger.info('EmailOrUsernameBackend: authenticated user %r', user.email)
            return user

        logger.warning(
            'EmailOrUsernameBackend: wrong password for user %r', user.email
        )
        return None

    def _get_user(self, identifier):
        """Return User by email or username (case-insensitive)."""
        try:
            if '@' in identifier:
                return User.objects.get(email__iexact=identifier)
            else:
                return User.objects.get(username__iexact=identifier)
        except User.DoesNotExist:
            return None
        except User.MultipleObjectsReturned:
            # Shouldn't happen due to unique constraints, but be safe
            logger.error(
                'EmailOrUsernameBackend: multiple users found for identifier=%r', identifier
            )
            return None
