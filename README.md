# HostX VIP Platform — Production & Development Deployment Guide

## 1. Requirements & Prerequisites
- Python 3.9+ (Python 3.10, 3.11, or 3.12 recommended)
- `pip` package manager

## 2. Installation
Install all dependencies using requirements.txt:
```bash
pip install -r requirements.txt
```

## 3. Run Locally (Development)
```bash
python app.py
```
The application will start on: `http://localhost:3000`

## 4. Run with Production WSGI (Linux/Render/VPS)
```bash
gunicorn --workers 2 --threads 4 --bind 0.0.0.0:3000 app:app
```

## 5. Default Super Administrator Credentials
- **Username / Email:** `adminrifat@gmail.com` (or username: `admin`)
- **Password:** `123456789`
- **Role:** Super Admin (Root Access)

## 6. Project Architecture
- `app.py`: Core Flask application with server management, coin economy, and terminal streaming.
- `database/`: Persistent SQLite storage (`hostx.db`).
- `templates/`: Jinja2 templates (dashboard, servers, file manager, packages, admin panel).
- `static/css/`: Ultra-modern responsive styling system (`style.css`).
- `static/js/`: High-performance terminal streaming and UI interaction (`main.js`).
- `static/img/`: Official SVG branding logo.
- `servers/`: Isolated customer server files and runtime scripts.
- `uploads/`: Avatars and branding assets.
