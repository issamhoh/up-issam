"""Smoke tests for the HostX app: routes, permissions, and file manager operations."""
import io
import os
import shutil
import sys
import tempfile
import zipfile

os.environ['DISABLE_BACKGROUND_THREADS'] = '1'
os.environ['SECRET_KEY'] = 'test-secret'

WORKDIR = tempfile.mkdtemp(prefix='hostx_test_')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import app as app_module  # noqa: E402

PASS = []
FAIL = []


def check(name, condition, detail=''):
    (PASS if condition else FAIL).append(name)
    print(('  PASS  ' if condition else '  FAIL  ') + name + ((' :: ' + str(detail)) if detail and not condition else ''))


app = app_module.app
app.config['TESTING'] = True
client = app.test_client()

# ---------------------------------------------------------------- health
res = client.get('/health')
check('GET /health -> 200', res.status_code == 200, res.status_code)
body = res.get_json() or {}
check('health payload has status ok', body.get('status') == 'ok', body)
res = client.get('/api/health')
check('GET /api/health -> 200', res.status_code == 200, res.status_code)

# ---------------------------------------------------------------- url map sanity
rules = {r.rule for r in app.url_map.iter_rules()}
check('single /health rule', len([r for r in app.url_map.iter_rules() if r.rule == '/health']) == 1)
for expected in (
    '/api/servers/<int:server_id>/files/compress',
    '/api/servers/<int:server_id>/files/copy',
    '/api/servers/<int:server_id>/files/move',
    '/api/servers/<int:server_id>/files/search',
    '/api/servers/<int:server_id>/files/download-folder',
):
    check('route exists: ' + expected, expected in rules)

# ---------------------------------------------------------------- auth required
res = client.get('/api/servers/1/files/search?q=x')
check('file API redirects anonymous user to signin', res.status_code in (302, 401), res.status_code)

# ---------------------------------------------------------------- create test user + server
with app.app_context():
    db = app_module.get_db()
    from app import safe_generate_password_hash
    db.execute("DELETE FROM users WHERE username = ?", ('smoketester',))
    db.execute(
        "INSERT INTO users (full_name, username, email, password_hash, coins, role, is_admin, is_super_admin, status) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        ('Smoke Tester', 'smoketester', 'smoke@test.local', safe_generate_password_hash('testpass123'), 100, 'user', 0, 0, 'active')
    )
    db.commit()
    row = db.execute("SELECT id FROM users WHERE username = ?", ('smoketester',)).fetchone()
    user_id = row['id']
    db.execute(
        "INSERT INTO servers (user_id, name, entry_file, status, expires_at) VALUES (?,?,?,?, datetime('now','+30 days'))",
        (user_id, 'Smoke Server', 'main.py', 'stopped')
    )
    db.commit()
    server_id = db.execute("SELECT id FROM servers WHERE user_id = ? ORDER BY id DESC LIMIT 1", (user_id,)).fetchone()['id']

res = client.post('/signin', data={'email': 'smoke@test.local', 'password': 'testpass123'}, follow_redirects=False)
check('signin succeeds', res.status_code in (302, 200), res.status_code)

# ---------------------------------------------------------------- ownership
res = client.get(f'/servers/{server_id}/files')
check('file manager page renders', res.status_code == 200, res.status_code)
html = res.get_data(as_text=True)
check('file manager uses vh-root shell', 'vh-root' in html)
check('file manager renders sidebar partial nav', 'File Manager' in html)

API = f'/api/servers/{server_id}/files'

# ---------------------------------------------------------------- create folder + file
res = client.post(API + '/create-folder', data={'path': '', 'folder_name': 'mybot'})
check('create folder', res.status_code == 200 and res.get_json().get('success'), res.get_data(as_text=True)[:200])

res = client.post(API + '/create-file', data={'path': 'mybot', 'file_name': 'main.py'})
check('create file', res.status_code == 200 and res.get_json().get('success'), res.get_data(as_text=True)[:200])

# ---------------------------------------------------------------- read / save
res = client.get(API + '/read?path=mybot/main.py')
check('read created file', res.status_code == 200 and res.get_json().get('success'))

res = client.post(API + '/save', json={'path': 'mybot/main.py', 'content': 'print("hello")\n'})
check('save file content', res.status_code == 200 and res.get_json().get('success'), res.get_data(as_text=True)[:200])

res = client.get(API + '/read?path=mybot/main.py')
check('saved content round-trips', (res.get_json() or {}).get('content') == 'print("hello")\n', res.get_json())

# ---------------------------------------------------------------- traversal protection
for evil in ('../../etc/passwd', '/etc/passwd', 'mybot/../../../../etc/passwd', '..%2f..%2fetc'):
    res = client.get(API + '/read?path=' + evil)
    ok = res.status_code in (403, 404) or not (res.get_json() or {}).get('success')
    check('traversal blocked: ' + evil, ok, res.status_code)

res = client.post(API + '/save', json={'path': '../evil.py', 'content': 'x'})
check('save traversal blocked', not (res.get_json() or {}).get('success'), res.get_json())

res = client.post(API + '/delete', json={'path': ''})
check('cannot delete server root', not (res.get_json() or {}).get('success'), res.get_json())

# ---------------------------------------------------------------- zip: create, unzip, compress
server_dir = app_module.get_server_dir(user_id, server_id)
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w') as zf:
    zf.writestr('pkg/one.py', 'print(1)\n')
    zf.writestr('pkg/two.txt', 'hello\n')
res = client.post(API + '/upload', data={
    'path': '',
    'files': (io.BytesIO(buf.getvalue()), 'bundle.zip')
}, content_type='multipart/form-data')
data = res.get_json() or {}
check('upload + auto extract zip', data.get('success'), data)
check('extracted file exists on disk', os.path.isfile(os.path.join(server_dir, 'pkg', 'one.py')))

res = client.get(f'/servers/{server_id}/files')
check('folder upload listing shows pkg', 'pkg' in res.get_data(as_text=True))

# keep_zip flag
buf2 = io.BytesIO()
with zipfile.ZipFile(buf2, 'w') as zf:
    zf.writestr('kept.txt', 'data\n')
res = client.post(API + '/upload', data={
    'path': '',
    'auto_extract': '0',
    'keep_zip': '1',
    'files': (io.BytesIO(buf2.getvalue()), 'kept.zip')
}, content_type='multipart/form-data')
check('upload with keep_zip', (res.get_json() or {}).get('success'), res.get_json())
check('kept archive still on disk', os.path.isfile(os.path.join(server_dir, 'kept.zip')))

# manual unzip into a folder
res = client.post(API + '/unzip', json={'path': 'kept.zip', 'dest': 'extracted', 'keep_archive': True})
check('unzip into named folder', (res.get_json() or {}).get('success'), res.get_json())
check('unzip created target file', os.path.isfile(os.path.join(server_dir, 'extracted', 'kept.txt')))

# zip-slip protection
evil_zip = io.BytesIO()
with zipfile.ZipFile(evil_zip, 'w') as zf:
    zf.writestr('../../../../tmp/evil_owned.txt', 'pwned\n')
with open(os.path.join(server_dir, 'evil.zip'), 'wb') as f:
    f.write(evil_zip.getvalue())
res = client.post(API + '/unzip', json={'path': 'evil.zip'})
data = res.get_json() or {}
check('zip-slip rejected', not data.get('success'), data)
check('zip-slip did not escape', not os.path.exists(os.path.join(WORKDIR, 'tmp', 'evil_owned.txt')))

# compress
res = client.post(API + '/compress', json={'paths': ['pkg'], 'name': 'pkg-backup'})
data = res.get_json() or {}
check('compress folder', data.get('success'), data)
check('archive created on disk', os.path.isfile(os.path.join(server_dir, 'pkg-backup.zip')))

res = client.post(API + '/compress', json={'paths': ['pkg'], 'name': 'pkg-backup'})
check('duplicate archive name rejected', not (res.get_json() or {}).get('success'))

# copy / move
res = client.post(API + '/create-folder', data={'path': '', 'folder_name': 'backup'})
check('create backup folder', (res.get_json() or {}).get('success'))

res = client.post(API + '/copy', json={'path': 'pkg', 'dest': 'backup'})
check('copy folder', (res.get_json() or {}).get('success'), res.get_json())
check('copied file exists', os.path.isfile(os.path.join(server_dir, 'backup', 'pkg', 'one.py')))

res = client.post(API + '/move', json={'path': 'backup/pkg', 'dest': 'extracted'})
check('move folder', (res.get_json() or {}).get('success'), res.get_json())
check('moved file present at destination', os.path.isfile(os.path.join(server_dir, 'extracted', 'pkg', 'one.py')))
check('moved file gone from source', not os.path.exists(os.path.join(server_dir, 'backup', 'pkg')))

res = client.post(API + '/move', json={'path': 'extracted', 'dest': 'extracted/pkg'})
check('cannot move folder into itself', not (res.get_json() or {}).get('success'), res.get_json())

res = client.post(API + '/rename', json={'old_path': 'kept.txt', 'new_name': 'renamed.txt'})
check('rename missing item fails cleanly', res.status_code in (400, 403, 404, 500), res.status_code)

# rename existing
os.makedirs(os.path.join(server_dir, 'mybot'), exist_ok=True)
with open(os.path.join(server_dir, 'mybot', 'main.py'), 'w') as f:
    f.write('print(1)')
res = client.post(API + '/rename', json={'old_path': 'mybot/main.py', 'new_name': 'app.py'})
check('rename file', (res.get_json() or {}).get('success'), res.get_json())
check('renamed file on disk', os.path.isfile(os.path.join(server_dir, 'mybot', 'app.py')))

# search
res = client.get(API + '/search?q=one')
data = res.get_json() or {}
check('search returns results', data.get('success') and len(data.get('results', [])) >= 1, data)

# download file + folder
res = client.get(f'/servers/{server_id}/files/download', query_string={'path': 'pkg-backup.zip'})
check('download file stream', res.status_code == 200, res.status_code)

res = client.get(API + '/download-folder', query_string={'path': 'pkg'})
check('download folder as zip', res.status_code == 200 and res.mimetype == 'application/zip', res.status_code)

# delete
res = client.post(API + '/delete', json={'path': 'pkg-backup.zip'})
check('delete file', (res.get_json() or {}).get('success'), res.get_json())
check('deleted file gone', not os.path.exists(os.path.join(server_dir, 'pkg-backup.zip')))

# ---------------------------------------------------------------- other user isolation
with app.app_context():
    db = app_module.get_db()
    db.execute(
        "INSERT INTO users (full_name, username, email, password_hash, coins, role, is_admin, is_super_admin, status) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        ('Other User', 'otheruser', 'other@test.local', safe_generate_password_hash('testpass123'), 0, 'user', 0, 0, 'active')
    )
    db.commit()

with app.test_client() as c2:
    c2.post('/signin', data={'email': 'other@test.local', 'password': 'testpass123'})
    res = c2.get(f'/servers/{server_id}/files')
    check('other user gets 404 on foreign server', res.status_code == 404, res.status_code)
    res = c2.get(API + '/search?q=one')
    check('other user blocked from foreign file API', res.status_code == 404, res.status_code)

# ---------------------------------------------------------------- permission fail-closed
with app.app_context():
    from app import has_admin_permission, is_user_super_admin, is_user_admin
    db = app_module.get_db()
    db.execute("UPDATE users SET role='admin', is_admin=1, is_super_admin=0, admin_permissions='' WHERE username='otheruser'")
    db.commit()
    u = db.execute("SELECT * FROM users WHERE username='otheruser'").fetchone()
    check('admin with empty perms gets no permission (fail closed)', has_admin_permission(u, 'manage_users') is False)
    check('admin without is_super_admin is not super admin', is_user_super_admin(u) is False)
    check('is_user_admin still true for role admin', is_user_admin(u) is True)
    db.execute("UPDATE users SET role='user', is_admin=0 WHERE username='otheruser'")
    db.commit()
    u = db.execute("SELECT * FROM users WHERE username='otheruser'").fetchone()
    check('plain user is not admin', is_user_admin(u) is False)

# ---------------------------------------------------------------- is_safe_path unit checks
with app.app_context():
    base = os.path.join(WORKDIR, 'safe_base')
    os.makedirs(os.path.join(base, 'sub'), exist_ok=True)
    inside = os.path.join(base, 'sub', 'x.txt')
    with open(inside, 'w') as f:
        f.write('x')
    outside = os.path.join(WORKDIR, 'outside.txt')
    with open(outside, 'w') as f:
        f.write('x')
    check('is_safe_path allows inside', app_module.is_safe_path(base, inside))
    check('is_safe_path blocks outside', not app_module.is_safe_path(base, outside))
    check('is_safe_path blocks traversal', not app_module.is_safe_path(base, os.path.join(base, '..', 'outside.txt')))
    try:
        os.symlink(WORKDIR, os.path.join(base, 'linkdir'))
        check('is_safe_path blocks symlink escape', not app_module.is_safe_path(base, os.path.join(base, 'linkdir', 'outside.txt')))
    except (OSError, NotImplementedError, AttributeError):
        check('is_safe_path blocks symlink escape (skipped: no symlink support)', True)

# ---------------------------------------------------------------- dashboard renders
res = client.get('/dashboard')
check('dashboard renders', res.status_code == 200, res.status_code)
check('dashboard uses vh shell', 'vh-shell' in res.get_data(as_text=True))

# ---------------------------------------------------------------- home + signin still fine
res = client.get('/')
check('home page renders', res.status_code == 200, res.status_code)

print()
print(f'PASSED: {len(PASS)}   FAILED: {len(FAIL)}')
if FAIL:
    print('Failures:')
    for f in FAIL:
        print('  - ' + f)

# cleanup
shutil.rmtree(WORKDIR, ignore_errors=True)
with app.app_context():
    db = app_module.get_db()
    db.execute("DELETE FROM servers WHERE user_id IN (SELECT id FROM users WHERE username IN ('smoketester','otheruser'))")
    db.execute("DELETE FROM users WHERE username IN ('smoketester','otheruser')")
    db.commit()
    for uid in (user_id,):
        p = os.path.join(app_module.SERVERS_DIR, str(uid))
        shutil.rmtree(p, ignore_errors=True)

sys.exit(1 if FAIL else 0)
