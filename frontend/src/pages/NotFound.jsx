import { Link } from 'react-router';
import { usePageTitle } from '../components/AppLayout';
import { EmptyState } from '../components/ui';

export default function NotFound() {
  usePageTitle('Not found');
  return (
    <EmptyState icon="search" title="Page not found" text="The page you opened doesn't exist or was moved.">
      <Link to="/dashboard" className="mt-4 text-sm font-bold text-brand no-underline">Back to dashboard →</Link>
    </EmptyState>
  );
}
