// SQLite-only rehearsal: never opens .wrangler state or a Cloudflare database.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
process.chdir(resolve(import.meta.dirname, '..'));
const python = String.raw`
import sqlite3, pathlib, tempfile, json, re
migrations = sorted(pathlib.Path('migrations').glob('*.sql'))
assert migrations and any(p.name.startswith('0005_') for p in migrations)
checks = []
def check(condition, label):
    assert condition, label
    checks.append(label)
def apply(db, paths):
    for path in paths: db.executescript(path.read_text())
def connect(path):
    db = sqlite3.connect(path)
    db.execute('PRAGMA foreign_keys=ON')
    return db
with tempfile.TemporaryDirectory(prefix='archive-migrations-') as folder:
    clean = connect(str(pathlib.Path(folder) / 'clean.sqlite'))
    apply(clean, migrations)
    check(clean.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'all migrations apply to empty database')
    upgrade = connect(str(pathlib.Path(folder) / 'upgrade.sqlite'))
    before = [p for p in migrations if p.name < '0004']
    after = [p for p in migrations if p.name >= '0004']
    apply(upgrade, before)
    draft = json.dumps({'theme':'editorial','actions':{'showFolderButton':True},'layout':{'columns':3}})
    published = json.dumps({'theme':'published','actions':{'showFolderButton':True}})
    upgrade.execute('UPDATE studio_settings SET studio_name=?, default_style_json=? WHERE id=1', ('Owner Studio', draft))
    for i, status in enumerate(['draft','published']):
        upgrade.execute('''INSERT INTO collections
          (id,slug,title,source,drive_folder_id,drive_resource_key,status,style_draft_json,style_published_json,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)''', (f'c{i}',f'slug{i}',f'Client {i}','drive',f'original-folder-{i}',f'key-{i}',status,draft,published if i else None,'then','then'))
        for hidden in [0,1]:
            upgrade.execute('''INSERT INTO photos
              (id,collection_id,drive_file_id,filename,mime_type,width,height,sort_order,hidden,featured,source_version,resource_key,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', (f'p{i}{hidden}',f'c{i}',f'original-file-{i}-{hidden}','image.jpg','image/jpeg',1200,800,hidden,hidden,1,'v1','photo-key','then','then'))
        upgrade.execute('INSERT INTO sync_runs (id,collection_id,trigger,started_at,status) VALUES (?,?,?,?,?)', (f'sync{i}',f'c{i}','manual','then','success'))
    upgrade.execute('INSERT INTO sessions (token_hash,created_at,expires_at,pw_fp) VALUES (?,?,?,?)', ('session',1,9999999999,'fingerprint'))
    upgrade.execute('INSERT INTO oauth_states (state,code_verifier,created_at) VALUES (?,?,?)', ('state','verifier',1))
    upgrade.execute('INSERT INTO google_connections (id,email,scopes,refresh_token_enc,connected_at) VALUES (1,?,?,?,?)', ('owner@example.com','drive.readonly','opaque-encrypted-original','then'))
    upgrade.commit()
    apply(upgrade, after)
    rows = upgrade.execute('SELECT id,status,drive_folder_id,drive_resource_key,style_draft_json,style_published_json,assignment_mode,share_token,share_token_created_at FROM collections ORDER BY id').fetchall()
    tokens = [r[7] for r in rows]
    check(len(tokens) == len(set(tokens)) and all(re.fullmatch('[0-9a-f]{32}', t) for t in tokens), 'unique random 128-bit share tokens backfilled')
    check(all(r[8] for r in rows), 'share-token creation dates backfilled')
    for i, row in enumerate(rows):
        check(row[1] == ['draft','published'][i] and row[2] == f'original-folder-{i}' and row[3] == f'key-{i}' and row[6] == 'all', f'gallery {i} status and Drive reference retained')
        expected = json.loads(draft); expected['actions']['showFolderButton'] = False
        check(json.loads(row[4]) == expected, f'gallery {i} draft style retained with folder button safely disabled')
        if i:
            expected_pub = json.loads(published); expected_pub['actions']['showFolderButton'] = False
            check(json.loads(row[5]) == expected_pub, 'published style retained with folder button safely disabled')
        else: check(row[5] is None, 'unpublished style remains null')
    photos = upgrade.execute('SELECT hidden,assigned,featured,drive_file_id,resource_key FROM photos ORDER BY id').fetchall()
    check(len(photos) == 4 and all(p[1] == (0 if p[0] else 1) and p[2] == 1 and p[3].startswith('original-file-') and p[4] == 'photo-key' for p in photos), 'hidden-to-assigned backfill and featured/Drive metadata preserved')
    check(upgrade.execute('SELECT studio_name FROM studio_settings').fetchone()[0] == 'Owner Studio', 'owner studio name retained')
    default_style = json.loads(upgrade.execute('SELECT default_style_json FROM studio_settings').fetchone()[0])
    check(default_style['theme'] == 'editorial' and default_style['actions']['showFolderButton'] is False, 'default style retained with folder button safely disabled')
    check(upgrade.execute('SELECT refresh_token_enc FROM google_connections').fetchone()[0] == 'opaque-encrypted-original', 'stored Google connection unchanged')
    check(upgrade.execute('SELECT session_hash FROM oauth_states WHERE state=?',('state',)).fetchone() == (None,), 'legacy OAuth state gets null session binding')
    check(upgrade.execute('SELECT admin_username,pw_fp FROM sessions WHERE token_hash=?',('session',)).fetchone() == (None,'fingerprint'), 'session admin_username added without changing fingerprint')
    upgrade.execute('UPDATE oauth_states SET session_hash=? WHERE state=?', ('session','state'))
    upgrade.execute('UPDATE sessions SET admin_username=? WHERE token_hash=?', ('operator-one','session'))
    check(upgrade.execute('SELECT admin_username FROM sessions').fetchone()[0] == 'operator-one', 'new administrator attribution writable')
    indexes = {r[0] for r in upgrade.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    check({'collections_share_token','photos_collection_assigned','photos_collection_order','sessions_expires','oauth_states_created_at','sync_runs_collection'}.issubset(indexes), 'required indexes exist')
    try:
        upgrade.execute('UPDATE collections SET share_token=? WHERE id=?',(tokens[0],'c1'))
        raise AssertionError('duplicate share token accepted')
    except sqlite3.IntegrityError: pass
    check(True, 'share-token uniqueness enforced')
    check(not upgrade.execute('PRAGMA foreign_key_check').fetchall(), 'foreign keys valid after upgrade')
    upgrade.execute('DELETE FROM collections WHERE id=?', ('c0',))
    check(upgrade.execute('SELECT count(*) FROM photos WHERE collection_id=?',('c0',)).fetchone()[0] == 0 and upgrade.execute('SELECT count(*) FROM sync_runs WHERE collection_id=?',('c0',)).fetchone()[0] == 0, 'gallery deletion cascades only to metadata photos and sync runs')
    check(upgrade.execute('SELECT count(*) FROM photos').fetchone()[0] == 2, 'other gallery preserved on cascade')
    check(upgrade.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'upgrade integrity check passes')
    check(not upgrade.execute('PRAGMA foreign_key_check').fetchall(), 'foreign keys valid after cascade')
    # These checks execute local SQL only; no Drive client, network, original file or real database is used.
    clean.close(); upgrade.close()
print(json.dumps({'ok':True,'engine':'python sqlite3','migrations':[p.name for p in migrations],'checks':checks,'realAccountTest':'BLOCKED_REAL_ACCOUNT_TEST'}, indent=2))
`;
const result = spawnSync('python3', ['-c', python], { encoding: 'utf8' });
mkdirSync('test-results', { recursive: true });
if (result.status !== 0) {
  writeFileSync('test-results/migrations.json', JSON.stringify({ ok: false, error: result.stderr }, null, 2) + '\n');
  console.error(result.stderr);
  process.exit(1);
}
writeFileSync('test-results/migrations.json', result.stdout);
const report = JSON.parse(result.stdout);
console.log(`${report.migrations.length} migrations; ${report.checks.length} isolated SQLite checks passed. Report: test-results/migrations.json`);
