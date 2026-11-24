from django.test import Client, TestCase

from .models import User

PASSWORD = 'Str0ng-Pass!42'


def make_user(username, role, **extra):
    return User.objects.create_user(
        username=username, email=f'{username}@example.com', password=PASSWORD,
        first_name=username.title(), last_name='Test', role=role, **extra,
    )


class ApiTestCase(TestCase):
    """JSON helpers for the API tests."""

    def get(self, url, **params):
        return self.client.get(f'/api{url}', params)

    def post(self, url, data=None):
        return self.client.post(f'/api{url}', data or {}, content_type='application/json')

    def put(self, url, data):
        return self.client.put(f'/api{url}', data, content_type='application/json')

    def delete(self, url):
        return self.client.delete(f'/api{url}')

    def post_form(self, url, data):
        """multipart/form-data, as the React app sends for file uploads."""
        return self.client.post(f'/api{url}', data)


class RegistrationTests(ApiTestCase):
    def data(self, **overrides):
        return {
            'first_name': 'Juan', 'last_name': 'Dela Cruz', 'username': 'juan',
            'email': 'juan@example.com', 'phone': '09170000000', 'role': 'tenant',
            'password1': PASSWORD, 'password2': PASSWORD, **overrides,
        }

    def test_register_success_hashes_password(self):
        response = self.post('/auth/register/', self.data())
        self.assertEqual(response.status_code, 201)
        self.assertIn('Account created successfully', response.json()['message'])
        user = User.objects.get(username='juan')
        self.assertTrue(user.password.startswith('pbkdf2_sha256$'))
        self.assertTrue(user.check_password(PASSWORD))
        self.assertNotIn('_auth_user_id', self.client.session)  # signs in separately, like before

    def test_required_fields(self):
        response = self.post('/auth/register/', {})
        self.assertEqual(response.status_code, 400)
        self.assertIn('This field is required.', response.json()['errors']['username'])
        self.assertEqual(User.objects.count(), 0)

    def test_invalid_email(self):
        errors = self.post('/auth/register/', self.data(email='not-an-email')).json()['errors']
        self.assertIn('Enter a valid email address.', errors['email'])

    def test_duplicate_email_and_username(self):
        make_user('juan', User.Role.TENANT)
        errors = self.post('/auth/register/', self.data(email='JUAN@example.com')).json()['errors']
        self.assertIn('An account with this email already exists.', errors['email'])
        self.assertIn('username', errors)
        self.assertEqual(User.objects.count(), 1)

    def test_password_mismatch(self):
        errors = self.post('/auth/register/', self.data(password2='different-Pass9')).json()['errors']
        self.assertIn('password2', errors)
        self.assertFalse(User.objects.filter(username='juan').exists())

    def test_cannot_self_register_as_admin(self):
        self.assertEqual(self.post('/auth/register/', self.data(role='admin')).status_code, 400)
        self.assertFalse(User.objects.filter(username='juan').exists())


class LoginLogoutTests(ApiTestCase):
    def setUp(self):
        self.user = make_user('tina', User.Role.TENANT)

    def test_login_with_username_or_email(self):
        for identifier in ('tina', 'tina@example.com'):
            response = self.post('/auth/login/', {'username': identifier, 'password': PASSWORD})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['user']['role'], 'tenant')
            self.assertEqual(self.get('/auth/session/').json()['user']['username'], 'tina')
            self.post('/auth/logout/')

    def test_invalid_credentials_show_error(self):
        response = self.post('/auth/login/', {'username': 'tina', 'password': 'wrong'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('Invalid username/email or password', response.json()['message'])
        self.assertNotIn('_auth_user_id', self.client.session)

    def test_logout_ends_session(self):
        self.client.force_login(self.user)
        self.post('/auth/logout/')
        self.assertNotIn('_auth_user_id', self.client.session)
        self.assertIsNone(self.get('/auth/session/').json()['user'])
        self.assertEqual(self.get('/profile/').status_code, 401)

    def test_csrf_is_required_even_to_sign_in(self):
        client = Client(enforce_csrf_checks=True)
        response = client.post('/api/auth/login/', {'username': 'tina', 'password': PASSWORD},
                               content_type='application/json')
        self.assertEqual(response.status_code, 403)
        # With the cookie from /auth/session/ sent back as X-CSRFToken it works.
        client.get('/api/auth/session/')
        token = client.cookies['csrftoken'].value
        response = client.post('/api/auth/login/', {'username': 'tina', 'password': PASSWORD},
                               content_type='application/json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200)


class RoleDashboardTests(ApiTestCase):
    def test_signed_out_users_get_401(self):
        for url in ('/dashboard/', '/profile/', '/badges/', '/browse/', '/owner/properties/'):
            self.assertEqual(self.get(url).status_code, 401, url)

    def test_each_role_gets_its_own_dashboard(self):
        expected_keys = {'admin': 'total_users', 'owner': 'property_count', 'tenant': 'app_total',
                         'staff': 'tenant_count'}
        for role, key in expected_keys.items():
            self.client.force_login(make_user(f'user_{role}', role))
            data = self.get('/dashboard/').json()
            self.assertEqual(data['role'], role)
            self.assertIn(key, data)
            self.client.logout()

    def test_wrong_role_gets_403(self):
        self.client.force_login(make_user('tina', User.Role.TENANT))
        self.assertEqual(self.get('/owner/properties/').status_code, 403)

    def test_superuser_gets_admin_role(self):
        admin = User.objects.create_superuser('root', 'root@example.com', PASSWORD)
        self.assertEqual(admin.role, User.Role.ADMIN)


class ProfileTests(ApiTestCase):
    def setUp(self):
        self.user = make_user('alice', User.Role.TENANT, phone='111')
        self.other = make_user('bob', User.Role.OWNER, phone='222')
        self.client.force_login(self.user)

    def test_view_own_profile_only(self):
        data = self.get('/profile/').json()['user']
        self.assertEqual(data['email'], 'alice@example.com')
        self.assertNotIn('gcash_number', data)  # tenants have no GCash details

    def test_update_profile(self):
        response = self.post_form('/profile/', {
            'first_name': 'Alicia', 'last_name': 'Reyes', 'email': 'alicia@example.com', 'phone': '0999',
        })
        self.assertEqual(response.json()['message'], 'Profile updated successfully.')
        self.user.refresh_from_db()
        self.assertEqual((self.user.first_name, self.user.email, self.user.phone), ('Alicia', 'alicia@example.com', '0999'))
        self.other.refresh_from_db()
        self.assertEqual(self.other.email, 'bob@example.com')

    def test_cannot_take_another_users_email(self):
        response = self.post_form('/profile/', {'first_name': 'A', 'last_name': 'B', 'email': 'bob@example.com', 'phone': '1'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('already used by another account', response.json()['errors']['email'][0])

    def test_profile_edit_cannot_change_role(self):
        self.post_form('/profile/', {'first_name': 'A', 'last_name': 'B', 'email': 'alice@example.com', 'phone': '1',
                                     'role': 'admin'})
        self.user.refresh_from_db()
        self.assertEqual(self.user.role, User.Role.TENANT)
