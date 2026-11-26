import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useFlash } from '../context/FlashContext';
import { api } from '../lib/api';
import Icon from './Icon';
import { BusyButton } from './ui';

/**
 * "Message owner" / "Message tenant": opens (or creates) the conversation and goes to it.
 * `property` is the property id; owners and managers also pass `tenant` (the tenant's id).
 */
export function MessageButton({ property, tenant, label = 'Message', className = 'secondary-button compact' }) {
  const navigate = useNavigate();
  const { notify } = useFlash();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const { id } = await api('/conversations/', { method: 'POST', body: tenant ? { property, tenant } : { property } });
      navigate(`/messages/${id}`);
    } catch (error) {
      notify('error', error.message);
      setBusy(false);
    }
  };
  return (
    <BusyButton type="button" busy={busy} busyText="Opening…" onClick={open} className={`${className} inline-flex cursor-pointer items-center gap-1.5`}>
      <Icon name="chat" size={15} />{label}
    </BusyButton>
  );
}
