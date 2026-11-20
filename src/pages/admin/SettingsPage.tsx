import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, api, put } from '../../lib/api';
import { settingsSchema, type SettingsInput } from '../../../shared/api';
import { PRESETS, type StyleConfig } from '../../../shared/style';
import { Button, Card, Field, Input, Textarea } from '../../components/ui';
import { PageHeader } from '../../components/admin/bits';

type Settings = SettingsInput & { defaultStyle: StyleConfig; demoMode: boolean };

export default function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/api/admin/settings') });
  const [form, setForm] = useState<SettingsInput | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (q.data && !form) {
      const { studioName, intro, contactUrl, contactLabel } = q.data;
      setForm({ studioName, intro, contactUrl, contactLabel });
    }
  }, [q.data, form]);

  if (!form || !q.data) return <div className="h-64 animate-pulse rounded-ui bg-placeholder" />;
  const original = {
    studioName: q.data.studioName,
    intro: q.data.intro,
    contactUrl: q.data.contactUrl,
    contactLabel: q.data.contactLabel,
  };
  const dirty = JSON.stringify(original) !== JSON.stringify(form);
  const set = (patch: Partial<SettingsInput>) => setForm({ ...form, ...patch });

  const save = async () => {
    const clean = {
      ...form,
      intro: form.intro || null,
      contactUrl: form.contactUrl || null,
      contactLabel: form.contactLabel || null,
    };
    const parsed = settingsSchema.safeParse(clean);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await put('/api/admin/settings', parsed.data);
      await qc.invalidateQueries({ queryKey: ['settings'] });
      setForm(null);
      toast.success('Settings saved.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Couldn’t save settings.');
    } finally {
      setSaving(false);
    }
  };

  const preset = PRESETS.find((p) => p.id === q.data.defaultStyle.presetId);

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-8 pb-24">
      <PageHeader title="Settings" />
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-[15px] font-semibold">Studio identity</h2>
        <Field label="Studio or photographer name" htmlFor="name" error={errors.studioName}>
          <Input
            id="name"
            value={form.studioName}
            maxLength={80}
            onChange={(e) => set({ studioName: e.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Contact link"
            htmlFor="contact"
            error={errors.contactUrl}
            hint="https:// or mailto: link, shown in public footers."
          >
            <Input
              id="contact"
              value={form.contactUrl ?? ''}
              onChange={(e) => set({ contactUrl: e.target.value })}
              placeholder="mailto:hello@studio.com"
            />
          </Field>
          <Field label="Contact label" htmlFor="clabel">
            <Input
              id="clabel"
              value={form.contactLabel ?? ''}
              maxLength={60}
              onChange={(e) => set({ contactLabel: e.target.value })}
              placeholder="Contact"
            />
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-[15px] font-semibold">Landing page</h2>
        <p className="text-[13px] leading-5 text-slate">
          Your homepage shows only your studio name, this introduction and your contact link. It never lists
          client galleries: each client reaches their gallery only through the private link you send them.
        </p>
        <Field
          label="Introduction"
          htmlFor="intro"
          hint={`${(form.intro ?? '').length}/280. One or two sentences under your name.`}
        >
          <Textarea
            id="intro"
            rows={3}
            maxLength={280}
            value={form.intro ?? ''}
            onChange={(e) => set({ intro: e.target.value })}
          />
        </Field>
      </Card>

      <Card className="flex flex-col gap-3 p-6">
        <h2 className="text-[15px] font-semibold">Default gallery design</h2>
        <p className="text-[13px] text-slate">
          New collections start from {preset ? `the ${preset.name} preset` : 'your saved default'}, then apply
          the preset you pick when creating them.
        </p>
        <Link
          to="/admin/appearance"
          className="inline-flex h-9 w-fit items-center rounded-ui border border-line px-3.5 text-[14px] font-medium hover:bg-subtle"
        >
          Edit appearance defaults
        </Link>
      </Card>

      {q.data.demoMode && (
        <Card className="p-6 text-[13px] leading-5 text-slate">
          <h2 className="mb-1 text-[15px] font-semibold text-ink">Demo mode</h2>
          Controlled by the <span className="font-mono text-[12px]">DEMO_MODE</span> server variable. Set it
          to <span className="font-mono text-[12px]">false</span> in production: demo collections then
          disappear from public pages and images.
        </Card>
      )}

      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur lg:left-[240px]">
          <div className="mx-auto flex max-w-[760px] items-center justify-between gap-3 px-4 py-3">
            <span className="text-[13px] text-slate">Unsaved changes</span>
            <div className="flex gap-2">
              <Button onClick={() => setForm(original)}>Discard</Button>
              <Button variant="primary" onClick={save} loading={saving}>
                Save settings
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
