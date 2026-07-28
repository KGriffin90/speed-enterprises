import { useRouter, useLocalSearchParams } from 'expo-router';
import { QuoteWizard } from '@/components/QuoteWizard';

// Public quote flow, reached from the tenant storefront. Renders the same
// wizard as the authed tab; the wizard handles the sign-up gate at submit.
// `service` preselects a service; `slug` pins the wizard to THIS storefront's
// business (important when a session for a different business exists).
export default function PublicQuoteScreen() {
  const router = useRouter();
  const { service, slug } = useLocalSearchParams<{ service?: string; slug?: string }>();
  return <QuoteWizard initialServiceSlug={service} tenantSlug={slug} onBack={() => router.back()} />;
}
