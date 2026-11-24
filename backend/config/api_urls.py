"""All JSON endpoints the React app calls, under /api/."""
from django.urls import path, re_path

from accounts import api as accounts
from payments import api as payments
from properties import api as properties

urlpatterns = [
    # Accounts
    path('auth/session/', accounts.session),
    path('auth/login/', accounts.login_view),
    path('auth/logout/', accounts.logout_view),
    path('auth/register/', accounts.register),
    path('profile/', accounts.profile),
    path('dashboard/', accounts.dashboard),
    path('badges/', accounts.badges),

    # Tenant: browse and apply
    path('browse/', properties.browse),
    path('browse/<int:pk>/', properties.property_detail),
    path('browse/<int:pk>/apply/', properties.apply),
    path('applications/', properties.my_applications),
    path('applications/<int:pk>/', properties.application_detail),
    path('applications/<int:pk>/withdraw/', properties.withdraw),

    # Owner: properties, units, applications
    path('owner/properties/', properties.owner_properties),
    path('owner/properties/<int:pk>/', properties.owner_property),
    path('owner/properties/<int:pk>/units/', properties.owner_unit_create),
    path('owner/units/<int:pk>/', properties.owner_unit),
    path('owner/applications/', properties.owner_applications),
    re_path(r'^owner/applications/(?P<pk>\d+)/(?P<decision>approve|reject)/$', properties.owner_application_decide),

    # Rent payments
    path('payments/', payments.tenant_payments),
    path('payments/<int:pk>/gcash/', payments.gcash_pay),
    path('payments/submissions/<int:pk>/cancel/', payments.cancel_submission),
    path('owner/payments/', payments.owner_payments),
    path('owner/payments/tenancy/<int:pk>/', payments.owner_tenancy),
    re_path(r'^owner/payments/(?P<pk>\d+)/(?P<decision>confirm|reject|void)/$', payments.owner_review),
]
