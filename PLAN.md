# Plan & acceptance matrix

Phases executed: 0 audit/spike → 1 foundation (schema, worker, auth, demo seed) → 2 public experience →
3 admin workflows → 4 live editor → 5 Drive integration code + hardening → 6 browser QA & iteration.

## Client gallery correction (acceptance)

Product: one photographer manages multiple client-specific galleries, each shared through an independent
link that displays only that client's assigned photographs.

| #     | Requirement                                                     | Status                                         | Evidence (`tests/e2e/isolation.spec.ts` unless noted)                         |
| ----- | --------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| 1–2   | Admin creates Gallery A (UI) and Gallery B (shared folder)      | Done                                           | `1–4, 13` and `2–3` tests                                                     |
| 3     | Different photos assigned to each                               | Done                                           | B starts with 0 assigned, 3 assigned by clicking tiles                        |
| 4, 13 | Link generated; Copy Link returns the published URL             | Done                                           | clipboard value = `/g/<token>` shown in the link field                        |
| 5–6   | Link shows only Gallery A; B never appears                      | Done                                           | payload + page text checks, no overlapping IDs, no leaked fields              |
| 7–8   | Homepage/public API never list galleries                        | Done                                           | `/` has no gallery links; legacy listing endpoints 404                        |
| 9     | A's link can't load B's images                                  | Done                                           | `/img/t/<A>/<B photo>` → 404; unassigned photos 404                           |
| 10–11 | Drafts and unpublished galleries closed                         | Done                                           | seeded draft 404; unpublish → JSON + images 404                               |
| 12    | Regenerate invalidates the old link; revoke closes all          | Done                                           | old token 404, new 200; revoke → null token                                   |
| 14    | Deep links are gallery-scoped                                   | Done                                           | B's photo ID on A's page opens nothing                                        |
| 15    | Download buttons open the intended Drive file, never the folder | Done (test fixture links, not real Drive)      | exact `drive.google.com/file/d/<id>/view` hrefs                               |
| 16    | Mobile responsive                                               | Done                                           | `public.spec.ts` 390/360 overflow tests; screenshots at 1440/1024/768/390/360 |
| —     | Drive-side isolation (sharing)                                  | **Not verified** — needs a real Google account | README “Drive sharing for clients”                                            |

## Earlier acceptance (still covered)

Viewer keyboard/back/deep link, focus trap, 1,200-photo virtualisation, reduced motion, editor draft vs
publish, CSRF/session protection — `public.spec.ts`, `admin.spec.ts`. Production deploy remains blocked on
the owner's Cloudflare account.

## Camera iris entrance (acceptance)

All 20 brief items are covered by `tests/e2e/intro.spec.ts` (18 tests; some items combined): plays on a
direct link over the real gallery; reveals that gallery's own cover (checked for three galleries); no replay
on reload, photo navigation or Back; `?photo=` opens directly; Skip; reduced motion; invalid link → Not Found
without iris; absent on `/`, login, admin, editor and client preview; slow (6 s) and failed covers release the
visitor within the bounded wait; route change mid-intro cleans up overlay and scroll lock; no overflow at
390/360 px during and after; keyboard reaches the gallery immediately. Geometry: `tests/unit/iris.test.ts`.
Not verified: real Safari/Firefox and physical phones (only Chromium was available).
