"""Shared pieces for the JSON API: authentication, role checks, and JSON helpers."""
from django.utils import timezone
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import BasePermission
from rest_framework.response import Response


class CsrfSessionAuthentication(SessionAuthentication):
    """Django session login (the same cookie the Django admin uses).

    DRF normally checks CSRF only for signed-in users. This checks it on every
    unsafe request, so the login and register endpoints are protected too.
    The React app sends the `csrftoken` cookie back in the X-CSRFToken header.
    """

    def authenticate(self, request):
        self.enforce_csrf(request)
        user = getattr(request._request, 'user', None)
        if not user or not user.is_active:
            return None
        return (user, None)

    def authenticate_header(self, request):
        # Having a value here makes DRF answer 401 (not 403) when nobody is signed in,
        # so the React app can tell "please sign in" apart from "wrong role".
        return 'Session'


def role_required(*roles):
    """Permission class: only signed-in users whose role is in `roles`."""

    class RolePermission(BasePermission):
        message = 'You do not have permission to open that page.'

        def has_permission(self, request, view):
            return bool(request.user and request.user.is_authenticated and request.user.role in roles)

    return RolePermission


def form_errors(form, message='Please fix the errors below.'):
    """400 response listing a Django form's errors as {field: [messages]}."""
    errors = {}
    for field, field_errors in form.errors.items():
        errors['non_field_errors' if field == '__all__' else field] = [str(e) for e in field_errors]
    return Response({'message': message, 'errors': errors}, status=400)


def error(message, status=400):
    return Response({'message': message}, status=status)


def money(value):
    """Decimals go out as strings ("8500.00") so no centavos are lost."""
    return None if value is None else f'{value:.2f}'


def iso(value):
    """Dates as YYYY-MM-DD; datetimes as ISO 8601 in Manila time."""
    if value is None:
        return None
    if hasattr(value, 'tzinfo'):
        return timezone.localtime(value).isoformat()
    return value.isoformat()


def file_url(field):
    return field.url if field else None


def display_name(user):
    return user.get_full_name() or user.username


def user_brief(user, *, contact=False):
    """Name and avatar of another person (an owner or a tenant)."""
    data = {
        'id': user.pk,
        'username': user.username,
        'full_name': display_name(user),
        'initials': user.initials,
        'photo': file_url(user.profile_photo),
    }
    if contact:
        data.update(email=user.email, phone=user.phone)
    return data


def user_json(user):
    """The signed-in user's own account."""
    data = {
        **user_brief(user, contact=True),
        'first_name': user.first_name,
        'last_name': user.last_name,
        'role': user.role,
        'role_display': user.get_role_display(),
        'is_active': user.is_active,
        'is_superuser': user.is_superuser,
        'date_joined': iso(user.date_joined),
        'last_login': iso(user.last_login),
    }
    if user.role == user.Role.OWNER:
        data.update(
            gcash_name=user.gcash_name,
            gcash_number=user.gcash_number,
            gcash_qr=file_url(user.gcash_qr),
            accepts_gcash=user.accepts_gcash,
        )
    return data
