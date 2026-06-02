"""
Custom authentication backends for ARTX Platform.

Allows login with either email or username, case-insensitively.
"""
from django.contrib.auth.backends import ModelBackend
from django.contrib.auth import get_user_model

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
            # Run the default password hasher anyway to prevent timing attacks
            User().set_password(password)
            return None

        if user.check_password(password) and self.user_can_authenticate(user):
            return user

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
            return None
