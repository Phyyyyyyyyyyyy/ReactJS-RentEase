"""Rent payments API for tenants and property owners.

Tenant queries are filtered by `tenant=request.user` and owner queries by
`unit__property__owner=request.user`, so nobody can see or change another
person's payments (they get a 404).
"""
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from accounts.api_utils import display_name, file_url, form_errors, iso, money, role_required, user_brief
from accounts.models import User

from .billing import build_ledger, is_active, latest_approved_by_unit, ledgers_for, tenancies_for
from .forms import GCashPaymentForm, RecordPaymentForm, RejectPaymentForm
from .models import Payment

TENANT = role_required(User.Role.TENANT)
OWNER = role_required(User.Role.OWNER)


def _ledger(tenancy):
    return build_ledger(tenancy, active=is_active(tenancy, latest_approved_by_unit([tenancy.unit_id])))


# ------------------------------------------------------------------ JSON shapes

def line_json(line):
    return {
        'period': iso(line.charge.period),
        'due_date': iso(line.charge.due_date),
        'amount': money(line.charge.amount),
        'paid': money(line.paid),
        'remaining': money(line.remaining),
        'through_total': money(line.through_total),
        'state': line.state,
        'label': line.label,
    }


def tenancy_json(t):
    unit, prop, owner = t.unit, t.unit.property, t.unit.property.owner
    return {
        'id': t.pk,
        'tenancy_start': iso(t.tenancy_start),
        'tenant': user_brief(t.tenant, contact=True),
        'unit': {
            'id': unit.pk, 'name': unit.name, 'monthly_rent': money(unit.monthly_rent),
            'property': {'id': prop.pk, 'name': prop.name},
        },
        'owner': {**user_brief(owner), 'phone': owner.phone, 'accepts_gcash': owner.accepts_gcash},
    }


def ledger_json(ledger):
    return {
        'tenancy': tenancy_json(ledger.tenancy),
        'active': ledger.active,
        'balance': money(ledger.balance),
        'credit': money(ledger.credit),
        'overdue': money(ledger.overdue),
        'total_charged': money(ledger.total_charged),
        'total_paid': money(ledger.total_paid),
        'pending_total': money(ledger.pending_total),
        'pending_count': ledger.pending_count,
        'months_covered': ledger.months_covered,
        'suggested_amount': money(ledger.suggested_amount),
        'current': line_json(ledger.current) if ledger.current else None,
        'lines': [line_json(l) for l in ledger.lines_newest_first],
    }


def payment_json(p, user):
    t = p.tenancy
    return {
        'id': p.pk,
        'amount': money(p.amount),
        'method': p.method,
        'method_display': p.get_method_display(),
        'reference_number': p.reference_number,
        'proof': file_url(p.proof),
        'paid_on': iso(p.paid_on),
        'note': p.note,
        'status': p.status,
        'status_display': p.get_status_display(),
        'owner_note': p.owner_note,
        'voided': p.status == Payment.Status.REJECTED and p.owner_note == 'Voided by owner',
        'created_at': iso(p.created_at),
        'recorded_by_owner': p.recorded_by_owner,
        'recorded_by_me': p.recorded_by_id == user.pk,
        'tenancy': {
            'id': t.pk,
            'tenant': user_brief(t.tenant),
            'unit': {'id': t.unit.pk, 'name': t.unit.name, 'property': {'name': t.unit.property.name}},
        },
    }


# ----------------------------------------------------------------------- tenant

@api_view(['GET'])
@permission_classes([TENANT])
def tenant_payments(request):
    ledgers = ledgers_for(tenancies_for(tenant=request.user))
    history = Payment.objects.filter(tenancy__tenant=request.user).select_related('tenancy__unit__property',
                                                                                  'tenancy__tenant')
    return Response({
        'ledgers': [ledger_json(l) for l in ledgers],
        'history': [payment_json(p, request.user) for p in history],
    })


@api_view(['GET', 'POST'])
@permission_classes([TENANT])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def gcash_pay(request, pk):
    tenancy = get_object_or_404(tenancies_for(tenant=request.user), pk=pk)
    owner = tenancy.unit.property.owner
    if not owner.accepts_gcash:
        return Response({'message': f'{display_name(owner)} has not set up GCash yet. '
                                    'Pay them in person, and they will record it here.'}, status=400)

    if request.method == 'GET':
        return Response({
            'ledger': ledger_json(_ledger(tenancy)),
            'gcash': {'name': owner.gcash_name, 'number': owner.gcash_number, 'qr': file_url(owner.gcash_qr)},
            'today': iso(timezone.localdate()),
        })

    form = GCashPaymentForm(request.data, request.FILES)
    if not form.is_valid():
        return form_errors(form)
    payment = form.save(commit=False)
    payment.tenancy, payment.method, payment.recorded_by = tenancy, Payment.Method.GCASH, request.user
    try:
        payment.save()
    except IntegrityError:  # same reference submitted at the same moment by another request
        return Response({'message': 'Please fix the errors below.',
                         'errors': {'reference_number': ['This reference number has already been submitted.']}},
                        status=400)
    return Response({'message': f'GCash payment of ₱{payment.amount:,.2f} submitted. '
                                'It will count toward your balance once the owner confirms it.'}, status=201)


@api_view(['POST'])
@permission_classes([TENANT])
def cancel_submission(request, pk):
    payment = get_object_or_404(Payment, pk=pk, tenancy__tenant=request.user, recorded_by=request.user,
                                status=Payment.Status.PENDING)
    payment.delete()
    return Response({'message': 'GCash submission cancelled.'})


# ------------------------------------------------------------------------ owner

@api_view(['GET'])
@permission_classes([OWNER])
def owner_payments(request):
    ledgers = ledgers_for(tenancies_for(unit__property__owner=request.user))
    ledgers.sort(key=lambda l: (not l.active, -l.balance, l.tenancy.unit.property.name, l.tenancy.unit.name))
    pending = (Payment.objects.filter(tenancy__unit__property__owner=request.user, status=Payment.Status.PENDING)
               .select_related('tenancy__tenant', 'tenancy__unit__property').order_by('created_at'))
    return Response({
        'ledgers': [ledger_json(l) for l in ledgers],
        'pending': [payment_json(p, request.user) for p in pending],
        'outstanding': money(sum((l.balance for l in ledgers), 0)),
        'gcash_ready': request.user.accepts_gcash,
    })


@api_view(['GET', 'POST'])
@permission_classes([OWNER])
def owner_tenancy(request, pk):
    tenancy = get_object_or_404(tenancies_for(unit__property__owner=request.user), pk=pk)
    if request.method == 'POST':
        form = RecordPaymentForm(request.data)
        if not form.is_valid():
            return form_errors(form)
        payment = form.save(commit=False)
        payment.tenancy, payment.recorded_by = tenancy, request.user
        payment.status, payment.reviewed_at = Payment.Status.CONFIRMED, timezone.now()
        try:
            payment.save()
        except IntegrityError:
            return Response({'message': 'Please fix the errors below.',
                             'errors': {'reference_number': ['This GCash reference number is already recorded.']}},
                            status=400)
        after = _ledger(tenancy)
        status = (f'₱{after.balance:,.2f} still owed.' if after.balance
                  else f'Fully paid, with ₱{after.credit:,.2f} credit for future months.' if after.credit
                  else 'Fully paid.')
        return Response({'message': f'Recorded ₱{payment.amount:,.2f} from {display_name(tenancy.tenant)}. {status}'},
                        status=201)

    history = tenancy.payments.select_related('recorded_by', 'tenancy__tenant', 'tenancy__unit__property')
    return Response({
        'ledger': ledger_json(_ledger(tenancy)),
        'history': [payment_json(p, request.user) for p in history],
        'today': iso(timezone.localdate()),
    })


@api_view(['POST'])
@permission_classes([OWNER])
def owner_review(request, pk, decision):
    with transaction.atomic():
        payment = get_object_or_404(
            Payment.objects.select_related('tenancy__tenant').select_for_update(of=('self',)),
            pk=pk, tenancy__unit__property__owner=request.user,
        )
        tenant = display_name(payment.tenancy.tenant)
        allowed = {'confirm': Payment.Status.PENDING, 'reject': Payment.Status.PENDING,
                   'void': Payment.Status.CONFIRMED}[decision]
        if payment.status != allowed:
            return Response({'message': 'That payment has already been handled.'}, status=400)

        payment.reviewed_at = timezone.now()
        if decision == 'confirm':
            payment.status = Payment.Status.CONFIRMED
            message = f'Confirmed ₱{payment.amount:,.2f} GCash payment from {tenant}.'
        else:
            form = RejectPaymentForm(request.data)
            reason = form.cleaned_data['reason'].strip() if form.is_valid() else ''
            payment.status = Payment.Status.REJECTED
            payment.owner_note = reason or ('Voided by owner' if decision == 'void' else '')
            verb = 'Voided' if decision == 'void' else 'Rejected'
            message = f'{verb} ₱{payment.amount:,.2f} payment from {tenant}. It no longer counts toward the balance.'
        payment.save(update_fields=['status', 'reviewed_at', 'owner_note'])
    return Response({'message': message})
