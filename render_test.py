"""Render every GET-able page as admin + regular user to catch template errors."""
import io
import os
import sys

os.environ['DISABLE_BACKGROUND_THREADS'] = '1'
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import app as app_module  # noqa: E402
from app import safe_generate_password_hash  # noqa: E402

app = app_module.app
app.config['TESTING'] = True

FAILS = []

with app.app_context():
    db = app_module.get_db()
    for uname, email, role in (('rtest', 'rtest@test.local', 'user'), ('atest', 'atest@test.local', 'super_admin')):
        db.execute("DELETE FROM users WHERE username = ?", (uname,))
        db.execute(
            "INSERT INTO users (full_name, username, email, password_hash, coins, role, is_admin, is_super_admin, admin_permissions, status) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            ('Render Tester', uname, email, safe_generate_password_hash('testpass123'), 50, role,
             1 if role != 'user' else 0, 1 if role == 'super_admin' else 0,
             'manage_users,manage_coins,manage_files,manage_settings,manage_announcements,manage_broadcasts,view_logs', 'active')
        )
        db.commit()
        db.execute(
            "INSERT INTO servers (user_id, name, entry_file, status, expires_at) VALUES (?,?,?,?, datetime('now','+30 days'))",
            (db.execute("SELECT id FROM users WHERE username=?", (uname,)).fetchone()['id'], 'Render Server', 'main.py', 'stopped')
        )
        db.commit()

with app.app_context():
    db = app_module.get_db()
    uid = db.execute("SELECT id FROM users WHERE username='rtest'").fetchone()['id']
    sid = db.execute("SELECT id FROM servers WHERE user_id=?", (uid,)).fetchone()['id']

PATHS_USER = [
    '/', '/signin', '/signup', '/dashboard', '/packages', '/coins', '/account',
    f'/servers/{sid}', f'/servers/{sid}/files', f'/servers/{sid}/startup',
    f'/servers/{sid}/files?path=',
]
PATHS_ADMIN = [
    '/admin', '/admin/users', '/admin/coins', '/admin/files', '/admin/settings',
    '/admin/announcements', '/admin/broadcast', '/admin/logs',
]


def run(paths, email, label):
    client = app.test_client()
    r = client.post('/signin', data={'email': email, 'password': 'testpass123'})
    for p in paths:
        res = client.get(p, follow_redirects=True)
        ok = res.status_code == 200
        marker = 'OK  ' if ok else 'FAIL'
        if not ok:
            FAILS.append((label, p, res.status_code))
        print(f'  {marker} [{label}] {p} -> {res.status_code}')
        if not ok:
            body = res.get_data(as_text=True)
            for line in body.splitlines():
                if 'Error' in line or 'error' in line.lower() and 'Exception' in line:
                    print('        ' + line.strip()[:200])
                    break


print('--- regular user ---')
run(PATHS_USER, 'rtest@test.local', 'user')
print('--- admin ---')
run(PATHS_USER + PATHS_ADMIN, 'atest@test.local', 'admin')

# cleanup
with app.app_context():
    db = app_module.get_db()
    ids = [r['id'] for r in db.execute("SELECT id FROM users WHERE username IN ('rtest','atest')").fetchall()]
    if ids:
        marks = ','.join('?' * len(ids))
        db.execute(f"DELETE FROM servers WHERE user_id IN ({marks})", ids)
        db.execute(f"DELETE FROM users WHERE id IN ({marks})", ids)
        db.commit()
    import shutil
    for i in ids:
        shutil.rmtree(os.path.join(app_module.SERVERS_DIR, str(i)), ignore_errors=True)

print()
print('RENDER FAILURES:', len(FAILS))
for f in FAILS:
    print('  -', f)
sys.exit(1 if FAILS else 0)
