import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { LayoutGrid, List, Plus, Search } from 'lucide-react';
import { api } from '../../lib/api';
import type { AdminCollectionSummary } from '../../../shared/api';
import { formatDate, imgUrl } from '../../lib/format';
import { Input, Segmented } from '../../components/ui';
import {
  CollectionCard,
  CopyClientLinkButton,
  PageHeader,
  StatusPill,
  SyncLine,
} from '../../components/admin/bits';

type Filter = 'all' | 'published' | 'draft' | 'issue';
type Sort = 'event' | 'updated' | 'title';

function readPref<T extends string>(k: string, fallback: T): T {
  try {
    return (localStorage.getItem(k) as T) || fallback;
  } catch {
    return fallback;
  }
}

export default function CollectionsPage() {
  const q = useQuery({
    queryKey: ['collections'],
    queryFn: () => api<{ collections: AdminCollectionSummary[] }>('/api/admin/collections'),
  });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('event');
  const [view, setView] = useState<'grid' | 'list'>(() => readPref('archive.view', 'grid'));
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem('archive.view', view);
    } catch {
      /* preference only */
    }
  }, [view]);

  // "/" focuses search.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, []);

  const all = useMemo(() => q.data?.collections ?? [], [q.data]);
  const list = useMemo(() => {
    const t = query.trim().toLowerCase();
    return all
      .filter((c) =>
        filter === 'all' ? true : filter === 'issue' ? c.syncStatus === 'error' : c.status === filter,
      )
      .filter(
        (c) =>
          !t ||
          c.title.toLowerCase().includes(t) ||
          (c.clientName ?? '').toLowerCase().includes(t) ||
          (c.eventDate ?? '').includes(t) ||
          formatDate(c.eventDate).toLowerCase().includes(t),
      )
      .sort((a, b) =>
        sort === 'title'
          ? a.title.localeCompare(b.title)
          : sort === 'updated'
            ? b.updatedAt.localeCompare(a.updatedAt)
            : (b.eventDate ?? '').localeCompare(a.eventDate ?? ''),
      );
  }, [all, query, filter, sort]);

  const count = (f: Filter) =>
    all.filter((c) => (f === 'all' ? true : f === 'issue' ? c.syncStatus === 'error' : c.status === f))
      .length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Client Galleries"
        sub={q.data ? `${all.length} client galleries, each with its own private link` : undefined}
      >
        <Link
          to="/admin/collections/new"
          className="inline-flex h-9 items-center gap-2 rounded-ui bg-ink px-3.5 text-[14px] font-medium text-white hover:bg-ink-2"
        >
          <Plus size={16} aria-hidden="true" /> Create Client Gallery
        </Link>
      </PageHeader>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-[300px]">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search client, title or date"
            className="pl-9"
            aria-label="Search client galleries"
          />
        </div>
        <div className="-mx-4 flex items-center gap-3 overflow-x-auto px-4 lg:mx-0 lg:flex-1 lg:px-0">
          <div className="min-w-[340px] flex-1 lg:max-w-[420px]">
            <Segmented<Filter>
              label="Status"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `All ${count('all')}` },
                { value: 'published', label: `Shared ${count('published')}` },
                { value: 'draft', label: `Draft ${count('draft')}` },
                { value: 'issue', label: `Sync issue ${count('issue')}` },
              ]}
            />
          </div>
          <label className="sr-only" htmlFor="sort">
            Sort
          </label>
          <select
            id="sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-9 shrink-0 rounded-ui border border-line bg-surface px-2.5 text-[13px]"
          >
            <option value="event">Newest event date</option>
            <option value="updated">Recently updated</option>
            <option value="title">Alphabetical</option>
          </select>
          <div className="ml-auto w-[88px] shrink-0">
            <Segmented
              label="View"
              value={view}
              onChange={setView}
              options={[
                { value: 'grid', label: <LayoutGrid size={15} aria-label="Grid view" /> },
                { value: 'list', label: <List size={15} aria-label="List view" /> },
              ]}
            />
          </div>
        </div>
      </div>

      {q.isPending ? (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="aspect-[3/2.6] animate-pulse rounded-ui bg-placeholder" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <p className="rounded-ui border border-dashed border-line-strong px-6 py-12 text-center text-[14px] text-slate">
          {all.length === 0
            ? 'No client galleries yet. Create one from a Google Drive folder.'
            : 'No client galleries match these filters.'}
        </p>
      ) : view === 'grid' ? (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((c) => (
            <CollectionCard key={c.id} c={c} />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-ui border border-line bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line bg-subtle/60 text-slate">
              <tr>
                <th className="px-4 py-2.5 font-medium">Client gallery</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Event date</th>
                <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Photos</th>
                <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Drive sync</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-2 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((c) => (
                <tr key={c.id} className="hover:bg-subtle/50">
                  <td className="px-4 py-2">
                    <Link
                      to={`/admin/collections/${c.id}`}
                      className="flex items-center gap-3 font-medium hover:underline"
                    >
                      <span className="h-9 w-12 shrink-0 bg-placeholder">
                        {c.cover && (
                          <img
                            src={imgUrl(c.cover.id, 's')}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        )}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{c.clientName ?? c.title}</span>
                        {c.clientName && (
                          <span className="truncate text-[12px] font-normal text-slate">{c.title}</span>
                        )}
                      </span>
                    </Link>
                  </td>
                  <td className="tnum hidden px-4 py-2 text-slate md:table-cell">
                    {formatDate(c.eventDate, 'short') || 'No date'}
                  </td>
                  <td className="tnum hidden px-4 py-2 text-slate sm:table-cell">
                    {c.photoCount.toLocaleString('en-GB')}
                  </td>
                  <td className="hidden px-4 py-2 text-slate lg:table-cell">
                    <SyncLine c={c} />
                  </td>
                  <td className="px-4 py-2">
                    <StatusPill c={c} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <CopyClientLinkButton c={c} variant="icon" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
