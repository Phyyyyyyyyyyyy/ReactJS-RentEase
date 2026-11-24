"""Properties API.

Tenant endpoints filter by `tenant=request.user` and owner endpoints by
`owner=request.user`, so nobody can view or change another person's
properties, units, or applications (they get a 404).
"""
from django.db import transaction
from django.db.models import Count, Min, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from accounts.api_utils import display_name, form_errors, iso, money, role_required, user_brief
from accounts.models import User

from .forms import ApplicationEditForm, ApplicationForm, BrowseFilterForm, PropertyForm, UnitForm
from .models import Application, Property, Unit

TENANT = role_required(User.Role.TENANT)
OWNER = role_required(User.Role.OWNER)
VACANT = Q(units__status=Unit.Status.VACANT)


# ------------------------------------------------------------------ JSON shapes

def property_json(p):
    data = {
        'id': p.pk,
        'name': p.name,
        'property_type': p.property_type,
        'type_display': p.get_property_type_display(),
        'address': p.address,
        'city': p.city,
        'description': p.description,
        'amenities': p.amenities,
        'amenity_list': p.amenity_list,
    }
    for extra in ('vacant_count', 'unit_count', 'pending_count'):
        if hasattr(p, extra):
            data[extra] = getattr(p, extra)
    if hasattr(p, 'min_rent'):
        data['min_rent'] = money(p.min_rent)
    return data


def unit_json(u):
    data = {
        'id': u.pk,
        'name': u.name,
        'bedrooms': u.bedrooms,
        'bathrooms': u.bathrooms,
        'floor_area': u.floor_area,
        'monthly_rent': money(u.monthly_rent),
        'status': u.status,
        'is_vacant': u.is_vacant,
    }
    if hasattr(u, 'pending_count'):
        data['pending_count'] = u.pending_count
    return data


def application_json(a, *, for_owner=False):
    unit, prop = a.unit, a.unit.property
    data = {
        'id': a.pk,
        'status': a.status,
        'status_display': a.get_status_display(),
        'message': a.message,
        'preferred_move_in': iso(a.preferred_move_in),
        'created_at': iso(a.created_at),
        'can_withdraw': a.can_withdraw,
        'unit': {
            'id': unit.pk, 'name': unit.name, 'monthly_rent': money(unit.monthly_rent), 'is_vacant': unit.is_vacant,
            'property': {'id': prop.pk, 'name': prop.name, 'address': prop.address, 'city': prop.city},
        },
    }
    if for_owner:
        data['tenant'] = user_brief(a.tenant, contact=True)
    return data


def status_tabs(applications, *, all_first):
    counts = {s: 0 for s, _ in Application.Status.choices}
    counts.update(dict(applications.values_list('status').annotate(n=Count('id')).order_by()))
    tabs = [{'value': s, 'label': label, 'count': counts[s]} for s, label in Application.Status.choices]
    everything = {'value': '' if all_first else 'all', 'label': 'All', 'count': sum(counts.values())}
    return ([everything] + tabs) if all_first else (tabs + [everything]), counts


# ----------------------------------------------------------------------- tenant

@api_view(['GET'])
@permission_classes([TENANT])
def browse(request):
    form = BrowseFilterForm(request.query_params or None)
    properties = (
        Property.objects
        .annotate(vacant_count=Count('units', filter=VACANT), min_rent=Min('units__monthly_rent', filter=VACANT))
        .filter(vacant_count__gt=0)
        .order_by('name')  # Meta.ordering is not applied to aggregate (GROUP BY) queries
    )
    invalid = False
    if form.is_bound:
        if form.is_valid():
            q, ptype, max_rent = form.cleaned_data['q'], form.cleaned_data['type'], form.cleaned_data['max_rent']
            if q:
                properties = properties.filter(Q(name__icontains=q) | Q(address__icontains=q) | Q(city__icontains=q))
            if ptype:
                properties = properties.filter(property_type=ptype)
            if max_rent is not None:
                properties = properties.filter(min_rent__lte=max_rent)
        else:
            invalid = True
    return Response({'properties': [property_json(p) for p in properties], 'invalid_filter': invalid})


@api_view(['GET'])
@permission_classes([TENANT])
def property_detail(request, pk):
    prop = get_object_or_404(Property.objects.select_related('owner'), pk=pk)
    pending_unit_ids = list(
        request.user.applications.filter(status=Application.Status.PENDING, unit__property=prop)
        .values_list('unit_id', flat=True)
    )
    units = list(prop.units.all())
    return Response({
        'property': property_json(prop),
        'owner': {'full_name': display_name(prop.owner), 'phone': prop.owner.phone},
        'units': [unit_json(u) for u in units],
        'pending_unit_ids': pending_unit_ids,
        'can_apply': any(u.is_vacant for u in units),
    })


@api_view(['POST'])
@permission_classes([TENANT])
def apply(request, pk):
    prop = get_object_or_404(Property, pk=pk)
    form = ApplicationForm(request.data, property_obj=prop, tenant=request.user)
    if not form.is_valid():
        return form_errors(form)
    application = form.save(commit=False)
    application.tenant = request.user
    application.save()
    return Response({
        'id': application.pk,
        'message': f'Application for {application.unit.name} submitted. The owner will review it soon.',
    }, status=201)


@api_view(['GET'])
@permission_classes([TENANT])
def my_applications(request):
    status = request.query_params.get('status', '')
    applications = request.user.applications.select_related('unit__property')
    tabs, counts = status_tabs(applications, all_first=True)
    if status in counts:
        applications = applications.filter(status=status)
    else:
        status = ''
    return Response({
        'status': status,
        'status_tabs': tabs,
        'applications': [application_json(a) for a in applications],
    })


@api_view(['GET', 'PUT'])
@permission_classes([TENANT])
def application_detail(request, pk):
    # Filtering by tenant means a tenant can only see and edit their own applications.
    application = get_object_or_404(Application.objects.select_related('unit__property'), pk=pk, tenant=request.user)
    if request.method == 'GET':
        return Response({'application': application_json(application)})
    if not application.can_withdraw:
        return Response({'message': 'Only pending applications can be edited.'}, status=400)
    form = ApplicationEditForm(request.data, instance=application)
    if not form.is_valid():
        return form_errors(form)
    form.save()
    return Response({'message': f'Application for {application.unit.name} updated.'})


@api_view(['POST'])
@permission_classes([TENANT])
def withdraw(request, pk):
    application = get_object_or_404(Application.objects.select_related('unit'), pk=pk, tenant=request.user)
    if not application.can_withdraw:
        return Response({'message': 'Only pending applications can be withdrawn.'}, status=400)
    application.status = Application.Status.WITHDRAWN
    application.save(update_fields=['status', 'updated_at'])
    return Response({'message': f'Application for {application.unit.name} withdrawn.'})


# ------------------------------------------------------------------------ owner

def owned_properties(user):
    return Property.objects.filter(owner=user)


@api_view(['GET', 'POST'])
@permission_classes([OWNER])
def owner_properties(request):
    if request.method == 'POST':
        form = PropertyForm(request.data, owner=request.user)
        if not form.is_valid():
            return form_errors(form)
        prop = form.save(commit=False)
        prop.owner = request.user
        prop.save()
        return Response({'property': property_json(prop),
                         'message': f'{prop.name} added. Now add its units so tenants can apply.'}, status=201)

    properties = (
        owned_properties(request.user)
        .annotate(
            unit_count=Count('units', distinct=True),
            vacant_count=Count('units', filter=Q(units__status=Unit.Status.VACANT), distinct=True),
            pending_count=Count('units__applications',
                                filter=Q(units__applications__status=Application.Status.PENDING), distinct=True),
        )
        .order_by('name')
    )
    return Response({'properties': [property_json(p) for p in properties]})


@api_view(['GET', 'PUT', 'DELETE'])
@permission_classes([OWNER])
def owner_property(request, pk):
    prop = get_object_or_404(owned_properties(request.user), pk=pk)
    if request.method == 'DELETE':
        name = prop.name
        prop.delete()  # cascades to its units and their applications
        return Response({'message': f'{name} deleted.'})
    if request.method == 'PUT':
        form = PropertyForm(request.data, instance=prop, owner=request.user)
        if not form.is_valid():
            return form_errors(form)
        form.save()
        return Response({'property': property_json(prop), 'message': f'{prop.name} updated.'})

    units = prop.units.annotate(
        pending_count=Count('applications', filter=Q(applications__status=Application.Status.PENDING)),
    ).order_by('name')
    return Response({'property': property_json(prop), 'units': [unit_json(u) for u in units]})


@api_view(['POST'])
@permission_classes([OWNER])
def owner_unit_create(request, pk):
    prop = get_object_or_404(owned_properties(request.user), pk=pk)
    form = UnitForm(request.data, property_obj=prop)
    if not form.is_valid():
        return form_errors(form)
    unit = form.save(commit=False)
    unit.property = prop
    unit.save()
    return Response({'unit': unit_json(unit), 'message': f'{unit.name} added to {prop.name}.'}, status=201)


@api_view(['GET', 'PUT', 'DELETE'])
@permission_classes([OWNER])
def owner_unit(request, pk):
    unit = get_object_or_404(Unit.objects.select_related('property'), pk=pk, property__owner=request.user)
    if request.method == 'DELETE':
        name = unit.name
        unit.delete()
        return Response({'message': f'{name} deleted.', 'property_id': unit.property_id})
    if request.method == 'PUT':
        form = UnitForm(request.data, instance=unit, property_obj=unit.property)
        if not form.is_valid():
            return form_errors(form)
        form.save()
        return Response({'unit': unit_json(unit), 'message': f'{unit.name} updated.'})
    return Response({'unit': unit_json(unit), 'property': {'id': unit.property.pk, 'name': unit.property.name}})


@api_view(['GET'])
@permission_classes([OWNER])
def owner_applications(request):
    status = request.query_params.get('status', Application.Status.PENDING)
    applications = (
        Application.objects.filter(unit__property__owner=request.user)
        .select_related('tenant', 'unit__property')
    )
    tabs, counts = status_tabs(applications, all_first=False)
    if status in counts:
        applications = applications.filter(status=status)
    else:
        status = 'all'
    return Response({
        'status': status,
        'status_tabs': tabs,
        'applications': [application_json(a, for_owner=True) for a in applications],
    })


@api_view(['POST'])
@permission_classes([OWNER])
def owner_application_decide(request, pk, decision):
    with transaction.atomic():
        application = get_object_or_404(
            Application.objects.select_related('tenant', 'unit').select_for_update(of=('self',)),
            pk=pk, unit__property__owner=request.user,
        )
        tenant_name = display_name(application.tenant)
        if application.status != Application.Status.PENDING:
            return Response({'message': 'Only pending applications can be approved or rejected.'}, status=400)

        if decision == 'reject':
            application.status = Application.Status.REJECTED
            application.save(update_fields=['status', 'updated_at'])
            return Response({'message': f"{tenant_name}'s application for {application.unit.name} rejected."})

        unit = Unit.objects.select_for_update().get(pk=application.unit_id)
        if not unit.is_vacant:
            return Response({'message': f'{unit.name} is already occupied. Mark it vacant first, '
                                        'or reject this application.'}, status=400)
        application.status = Application.Status.APPROVED
        application.approved_at = timezone.now()
        application.save(update_fields=['status', 'approved_at', 'updated_at'])
        unit.status = Unit.Status.OCCUPIED
        unit.save(update_fields=['status'])
        # The unit is taken now, so every other pending application for it is rejected.
        others = unit.applications.filter(status=Application.Status.PENDING).exclude(pk=application.pk)
        rejected = others.update(status=Application.Status.REJECTED, updated_at=timezone.now())

    note = f' {rejected} other pending application{"s were" if rejected != 1 else " was"} rejected.' if rejected else ''
    return Response({'message': f'{tenant_name} approved for {unit.name}. The unit is now marked occupied.{note}'})
