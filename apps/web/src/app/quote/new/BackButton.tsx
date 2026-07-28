import Link from 'next/link';

// Returns to the storefront home rather than retracing browser history, so the
// destination is the same however the visitor reached the service picker.
export function BackButton() {
  return (
    <Link href="/" className="link text-sm">← Back</Link>
  );
}
