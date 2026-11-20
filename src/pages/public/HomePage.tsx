import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { studioResponseSchema } from '../../../shared/api';
import { apiParsed } from '../../lib/api';

/**
 * Studio landing page. Deliberately knows nothing about client galleries: there is no directory,
 * and the API behind it returns only the studio's name, introduction and contact link.
 */
export default function HomePage() {
  const q = useQuery({
    queryKey: ['studio'],
    queryFn: () => apiParsed('/api/public/studio', studioResponseSchema),
  });
  const studio = q.data?.studio;

  useEffect(() => {
    if (studio) document.title = studio.name;
  }, [studio]);

  return (
    <div className="flex min-h-svh flex-col bg-canvas text-ink">
      <header className="mx-auto flex h-[76px] w-full max-w-[1440px] items-center justify-between px-4 sm:px-12">
        <span className="flex items-center gap-2.5">
          <img src="/brand/icon-48.png" alt="" width={26} height={26} className="h-[26px] w-[26px]" />
          <span className="text-[15px] font-medium tracking-[-0.01em]">{studio?.name ?? 'lensasamsol'}</span>
        </span>
        {studio?.contactUrl && (
          <a
            href={studio.contactUrl}
            className="inline-flex min-h-11 items-center text-[14px] text-slate hover:text-ink"
            rel="noopener noreferrer"
          >
            {studio.contactLabel || 'Contact'}
          </a>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col justify-center px-4 py-20 sm:px-12">
        <h1 className="max-w-[14ch] font-display text-[clamp(3rem,1.6rem+6vw,8rem)] leading-[0.95] tracking-[-0.03em]">
          {studio?.name ?? 'lensasamsol'}
        </h1>
        {studio?.intro && (
          <p className="mt-8 max-w-[46ch] text-[18px] leading-[1.6] text-slate">{studio.intro}</p>
        )}
        <div className="mt-14 max-w-[52ch] border-t border-line pt-6 text-[15px] leading-[1.65] text-slate">
          <p>
            Galleries are delivered privately to each client. If you received a gallery link, open it
            directly; it leads straight to your photographs.
          </p>
          {studio?.contactUrl && (
            <p className="mt-3">
              Lost your link?{' '}
              <a
                href={studio.contactUrl}
                className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                rel="noopener noreferrer"
              >
                Get in touch
              </a>{' '}
              and we’ll send it again.
            </p>
          )}
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-4 py-8 text-[13px] text-slate sm:flex-row sm:justify-between sm:px-12">
          <span>
            © {new Date().getFullYear()} {studio?.name ?? 'lensasamsol'}
          </span>
          {q.data?.demoMode && <span>Demo mode: sample galleries use licensed placeholder imagery.</span>}
        </div>
      </footer>
    </div>
  );
}
