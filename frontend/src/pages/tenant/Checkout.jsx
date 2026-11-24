import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { usePageTitle } from '../../components/AppLayout';
import Icon from '../../components/Icon';
import { BusyButton, LoadError, PageSkeleton } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useFlash } from '../../context/FlashContext';
import { useApi } from '../../hooks/useApi';
import { api } from '../../lib/api';
import { formatDate, peso } from '../../lib/format';

/**
 * /payments/checkout/:code: the GCash payment screen.
 * In sandbox mode this is RentEase's own test screen and no real money moves.
 */
export default function Checkout() {
  usePageTitle('Rent & Payments', 'GCash checkout');
  const { code } = useParams();
  const { data, error, reload } = useApi(`/payments/checkout/${code}/`);
  const navigate = useNavigate();
  const { flash, notify } = useFlash();
  const { refreshBadges } = useAuth();
  const [busy, setBusy] = useState(null);

  if (error) return <LoadError error={error} />;
  if (!data) return <PageSkeleton />;
  const { checkout, pay_to: payTo, sandbox } = data;

  const act = async (action) => {
    setBusy(action);
    try {
      const result = await api(`/payments/checkout/${code}/${action}/`, { method: 'POST' });
      flash('success', result.message);
      refreshBadges();
      navigate(action === 'pay' ? `/payments/receipt/${result.payment_id}` : '/payments');
    } catch (e) {
      notify('error', e.message);
      setBusy(null);
      reload();
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-md gap-4">
      {sandbox && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="note">
          <strong>Test mode (sandbox).</strong> This is a practice checkout: no real money moves and nothing is charged to any GCash account.
        </div>
      )}
      <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-lg">
        <div className="bg-blue-600 px-6 py-5 text-white">
          <span className="text-xs font-semibold uppercase tracking-widest text-white/80">GCash checkout{sandbox && ' · sandbox'}</span>
          <strong className="mt-1 block text-3xl font-bold">{peso(checkout.amount)}</strong>
        </div>
        <dl className="m-0 grid gap-3 p-6 text-sm">
          <Row label="Pay to" value={payTo.owner} />
          <Row label="For" value={`Rent · ${payTo.property} ${payTo.unit}`} />
          {checkout.status === 'pending' && <Row label="Expires" value={formatDate(checkout.expires_at, 'g:i A')} />}
        </dl>
        <div className="grid gap-2 border-t border-slate-100 p-6">
          {checkout.status === 'pending' ? (
            <>
              <BusyButton type="button" className="primary-button full cursor-pointer" busy={busy === 'pay'} busyText="Paying…"
                disabled={Boolean(busy)} onClick={() => act('pay')}>
                <Icon name="check" size={18} />Pay {peso(checkout.amount)}
              </BusyButton>
              <BusyButton type="button" className="secondary-button full cursor-pointer" busy={busy === 'cancel'} busyText="Cancelling…"
                disabled={Boolean(busy)} onClick={() => act('cancel')}>
                Cancel
              </BusyButton>
            </>
          ) : (
            <>
              <p className="m-0 text-center text-sm text-slate-600">
                {checkout.status === 'paid' && 'This checkout has been paid.'}
                {checkout.status === 'cancelled' && 'This checkout was cancelled. Nothing was charged.'}
                {checkout.status === 'expired' && 'This checkout expired. Nothing was charged.'}
              </p>
              {checkout.status === 'paid' && checkout.payment_id
                ? <Link className="primary-button full" to={`/payments/receipt/${checkout.payment_id}`}>View receipt</Link>
                : <Link className="secondary-button full" to="/payments">Back to rent & payments</Link>}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="m-0 text-right font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
