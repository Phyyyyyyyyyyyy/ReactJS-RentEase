"""Accounts API: session, sign in/out, registration, profile, dashboards."""
from django.contrib.auth import login, logout
from django.db.models import Count
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .api_utils import error, form_errors, iso, money, user_brief, user_json
from .forms import LoginForm, ProfileForm, RegistrationForm
from .models import User

Role = User.Role


@ensure_csrf_cookie
@api_view(['GET'])
@permission_classes([AllowAny])
def session(request):
    """Who is signed in (or null). Also sets the CSRF cookie the React app needs."""
    user = request.user
    return Response({'user': user_json(user) if user.is_authenticated else None})


@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    form = LoginForm(request._request, data=request.data)
    if not form.is_valid():
        errors = form.non_field_errors()
        return form_errors(form, message=errors[0] if errors else 'Please fix the errors below.')
    user = form.get_user()
    login(request._request, user)
    return Response({'user': user_json(user), 'message': f'Welcome back, {user.first_name or user.username}!'})


@api_view(['POST'])
@permission_classes([AllowAny])
def logout_view(request):
    logout(request._request)
    return Response({'message': 'You have been signed out.'})


@api_view(['POST'])
@permission_classes([AllowAny])
def register(request):
    if request.user.is_authenticated:
        return error('You are already signed in.')
    form = RegistrationForm(request.data)
    if not form.is_valid():
        return form_errors(form)
    form.save()  # UserCreationForm hashes the password via set_password()
    return Response({'message': 'Account created successfully. You can now sign in.'}, status=201)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def profile(request):
    # Always request.user: there is no user id in the URL, so nobody can view or edit someone else's profile.
    if request.method == 'GET':
        return Response({'user': user_json(request.user)})
    form = ProfileForm(request.data, request.FILES, instance=request.user)
    if not form.is_valid():
        request.user.refresh_from_db()  # undo the form's in-memory changes
        return form_errors(form)
    user = form.save()
    return Response({'user': user_json(user), 'message': 'Profile updated successfully.'})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def badges(request):
    """Sidebar "needs attention" counts."""
    from payments.models import Payment
    from properties.models import Application

    user = request.user
    pending_applications = pending_payments = 0
    if user.role == Role.TENANT:
        pending_applications = user.applications.filter(status=Application.Status.PENDING).count()
    elif user.role == Role.OWNER:
        pending_applications = Application.objects.filter(unit__property__owner=user,
                                                          status=Application.Status.PENDING).count()
        pending_payments = Payment.objects.filter(tenancy__unit__property__owner=user,
                                                  status=Payment.Status.PENDING).count()
    return Response({'pending_applications': pending_applications, 'pending_payments': pending_payments})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard(request):
    """The numbers for the signed-in user's own dashboard (one per role)."""
    builders = {Role.ADMIN: _admin, Role.OWNER: _owner, Role.TENANT: _tenant, Role.STAFF: _staff}
    return Response({'role': request.user.role, **builders[request.user.role](request.user)})


def _admin(user):
    counts = dict(User.objects.values_list('role').annotate(n=Count('id')))
    return {
        'total_users': User.objects.count(),
        'active_users': User.objects.filter(is_active=True).count(),
        'role_counts': [{'role': value, 'label': label, 'count': counts.get(value, 0)} for value, label in Role.choices],
        'recent_users': [
            {**user_brief(u, contact=True), 'role_display': u.get_role_display(), 'is_active': u.is_active,
             'date_joined': iso(u.date_joined)}
            for u in User.objects.order_by('-date_joined')[:8]
        ],
    }


def _owner(user):
    from payments.models import Payment
    from properties.models import Application, Unit

    units = Unit.objects.filter(property__owner=user)
    pending = Application.objects.filter(unit__property__owner=user, status=Application.Status.PENDING)
    return {
        'payments_to_confirm': Payment.objects.filter(tenancy__unit__property__owner=user,
                                                      status=Payment.Status.PENDING).count(),
        'property_count': user.properties.count(),
        'unit_count': units.count(),
        'vacant_units': units.filter(status=Unit.Status.VACANT).count(),
        'app_pending': pending.count(),
        'recent_pending': [
            {'id': a.pk, 'tenant': user_brief(a.tenant), 'property_name': a.unit.property.name,
             'unit_name': a.unit.name, 'created_at': iso(a.created_at)}
            for a in pending.select_related('tenant', 'unit__property')[:5]
        ],
    }


def _tenant(user):
    from payments.billing import ledgers_for, tenancies_for
    from properties.models import Application, Unit

    apps = user.applications
    ledgers = [l for l in ledgers_for(tenancies_for(tenant=user)) if l.active or l.balance]
    return {
        'rent': [
            {'tenancy_id': l.tenancy.pk, 'property_name': l.tenancy.unit.property.name,
             'unit_name': l.tenancy.unit.name, 'balance': money(l.balance), 'overdue': money(l.overdue),
             'credit': money(l.credit), 'pending_total': money(l.pending_total), 'pending_count': l.pending_count,
             'tenancy_start': iso(l.tenancy.tenancy_start),
             'current': {'period': iso(l.current.charge.period), 'due_date': iso(l.current.charge.due_date)}
             if l.current else None}
            for l in ledgers
        ],
        'vacant_units': Unit.objects.filter(status=Unit.Status.VACANT).count(),
        'app_total': apps.count(),
        'app_pending': apps.filter(status=Application.Status.PENDING).count(),
        'app_approved': apps.filter(status=Application.Status.APPROVED).count(),
    }


def _staff(user):
    return {
        'tenant_count': User.objects.filter(role=Role.TENANT, is_active=True).count(),
        'owner_count': User.objects.filter(role=Role.OWNER, is_active=True).count(),
    }
