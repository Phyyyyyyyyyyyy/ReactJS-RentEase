import { Link } from 'react-router';
import { usePageTitle } from '../components/AppLayout';
import Icon from '../components/Icon';
import { Avatar } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../lib/format';

export function ProfileCard({ user, showStatus }) {
  return (
    <section className="panel profile-card">
      <Avatar user={user} className="profile-avatar-large" />
      <h2>{user.full_name}</h2>
      <p>@{user.username}</p>
      <div className="profile-meta">
        <span>Role</span><strong>{user.role_display}</strong>
        {showStatus && <><span>Status</span><strong>{user.is_active ? 'Active' : 'Inactive'}</strong></>}
      </div>
    </section>
  );
}

export default function Profile() {
  usePageTitle('My Profile', 'My profile');
  const { user } = useAuth();

  return (
    <div className="page-stack narrow-page">
      <div className="page-heading">
        <div><span className="eyebrow">User profile</span><h1>My profile</h1><p>The information linked to your RentEase account.</p></div>
        <Link className="primary-button" to="/profile/edit"><Icon name="edit" size={16} />Edit profile</Link>
      </div>
      <div className="profile-layout">
        <ProfileCard user={user} showStatus />
        <section className="panel">
          <div className="panel-heading"><div><span className="eyebrow">Account details</span><h2>Personal information</h2></div></div>
          <dl className="detail-list">
            <dt>First name</dt><dd>{user.first_name || '—'}</dd>
            <dt>Last name</dt><dd>{user.last_name || '—'}</dd>
            <dt>Username</dt><dd>{user.username}</dd>
            <dt>Email address</dt><dd>{user.email}</dd>
            <dt>Contact number</dt><dd>{user.phone || '—'}</dd>
            {user.role === 'owner' && (
              <>
                <dt>GCash</dt>
                <dd>
                  {user.gcash_number ? (
                    <>{user.gcash_number} · {user.gcash_name}{user.gcash_qr && ' · QR uploaded'}</>
                  ) : (
                    <>Not set up. <Link to="/profile/edit#gcash" className="font-semibold text-brand">Add GCash</Link> so tenants can pay you online</>
                  )}
                </dd>
              </>
            )}
            <dt>Member since</dt><dd>{formatDate(user.date_joined, 'F j, Y')}</dd>
            <dt>Last login</dt><dd>{formatDate(user.last_login, 'F j, Y g:i A') || '—'}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
