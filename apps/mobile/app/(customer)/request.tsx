import { QuoteWizard } from '@/components/QuoteWizard';

// Authed customer "New Quote" tab. The wizard is shared with the public
// (signed-out) storefront flow; here there's always a session, so it submits
// directly. See src/components/QuoteWizard.tsx.
export default function RequestQuoteScreen() {
  return <QuoteWizard />;
}
