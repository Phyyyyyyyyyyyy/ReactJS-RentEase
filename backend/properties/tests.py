from datetime import timedelta

from django.utils import timezone

from accounts.models import User
from accounts.tests import ApiTestCase

from .models import Application, Property, Unit

PASSWORD = 'Str0ng-Pass!42'


def make_user(username, role):
    return User.objects.create_user(username=username, email=f'{username}@example.com', password=PASSWORD, role=role)


class PropertyTestCase(ApiTestCase):
    def setUp(self):
        self.owner = make_user('owner', User.Role.OWNER)
        self.tenant = make_user('tenant', User.Role.TENANT)
        self.apt = Property.objects.create(owner=self.owner, name='Lahug Apartments', property_type='apartment',
                                           address='Salinas Dr', city='Cebu City', amenities='Wi-Fi, Parking')
        self.vacant = Unit.objects.create(property=self.apt, name='101', monthly_rent=8500)
        self.occupied = Unit.objects.create(property=self.apt, name='102', monthly_rent=9000, status='occupied')
        self.studio = Property.objects.create(owner=self.owner, name='Mabolo Studios', property_type='studio',
                                              address='MJ Cuenco', city='Cebu City')
        Unit.objects.create(property=self.studio, name='3A', monthly_rent=15000)
        self.full = Property.objects.create(owner=self.owner, name='Full House', property_type='house',
                                            address='Banilad', city='Cebu City')
        Unit.objects.create(property=self.full, name='Main', monthly_rent=20000, status='occupied')
        self.client.force_login(self.tenant)


class AccessTests(PropertyTestCase):
    def test_tenant_only(self):
        urls = ['/browse/', f'/browse/{self.apt.pk}/', '/applications/']
        self.client.force_login(self.owner)
        for url in urls:
            self.assertEqual(self.get(url).status_code, 403)
        self.client.logout()
        for url in urls:
            self.assertEqual(self.get(url).status_code, 401)


class BrowseTests(PropertyTestCase):
    def names(self, **params):
        response = self.get('/browse/', **params)
        self.assertEqual(response.status_code, 200)
        return {p['name'] for p in response.json()['properties']}

    def test_only_properties_with_vacant_units(self):
        self.assertEqual(self.names(), {'Lahug Apartments', 'Mabolo Studios'})

    def test_search_type_and_max_rent(self):
        self.assertEqual(self.names(q='mabolo'), {'Mabolo Studios'})
        self.assertEqual(self.names(type='apartment'), {'Lahug Apartments'})
        self.assertEqual(self.names(max_rent=10000), {'Lahug Apartments'})
        self.assertEqual(self.names(max_rent=1000), set())

    def test_invalid_max_rent_is_ignored(self):
        self.assertEqual(self.names(max_rent='abc'), {'Lahug Apartments', 'Mabolo Studios'})
        self.assertTrue(self.get('/browse/', max_rent='abc').json()['invalid_filter'])

    def test_listing_shows_vacant_count_and_starting_rent(self):
        apt = next(p for p in self.get('/browse/').json()['properties'] if p['name'] == 'Lahug Apartments')
        self.assertEqual((apt['vacant_count'], apt['min_rent'], apt['amenity_list']), (1, '8500.00', ['Wi-Fi', 'Parking']))


class ApplyTests(PropertyTestCase):
    def apply(self, unit, **extra):
        return self.post(f'/browse/{self.apt.pk}/apply/', {'unit': unit.pk, 'message': 'Hi', **extra})

    def test_detail_lists_units(self):
        data = self.get(f'/browse/{self.apt.pk}/').json()
        self.assertEqual([u['name'] for u in data['units']], ['101', '102'])
        self.assertTrue(data['can_apply'])

    def test_apply_for_vacant_unit(self):
        response = self.apply(self.vacant)
        self.assertEqual(response.status_code, 201)
        self.assertIn('submitted', response.json()['message'])
        app = Application.objects.get()
        self.assertEqual((app.tenant, app.unit, app.status), (self.tenant, self.vacant, 'pending'))
        self.assertEqual(self.get(f'/browse/{self.apt.pk}/').json()['pending_unit_ids'], [self.vacant.pk])

    def test_cannot_apply_for_occupied_unit(self):
        self.assertEqual(self.apply(self.occupied).status_code, 400)
        self.assertFalse(Application.objects.exists())

    def test_cannot_apply_twice_while_pending(self):
        self.apply(self.vacant)
        response = self.apply(self.vacant)
        self.assertIn('already have a pending application', response.json()['errors']['non_field_errors'][0])
        self.assertEqual(Application.objects.count(), 1)

    def test_unit_must_belong_to_property(self):
        self.apply(self.studio.units.get())
        self.assertFalse(Application.objects.exists())

    def test_move_in_date_cannot_be_past(self):
        response = self.apply(self.vacant, preferred_move_in=(timezone.localdate() - timedelta(days=1)).isoformat())
        self.assertIn('cannot be in the past', response.json()['errors']['preferred_move_in'][0])
        self.assertFalse(Application.objects.exists())


class MyApplicationsTests(PropertyTestCase):
    def setUp(self):
        super().setUp()
        self.mine = Application.objects.create(tenant=self.tenant, unit=self.vacant)
        self.other_tenant = make_user('other', User.Role.TENANT)
        self.theirs = Application.objects.create(tenant=self.other_tenant, unit=self.vacant, message='SECRET-NOTE')

    def test_lists_only_own_applications(self):
        response = self.get('/applications/')
        self.assertEqual([a['id'] for a in response.json()['applications']], [self.mine.pk])
        self.assertNotContains(response, 'SECRET-NOTE')

    def test_status_filter_and_tab_counts(self):
        data = self.get('/applications/', status='approved').json()
        self.assertEqual(data['applications'], [])
        counts = {t['value']: t['count'] for t in data['status_tabs']}
        self.assertEqual((counts[''], counts['pending'], counts['approved']), (1, 1, 0))

    def test_withdraw_own_pending(self):
        self.assertIn('withdrawn', self.post(f'/applications/{self.mine.pk}/withdraw/').json()['message'])
        self.mine.refresh_from_db()
        self.assertEqual(self.mine.status, 'withdrawn')

    def test_cannot_withdraw_someone_elses(self):
        self.assertEqual(self.post(f'/applications/{self.theirs.pk}/withdraw/').status_code, 404)
        self.theirs.refresh_from_db()
        self.assertEqual(self.theirs.status, 'pending')

    def test_withdraw_requires_post(self):
        self.assertEqual(self.get(f'/applications/{self.mine.pk}/withdraw/').status_code, 405)


class EditApplicationTests(PropertyTestCase):
    def setUp(self):
        super().setUp()
        self.mine = Application.objects.create(tenant=self.tenant, unit=self.vacant)
        self.theirs = Application.objects.create(tenant=make_user('other', User.Role.TENANT), unit=self.vacant,
                                                 message='SECRET-NOTE')

    def test_edit_own_pending(self):
        move_in = timezone.localdate() + timedelta(days=14)
        response = self.put(f'/applications/{self.mine.pk}/', {'preferred_move_in': move_in.isoformat(), 'message': 'Updated note'})
        self.assertIn('updated', response.json()['message'])
        self.mine.refresh_from_db()
        self.assertEqual((self.mine.preferred_move_in, self.mine.message), (move_in, 'Updated note'))

    def test_edit_rejects_past_move_in(self):
        past = (timezone.localdate() - timedelta(days=1)).isoformat()
        response = self.put(f'/applications/{self.mine.pk}/', {'preferred_move_in': past, 'message': 'x'})
        self.assertIn('cannot be in the past', response.json()['errors']['preferred_move_in'][0])
        self.mine.refresh_from_db()
        self.assertIsNone(self.mine.preferred_move_in)

    def test_cannot_see_or_edit_someone_elses(self):
        self.assertEqual(self.get(f'/applications/{self.theirs.pk}/').status_code, 404)
        self.assertEqual(self.put(f'/applications/{self.theirs.pk}/', {'message': 'hacked'}).status_code, 404)
        self.theirs.refresh_from_db()
        self.assertEqual(self.theirs.message, 'SECRET-NOTE')

    def test_only_pending_can_be_edited(self):
        Application.objects.filter(pk=self.mine.pk).update(status='rejected')
        response = self.put(f'/applications/{self.mine.pk}/', {'message': 'too late'})
        self.assertIn('Only pending applications can be edited', response.json()['message'])
        self.mine.refresh_from_db()
        self.assertEqual(self.mine.message, '')

    def test_owner_cannot_use_tenant_endpoint(self):
        self.client.force_login(self.owner)
        self.assertEqual(self.get(f'/applications/{self.mine.pk}/').status_code, 403)


class OwnerTestCase(PropertyTestCase):
    """Signed in as the owner of all three properties; `other_owner` owns `theirs`."""

    def setUp(self):
        super().setUp()
        self.other_owner = make_user('other', User.Role.OWNER)
        self.theirs = Property.objects.create(owner=self.other_owner, name='Not Mine', property_type='house',
                                              address='Talamban', city='Cebu City')
        self.their_unit = Unit.objects.create(property=self.theirs, name='A', monthly_rent=5000)
        self.client.force_login(self.owner)


def property_data(**overrides):
    return {'name': 'Banilad Homes', 'property_type': 'house', 'address': 'Gov. Cuenco', 'city': 'Cebu City',
            'description': '', 'amenities': '', **overrides}


class OwnerAccessTests(OwnerTestCase):
    def test_owner_endpoints_are_owner_only(self):
        self.client.force_login(self.tenant)
        for url in ('/owner/properties/', '/owner/applications/', f'/owner/properties/{self.apt.pk}/'):
            self.assertEqual(self.get(url).status_code, 403)

    def test_lists_only_own_properties_with_counts(self):
        props = {p['name']: p for p in self.get('/owner/properties/').json()['properties']}
        self.assertEqual(set(props), {'Lahug Apartments', 'Mabolo Studios', 'Full House'})
        self.assertEqual((props['Lahug Apartments']['unit_count'], props['Lahug Apartments']['vacant_count']), (2, 1))

    def test_cannot_touch_another_owners_property_or_unit(self):
        self.assertEqual(self.get(f'/owner/properties/{self.theirs.pk}/').status_code, 404)
        self.assertEqual(self.put(f'/owner/properties/{self.theirs.pk}/', property_data()).status_code, 404)
        self.assertEqual(self.post(f'/owner/properties/{self.theirs.pk}/units/', {}).status_code, 404)
        self.assertEqual(self.get(f'/owner/units/{self.their_unit.pk}/').status_code, 404)
        self.assertEqual(self.delete(f'/owner/properties/{self.theirs.pk}/').status_code, 404)
        self.assertEqual(self.delete(f'/owner/units/{self.their_unit.pk}/').status_code, 404)
        self.assertTrue(Property.objects.filter(pk=self.theirs.pk).exists())
        self.assertTrue(Unit.objects.filter(pk=self.their_unit.pk).exists())


class OwnerPropertyTests(OwnerTestCase):
    def test_create_property_sets_owner(self):
        response = self.post('/owner/properties/', property_data())
        self.assertEqual(response.status_code, 201)
        prop = Property.objects.get(name='Banilad Homes')
        self.assertEqual((prop.owner, response.json()['property']['id']), (self.owner, prop.pk))

    def test_create_property_requires_fields(self):
        response = self.post('/owner/properties/', {'name': ''})
        self.assertEqual(response.status_code, 400)
        self.assertIn('name', response.json()['errors'])

    def test_edit_and_delete_property(self):
        self.put(f'/owner/properties/{self.studio.pk}/', property_data(name='Mabolo Lofts', property_type='studio',
                                                                       address='MJ Cuenco'))
        self.studio.refresh_from_db()
        self.assertEqual(self.studio.name, 'Mabolo Lofts')
        self.delete(f'/owner/properties/{self.studio.pk}/')
        self.assertFalse(Property.objects.filter(pk=self.studio.pk).exists())

    def test_duplicate_property_rejected(self):
        response = self.post('/owner/properties/', property_data(name=' lahug apartments ', property_type='apartment',
                                                                 address='SALINAS DR', city='cebu city'))
        self.assertEqual(response.status_code, 400)
        self.assertIn('You already have a property with this name at this address.',
                      response.json()['errors']['non_field_errors'])
        self.assertEqual(Property.objects.filter(owner=self.owner, name__iexact='Lahug Apartments').count(), 1)

    def test_edit_into_duplicate_rejected(self):
        response = self.put(f'/owner/properties/{self.studio.pk}/', property_data(
            name='Lahug Apartments', property_type='studio', address='Salinas Dr'))
        self.assertEqual(response.status_code, 400)
        self.studio.refresh_from_db()
        self.assertEqual(self.studio.name, 'Mabolo Studios')

    def test_same_property_allowed_at_other_address_or_owner(self):
        self.post('/owner/properties/', property_data(name='Lahug Apartments', address='Gorordo Ave'))
        self.client.force_login(self.other_owner)
        self.post('/owner/properties/', property_data(name='Lahug Apartments', address='Salinas Dr'))
        self.assertEqual(Property.objects.filter(name='Lahug Apartments').count(), 3)

    def test_saving_unchanged_property_is_not_a_duplicate(self):
        response = self.put(f'/owner/properties/{self.apt.pk}/', property_data(
            name='Lahug Apartments', property_type='apartment', address='Salinas Dr', description='Updated'))
        self.assertEqual(response.status_code, 200)


class OwnerUnitTests(OwnerTestCase):
    def unit_data(self, **overrides):
        return {'name': '201', 'bedrooms': 1, 'bathrooms': 1, 'floor_area': 30, 'monthly_rent': 9500,
                'status': 'vacant', **overrides}

    def test_add_unit(self):
        self.assertEqual(self.post(f'/owner/properties/{self.apt.pk}/units/', self.unit_data()).status_code, 201)
        self.assertTrue(self.apt.units.filter(name='201', monthly_rent=9500).exists())

    def test_duplicate_unit_name_rejected(self):
        response = self.post(f'/owner/properties/{self.apt.pk}/units/', self.unit_data(name='101'))
        self.assertIn('name', response.json()['errors'])

    def test_same_unit_name_allowed_in_other_property(self):
        self.post(f'/owner/properties/{self.studio.pk}/units/', self.unit_data(name='101'))
        self.assertTrue(self.studio.units.filter(name='101').exists())

    def test_rent_must_be_positive(self):
        response = self.post(f'/owner/properties/{self.apt.pk}/units/', self.unit_data(monthly_rent=0))
        self.assertIn('monthly_rent', response.json()['errors'])

    def test_edit_unit_keeping_its_name_and_delete(self):
        self.put(f'/owner/units/{self.vacant.pk}/', self.unit_data(name='101', status='occupied'))
        self.vacant.refresh_from_db()
        self.assertEqual(self.vacant.status, 'occupied')
        self.delete(f'/owner/units/{self.vacant.pk}/')
        self.assertFalse(Unit.objects.filter(pk=self.vacant.pk).exists())


class OwnerApplicationTests(OwnerTestCase):
    def setUp(self):
        super().setUp()
        self.tenant2 = make_user('tenant2', User.Role.TENANT)
        self.app1 = Application.objects.create(tenant=self.tenant, unit=self.vacant)
        self.app2 = Application.objects.create(tenant=self.tenant2, unit=self.vacant)
        self.their_app = Application.objects.create(tenant=self.tenant, unit=self.their_unit)

    def decide(self, app, decision):
        return self.post(f'/owner/applications/{app.pk}/{decision}/')

    def test_lists_only_applications_for_own_units(self):
        data = self.get('/owner/applications/').json()
        self.assertEqual(data['status'], 'pending')
        self.assertEqual({a['id'] for a in data['applications']}, {self.app1.pk, self.app2.pk})
        self.assertIn('email', data['applications'][0]['tenant'])  # owners see tenant contact details

    def test_approve_occupies_unit_and_rejects_others(self):
        self.assertIn('1 other pending application was rejected', self.decide(self.app1, 'approve').json()['message'])
        for obj in (self.app1, self.app2, self.vacant):
            obj.refresh_from_db()
        self.assertEqual((self.app1.status, self.app2.status, self.vacant.status), ('approved', 'rejected', 'occupied'))

    def test_reject(self):
        self.decide(self.app1, 'reject')
        self.app1.refresh_from_db()
        self.vacant.refresh_from_db()
        self.assertEqual((self.app1.status, self.vacant.status), ('rejected', 'vacant'))

    def test_cannot_approve_for_occupied_unit(self):
        Unit.objects.filter(pk=self.vacant.pk).update(status='occupied')
        self.assertEqual(self.decide(self.app1, 'approve').status_code, 400)
        self.app1.refresh_from_db()
        self.assertEqual(self.app1.status, 'pending')

    def test_only_pending_can_be_decided(self):
        Application.objects.filter(pk=self.app1.pk).update(status='withdrawn')
        self.decide(self.app1, 'approve')
        self.app1.refresh_from_db()
        self.assertEqual(self.app1.status, 'withdrawn')

    def test_cannot_decide_another_owners_application(self):
        self.assertEqual(self.decide(self.their_app, 'approve').status_code, 404)
        self.their_app.refresh_from_db()
        self.assertEqual(self.their_app.status, 'pending')

    def test_unknown_decision_is_404(self):
        self.assertEqual(self.post(f'/owner/applications/{self.app1.pk}/delete/').status_code, 404)

    def test_badges_count_pending(self):
        self.assertEqual(self.get('/badges/').json()['pending_applications'], 2)
