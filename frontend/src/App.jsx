import { Navigate, Route, Routes } from 'react-router';
import AppLayout from './components/AppLayout';
import { dashboardPath, GuestOnly, RequireAuth } from './components/guards';
import { useAuth } from './context/AuthContext';
import ReferralCodes from './pages/admin/ReferralCodes';
import UserFormPage from './pages/admin/UserForm';
import UserList from './pages/admin/UserList';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import { AdminDashboard, ManagerDashboard, OwnerDashboard, TenantDashboard } from './pages/Dashboards';
import NotFound from './pages/NotFound';
import Notifications from './pages/Notifications';
import Finances from './pages/owner/Finances';
import OwnerApplications from './pages/owner/OwnerApplications';
import OwnerPayments from './pages/owner/OwnerPayments';
import OwnerTenancy from './pages/owner/OwnerTenancy';
import PropertyFormPage from './pages/owner/PropertyForm';
import PropertyList from './pages/owner/PropertyList';
import PropertyManage from './pages/owner/PropertyManage';
import { UnitCreate, UnitEdit } from './pages/owner/UnitForm';
import Profile from './pages/Profile';
import Receipt from './pages/Receipt';
import Statement from './pages/Statement';
import ProfileEdit from './pages/ProfileEdit';
import Browse from './pages/tenant/Browse';
import EditApplication from './pages/tenant/EditApplication';
import Checkout from './pages/tenant/Checkout';
import GCashPay from './pages/tenant/GCashPay';
import OnlinePay from './pages/tenant/OnlinePay';
import MyApplications from './pages/tenant/MyApplications';
import PropertyDetail from './pages/tenant/PropertyDetail';
import TenantPayments from './pages/tenant/TenantPayments';

const role = (roles, element) => <RequireAuth roles={roles}>{element}</RequireAuth>;

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? dashboardPath(user) : '/login'} replace />;
}

export default function App() {
  const { user, loadError } = useAuth();

  if (loadError) {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <h1 className="text-xl font-bold">Can't reach the RentEase server</h1>
          <p className="text-sm text-slate-500">{loadError.message} Start the backend server (npm start in backend/), then reload this page.</p>
        </div>
      </div>
    );
  }
  if (user === undefined) return null; // checking the session

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />

      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route path="/dashboard" element={<Home />} />
        <Route path="/dashboard/admin" element={role(['admin'], <AdminDashboard />)} />
        <Route path="/dashboard/owner" element={role(['owner'], <OwnerDashboard />)} />
        <Route path="/dashboard/tenant" element={role(['tenant'], <TenantDashboard />)} />
        <Route path="/dashboard/manager" element={role(['manager'], <ManagerDashboard />)} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/profile/edit" element={<ProfileEdit />} />
        <Route path="/notifications" element={<Notifications />} />

        {/* Admin */}
        <Route path="/admin/users" element={role(['admin'], <UserList />)} />
        <Route path="/admin/users/new" element={role(['admin'], <UserFormPage />)} />
        <Route path="/admin/users/:id/edit" element={role(['admin'], <UserFormPage />)} />
        <Route path="/admin/referral-codes" element={role(['admin'], <ReferralCodes />)} />

        {/* Tenant */}
        <Route path="/browse" element={role(['tenant'], <Browse />)} />
        <Route path="/browse/:id" element={role(['tenant'], <PropertyDetail />)} />
        <Route path="/applications" element={role(['tenant'], <MyApplications />)} />
        <Route path="/applications/:id/edit" element={role(['tenant'], <EditApplication />)} />
        <Route path="/payments" element={role(['tenant'], <TenantPayments />)} />
        <Route path="/payments/:id/gcash" element={role(['tenant'], <GCashPay />)} />
        <Route path="/payments/:id/online" element={role(['tenant'], <OnlinePay />)} />
        <Route path="/payments/checkout/:code" element={role(['tenant'], <Checkout />)} />
        <Route path="/payments/receipt/:id" element={role(['tenant', 'owner', 'manager'], <Receipt />)} />
        <Route path="/payments/statement/:id" element={role(['tenant', 'owner', 'manager'], <Statement />)} />

        {/* Property owner (and Property Manager, for the properties they manage) */}
        <Route path="/owner/properties" element={role(['owner', 'manager'], <PropertyList />)} />
        <Route path="/owner/properties/new" element={role(['owner'], <PropertyFormPage />)} />
        <Route path="/owner/properties/:id" element={role(['owner', 'manager'], <PropertyManage />)} />
        <Route path="/owner/properties/:id/edit" element={role(['owner'], <PropertyFormPage />)} />
        <Route path="/owner/properties/:propertyId/units/new" element={role(['owner'], <UnitCreate />)} />
        <Route path="/owner/properties/units/:id/edit" element={role(['owner'], <UnitEdit />)} />
        <Route path="/owner/applications" element={role(['owner', 'manager'], <OwnerApplications />)} />
        <Route path="/owner/payments" element={role(['owner', 'manager'], <OwnerPayments />)} />
        <Route path="/owner/finances" element={role(['owner'], <Finances />)} />
        <Route path="/owner/payments/tenancy/:id" element={role(['owner', 'manager'], <OwnerTenancy />)} />

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
