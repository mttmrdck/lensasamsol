export function PublicMessage({
  title,
  body,
  action,
  retry,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
  retry?: () => void;
}) {
  return (
    <main className="grid min-h-svh place-items-center bg-canvas px-6 py-24">
      <div className="flex max-w-[460px] flex-col items-center gap-4 text-center">
        <h1 className="font-display text-[40px] leading-[1.05] tracking-[-0.015em] sm:text-[48px]">
          {title}
        </h1>
        <p className="text-[15px] leading-6 text-slate">{body}</p>
        <div className="mt-3 flex gap-3">
          {retry && (
            <button
              type="button"
              onClick={retry}
              className="h-11 rounded-full bg-ink px-5 text-[14px] font-medium text-white hover:bg-ink-2"
            >
              Try again
            </button>
          )}
          {action && (
            <a
              href={action.href}
              className="inline-flex h-11 items-center rounded-full border border-line-strong px-5 text-[14px] font-medium hover:border-ink"
            >
              {action.label}
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
