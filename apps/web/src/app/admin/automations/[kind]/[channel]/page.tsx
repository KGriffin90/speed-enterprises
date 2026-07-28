import Link from 'next/link';
import { apiServer } from '@/lib/server-auth';
import { TemplateEditor } from './TemplateEditor';

interface TemplateDetail {
  id: string | null; kind: string; channel: string;
  subject: string | null; body: string; enabled: boolean; isCustomized: boolean;
}

export const metadata = { title: 'Edit automation' };

export default async function EditAutomation({ params }: { params: { kind: string; channel: string } }) {
  const t = await apiServer<TemplateDetail>('GET', `/api/me/automations/${encodeURIComponent(params.kind)}/${encodeURIComponent(params.channel)}`);
  return (
    <div className="max-w-4xl">
      <Link href="/admin/automations" className="link text-sm">← All automations</Link>
      <h1 className="mt-3 text-2xl font-extrabold" style={{ color: 'var(--ink-900)' }}>
        {params.kind.replace(/_/g, ' ')}
      </h1>
      <p className="text-sm mt-1" style={{ color: 'var(--ink-500)' }}>
        Channel: {params.channel} · {t.isCustomized ? 'Customized' : 'Falling back to platform default'}
      </p>
      <div className="mt-6">
        <TemplateEditor kind={params.kind} channel={params.channel} initial={t} />
      </div>
    </div>
  );
}
