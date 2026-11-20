import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertDialog, Slider as RSlider, Switch as RSwitch, ToggleGroup } from 'radix-ui';
import { Loader2 } from 'lucide-react';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');
export { cx };

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-ink-2 disabled:bg-ink/40',
  secondary:
    'bg-surface text-ink border border-line hover:bg-subtle hover:border-line-strong disabled:text-muted',
  ghost: 'text-ink hover:bg-subtle disabled:text-muted',
  danger: 'bg-err text-white hover:bg-[#991b1b] disabled:opacity-50',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant;
    size?: 'sm' | 'md';
    loading?: boolean;
    icon?: ReactNode;
  }
>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-ui font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-3.5 text-[14px]',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
});

export function LinkButton({
  href,
  children,
  variant = 'secondary',
  size = 'md',
  external,
  icon,
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: Variant;
  size?: 'sm' | 'md';
  external?: boolean;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-ui font-medium transition-colors duration-150',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-3.5 text-[14px]',
        VARIANTS[variant],
        className,
      )}
    >
      {icon}
      {children}
      {external && <span className="sr-only">(opens in a new tab)</span>}
    </a>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx(
        'h-[38px] w-full rounded-ui border border-line bg-surface px-3 text-[14px] text-ink placeholder:text-muted transition-colors focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10 aria-[invalid=true]:border-err',
        className,
      )}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cx(
          'w-full rounded-ui border border-line bg-surface px-3 py-2 text-[14px] leading-6 text-ink placeholder:text-muted focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10',
          className,
        )}
        {...rest}
      />
    );
  },
);

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[12px] text-err">{error}</p>
      ) : hint ? (
        <p className="text-[12px] leading-5 text-slate">{hint}</p>
      ) : null}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="flex flex-col gap-0.5">
        <span className="text-[13px] text-ink">{label}</span>
        {description && <span className="text-[12px] leading-4 text-slate">{description}</span>}
      </label>
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-line-strong transition-colors data-[state=checked]:bg-ink disabled:opacity-50"
      >
        <RSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
      </RSwitch.Root>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = 'px',
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cx('flex flex-col gap-2', disabled && 'opacity-40')}>
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-slate">{label}</span>
        <span className="tnum text-ink">
          {value}
          {unit}
        </span>
      </div>
      <RSlider.Root
        className="relative flex h-5 touch-none select-none items-center"
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([v]) => onChange(v)}
        aria-label={label}
      >
        <RSlider.Track className="relative h-1 grow rounded-full bg-line">
          <RSlider.Range className="absolute h-full rounded-full bg-ink" />
        </RSlider.Track>
        <RSlider.Thumb
          className="block h-3.5 w-3.5 rounded-full border-2 border-ink bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          aria-label={label}
        />
      </RSlider.Root>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  label: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={label}
      className="flex rounded-ui bg-subtle p-0.5"
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          title={o.title}
          className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2 text-[12px] font-medium text-slate transition-colors hover:text-ink data-[state=on]:bg-white data-[state=on]:text-ink data-[state=on]:shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

export function Confirm({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  destructive,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  loading?: boolean;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[80] bg-ink/30" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[81] w-[calc(100%-32px)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-[8px] border border-line bg-surface p-6 shadow-[0_16px_48px_rgba(20,20,19,0.16)]">
          <AlertDialog.Title className="text-[17px] font-semibold tracking-[-0.01em]">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="mt-2 text-[14px] leading-6 text-slate">{body}</div>
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button>Cancel</Button>
            </AlertDialog.Cancel>
            <Button variant={destructive ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

type Tone = 'ok' | 'warn' | 'err' | 'neutral' | 'info';
const TONES: Record<Tone, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  err: 'bg-err-bg text-err',
  neutral: 'bg-subtle text-slate',
  info: 'bg-ink text-white',
};
export function Pill({
  tone = 'neutral',
  children,
  dot = true,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={cx(
        'inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[12px] font-medium',
        TONES[tone],
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-ui border border-line bg-surface', className)}>{children}</section>;
}

export function Callout({
  tone = 'warn',
  title,
  children,
  action,
}: {
  tone?: 'warn' | 'err' | 'neutral';
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const t =
    tone === 'err'
      ? 'border-err/25 bg-err-bg/60'
      : tone === 'warn'
        ? 'border-warn/25 bg-warn-bg/60'
        : 'border-line bg-subtle';
  return (
    <div
      className={cx(
        'flex flex-col gap-3 rounded-ui border p-4 sm:flex-row sm:items-start sm:justify-between',
        t,
      )}
      role={tone === 'err' ? 'alert' : 'status'}
    >
      <div className="flex flex-col gap-1">
        <p
          className={cx(
            'text-[14px] font-semibold',
            tone === 'err' ? 'text-err' : tone === 'warn' ? 'text-warn' : 'text-ink',
          )}
        >
          {title}
        </p>
        {children && <div className="text-[13px] leading-5 text-ink/80">{children}</div>}
      </div>
      {action && <div className="flex shrink-0 gap-2">{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-slate" role="status">
      <Loader2 size={15} className="animate-spin" aria-hidden="true" />
      {label}
    </span>
  );
}
