/**
 * HOSTX / VELHOST — FILE MANAGER CLIENT
 * No inline handlers: every path travels through data-attributes so filenames
 * containing quotes, newlines or HTML can never break/inject the page.
 */
(function () {
  'use strict';

  var root = document.getElementById('vh-root');
  if (!root) return;

  var SERVER_ID = parseInt(root.dataset.serverId, 10) || 0;
  var CURRENT_PATH = root.dataset.currentPath || '';
  var API = '/api/servers/' + SERVER_ID + '/files';

  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------------ *
   * Toast (self-contained so it works on the dark shell)
   * ------------------------------------------------------------------ */
  function toast(message, type) {
    var box = $('toast-container');
    if (!box) { if (typeof showToast === 'function') return showToast(message, type); return; }
    var el = document.createElement('div');
    el.className = 'toast-message toast-' + (type || 'success');
    var icon = document.createElement('span');
    icon.textContent = type === 'danger' ? '✕' : (type === 'warning' ? '⚠' : '✓');
    var text = document.createElement('span');
    text.textContent = String(message == null ? '' : message);
    el.appendChild(icon);
    el.appendChild(text);
    box.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-10px)';
      el.style.transition = 'all .25s ease';
      setTimeout(function () { el.remove(); }, 260);
    }, 3800);
  }
  window.vhToast = toast;

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  function joinPath(rel) {
    return CURRENT_PATH ? CURRENT_PATH + '/' + rel : rel;
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    if (i > units.length - 1) i = units.length - 1;
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function api(path, options) {
    var opts = options || {};
    var headers = opts.headers || {};
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.json);
    }
    return fetch(opts.url || (API + path), {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok && !data.message) {
          data.success = false;
          data.message = 'Request failed (HTTP ' + res.status + ')';
        }
        data.success = data.success !== false;
        return data;
      });
    }).catch(function (err) {
      return { success: false, message: 'Network error: ' + err.message };
    });
  }

  function reload(delay) {
    setTimeout(function () { window.location.reload(); }, delay == null ? 550 : delay);
  }

  function selectedPaths() {
    var out = [];
    document.querySelectorAll('#fm-tbody tr').forEach(function (tr) {
      var box = tr.querySelector('.fm-check');
      if (box && box.checked) out.push(tr.dataset.path);
    });
    return out;
  }

  function updateSelectionBar() {
    var paths = selectedPaths();
    var bar = $('fm-selbar');
    if (!bar) return;
    bar.classList.toggle('on', paths.length > 0);
    var label = $('fm-sel-count');
    if (label) label.textContent = paths.length + ' selected';
    var all = $('fm-check-all');
    var boxes = document.querySelectorAll('#fm-tbody .fm-check');
    if (all && boxes.length) {
      all.checked = paths.length === boxes.length;
      all.indeterminate = paths.length > 0 && paths.length < boxes.length;
    }
  }

  /* ------------------------------------------------------------------ *
   * Prompt modal (replaces window.prompt)
   * ------------------------------------------------------------------ */
  var promptResolve = null;

  function askPrompt(opts) {
    return new Promise(function (resolve) {
      var modal = $('prompt-modal');
      var input = $('prompt-input');
      $('prompt-title').textContent = opts.title || 'Confirm';
      $('prompt-hint').textContent = opts.hint || '';
      $('prompt-label').textContent = opts.label || 'Value';
      $('prompt-field-wrap').style.display = opts.value === undefined ? 'none' : 'flex';
      input.value = opts.value == null ? '' : String(opts.value);
      $('prompt-ok').textContent = opts.okText || 'Confirm';
      $('prompt-ok').className = 'vh-btn ' + (opts.danger ? 'vh-btn-danger' : 'vh-btn-primary');
      input.placeholder = opts.placeholder || '';
      promptResolve = resolve;
      modal.classList.add('open');
      setTimeout(function () { if (opts.value !== undefined) { input.focus(); input.select(); } else { $('prompt-ok').focus(); } }, 40);
    });
  }

  function closePrompt(result) {
    var modal = $('prompt-modal');
    if (modal) modal.classList.remove('open');
    var r = promptResolve;
    promptResolve = null;
    if (r) r(result);
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-close-prompt]')) { e.preventDefault(); closePrompt(null); }
  });

  $('prompt-ok').addEventListener('click', function () {
    var wrap = $('prompt-field-wrap');
    var hasValue = wrap.style.display !== 'none';
    closePrompt(hasValue ? $('prompt-input').value : true);
  });

  $('prompt-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); closePrompt($('prompt-input').value); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (editorOpen && editorDirty) { if (confirm('Discard unsaved changes?')) closeEditor(true); }
      else if (editorOpen) { closeEditor(true); }
      else closePrompt(null);
      closeAllMenus();
    }
  });

  /* ------------------------------------------------------------------ *
   * Sidebar (mobile)
   * ------------------------------------------------------------------ */
  var sidebar = $('vh-sidebar');
  var scrim = $('vh-scrim');
  var menuToggle = $('vh-menu-toggle');
  if (menuToggle) {
    menuToggle.addEventListener('click', function () {
      sidebar.classList.toggle('open');
      scrim.classList.toggle('on');
    });
  }
  if (scrim) {
    scrim.addEventListener('click', function () {
      sidebar.classList.remove('open');
      scrim.classList.remove('on');
    });
  }

  /* ------------------------------------------------------------------ *
   * Row dropdown menus
   * ------------------------------------------------------------------ */
  function closeAllMenus() {
    document.querySelectorAll('[data-menu].open').forEach(function (m) { m.classList.remove('open'); });
  }

  document.addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-menu-toggle]');
    if (toggle) {
      e.preventDefault();
      e.stopPropagation();
      var menu = toggle.parentElement.querySelector('[data-menu]');
      var wasOpen = menu.classList.contains('open');
      closeAllMenus();
      if (!wasOpen) menu.classList.add('open');
      return;
    }
    if (!e.target.closest('[data-menu]')) closeAllMenus();
  });

  /* ------------------------------------------------------------------ *
   * Toolbar actions
   * ------------------------------------------------------------------ */
  $('fm-new-folder').addEventListener('click', async function () {
    var name = await askPrompt({
      title: 'New folder',
      hint: 'The folder will be created inside "' + (CURRENT_PATH || 'root') + '".',
      label: 'Folder name',
      placeholder: 'my-bot',
      value: '',
      okText: 'Create'
    });
    if (!name) return;
    var fd = new FormData();
    fd.append('path', CURRENT_PATH);
    fd.append('folder_name', name.trim());
    var data = await api('/create-folder', { method: 'POST', body: fd });
    toast(data.message, data.success ? 'success' : 'danger');
    if (data.success) reload();
  });

  $('fm-new-file').addEventListener('click', async function () {
    var name = await askPrompt({
      title: 'New file',
      hint: 'A new empty file will be created inside "' + (CURRENT_PATH || 'root') + '".',
      label: 'File name',
      placeholder: 'main.py',
      value: '',
      okText: 'Create'
    });
    if (!name) return;
    var fd = new FormData();
    fd.append('path', CURRENT_PATH);
    fd.append('file_name', name.trim());
    var data = await api('/create-file', { method: 'POST', body: fd });
    toast(data.message, data.success ? 'success' : 'danger');
    if (data.success) reload();
  });

  $('fm-refresh').addEventListener('click', function () { reload(0); });

  var checkAll = $('fm-check-all');
  if (checkAll) {
    checkAll.addEventListener('change', function () {
      document.querySelectorAll('#fm-tbody .fm-check').forEach(function (b) { b.checked = checkAll.checked; });
      updateSelectionBar();
    });
  }

  document.addEventListener('change', function (e) {
    if (e.target.classList && e.target.classList.contains('fm-check')) updateSelectionBar();
  });

  /* ------------------------------------------------------------------ *
   * Selection bar actions
   * ------------------------------------------------------------------ */
  var selActions = {
    clear: function () {
      document.querySelectorAll('#fm-tbody .fm-check').forEach(function (b) { b.checked = false; });
      updateSelectionBar();
    },
    download: function (paths) {
      if (paths.length === 1 && document.querySelector('#fm-tbody tr[data-path="' + cssEscape(paths[0]) + '"]').dataset.dir === '0') {
        window.location.href = '/servers/' + SERVER_ID + '/files/download?path=' + encodeURIComponent(paths[0]);
        return;
      }
      compressOrDownload(paths);
    },
    copy: function (paths) { transfer(paths, 'copy'); },
    move: function (paths) { transfer(paths, 'move'); },
    compress: function (paths) { compressOrDownload(paths); },
    delete: function (paths) { removePaths(paths); }
  };

  document.querySelectorAll('[data-sel]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var action = selActions[btn.dataset.sel];
      if (!action) return;
      var paths = selectedPaths();
      if (btn.dataset.sel !== 'clear' && !paths.length) {
        toast('Select at least one item first.', 'warning');
        return;
      }
      action(paths);
    });
  });

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function transfer(paths, mode) {
    askPrompt({
      title: mode === 'copy' ? 'Copy to folder' : 'Move to folder',
      hint: 'Enter the destination folder path relative to the server root. Leave empty for the server root.',
      label: 'Destination path',
      placeholder: 'backups/2026',
      value: CURRENT_PATH,
      okText: mode === 'copy' ? 'Copy' : 'Move'
    }).then(function (dest) {
      if (dest === null) return;
      var jobs = paths.map(function (p) {
        return api('/' + mode, { method: 'POST', json: { path: p, dest: String(dest).trim() } });
      });
      Promise.all(jobs).then(function (results) {
        var ok = 0, firstError = '';
        results.forEach(function (r) {
          if (r.success) ok++; else if (!firstError) firstError = r.message;
        });
        if (ok) {
          toast((mode === 'copy' ? 'Copied ' : 'Moved ') + ok + ' item' + (ok === 1 ? '' : 's') + '.', 'success');
          if (ok < results.length && firstError) toast(firstError, 'warning');
          reload();
        } else {
          toast(firstError || 'Operation failed.', 'danger');
        }
      });
    });
  }

  function compressOrDownload(paths) {
    askPrompt({
      title: 'Compress selection',
      hint: 'A .zip archive will be created in the current folder. It is NOT extracted automatically — use “Extract Here” to unpack it.',
      label: 'Archive name',
      placeholder: 'backup.zip',
      value: '',
      okText: 'Compress'
    }).then(function (name) {
      if (name === null) return;
      api('/compress', { method: 'POST', json: { paths: paths, name: String(name).trim() } }).then(function (data) {
        toast(data.message, data.success ? 'success' : 'danger');
        if (data.success) reload();
      });
    });
  }

  function removePaths(paths) {
    if (!paths.length) return;
    askPrompt({
      title: 'Delete ' + paths.length + ' item' + (paths.length === 1 ? '' : 's'),
      hint: 'This permanently deletes: ' + paths.slice(0, 6).join(', ') + (paths.length > 6 ? '…' : ''),
      okText: 'Delete permanently',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      Promise.all(paths.map(function (p) {
        return api('/delete', { method: 'POST', json: { path: p } });
      })).then(function (results) {
        var failed = results.filter(function (r) { return !r.success; });
        if (failed.length) toast(failed[0].message, 'danger');
        else toast('Deleted ' + paths.length + ' item' + (paths.length === 1 ? '' : 's') + '.', 'success');
        reload();
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Per-row actions (delegated)
   * ------------------------------------------------------------------ */
  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-act]');
    if (!trigger) return;
    var row = trigger.closest('#fm-tbody tr');
    if (!row) return;
    e.preventDefault();
    var path = row.dataset.path;
    var isDir = row.dataset.dir === '1';
    var isZip = row.dataset.zip === '1';
    var action = trigger.dataset.act;
    closeAllMenus();

    switch (action) {
      case 'edit': return openEditor(path);
      case 'view': return previewFile(path);
      case 'rename': return renameItem(path);
      case 'unzip': return unzip(path, '');
      case 'unzip-into': return unzipIntoNewFolder(path);
      case 'copy': return transfer([path], 'copy');
      case 'move': return transfer([path], 'move');
      case 'compress': return compressOrDownload([path]);
      case 'delete': return removePaths([path]);
    }
  });

  function renameItem(path) {
    var base = path.split('/').pop();
    askPrompt({
      title: 'Rename',
      hint: 'Renaming "' + base + '" in the same folder.',
      label: 'New name',
      value: base,
      okText: 'Rename'
    }).then(function (name) {
      if (name === null) return;
      name = String(name).trim();
      if (!name || name === base) return;
      api('/rename', { method: 'POST', json: { old_path: path, new_name: name } }).then(function (data) {
        toast(data.message, data.success ? 'success' : 'danger');
        if (data.success) reload();
      });
    });
  }

  function unzipIntoNewFolder(path) {
    var base = path.split('/').pop().replace(/\.(zip|tar\.gz|tgz)$/i, '');
    askPrompt({
      title: 'Extract into folder',
      hint: 'Creates a new folder next to the archive and extracts its contents there.',
      label: 'Folder name',
      value: base,
      okText: 'Extract'
    }).then(function (name) {
      if (name === null) return;
      unzip(path, String(name).trim());
    });
  }

  function unzip(path, dest) {
    var opts = { method: 'POST', json: { path: path, dest: dest || '', keep_archive: false } };
    if (dest) opts.json.create_if_missing = true;
    toast('Extracting archive…', 'info');
    api('/unzip', opts).then(function (data) {
      toast(data.message || (data.success ? 'Archive extracted.' : 'Extraction failed.'), data.success ? 'success' : 'danger');
      if (data.success) reload();
    });
  }

  /* ------------------------------------------------------------------ *
   * Editor
   * ------------------------------------------------------------------ */
  var editorOpen = false;
  var editorDirty = false;
  var editorPath = '';
  var editorOriginal = '';

  function setEditorStatus(text) { var el = $('editor-status'); if (el) el.textContent = text; }

  function openEditor(path) {
    var modal = $('editor-modal');
    var textarea = $('editor-content');
    $('editor-title').textContent = path.split('/').pop();
    $('editor-meta').textContent = path;
    textarea.value = 'Loading…';
    editorPath = path;
    modal.classList.add('open');
    editorOpen = true;
    editorDirty = false;
    setEditorStatus('Loading file…');

    api('/read?path=' + encodeURIComponent(path)).then(function (data) {
      if (!data.success) {
        textarea.value = '';
        setEditorStatus(data.message || 'Could not open file.');
        toast(data.message || 'Could not open file.', 'danger');
        return;
      }
      textarea.value = data.content == null ? '' : data.content;
      editorOriginal = textarea.value;
      editorDirty = false;
      setEditorStatus('No unsaved changes · ' + formatBytes(data.size));
      setTimeout(function () { textarea.focus(); }, 60);
    });
  }

  function closeEditor(force) {
    if (editorDirty && !force) {
      if (!confirm('You have unsaved changes. Discard them?')) return;
    }
    $('editor-modal').classList.remove('open');
    editorOpen = false;
    editorDirty = false;
  }

  function saveEditor() {
    var content = $('editor-content').value;
    $('editor-save').disabled = true;
    api('/save', { method: 'POST', json: { path: editorPath, content: content } }).then(function (data) {
      $('editor-save').disabled = false;
      toast(data.message, data.success ? 'success' : 'danger');
      if (data.success) {
        editorOriginal = content;
        editorDirty = false;
        setEditorStatus('Saved just now · ' + formatBytes(new Blob([content]).size));
      }
    });
  }

  $('editor-content').addEventListener('input', function () {
    var dirty = this.value !== editorOriginal;
    if (dirty !== editorDirty) {
      editorDirty = dirty;
      setEditorStatus(dirty ? 'Unsaved changes' : 'No unsaved changes');
    }
  });

  $('editor-save').addEventListener('click', saveEditor);
  $('editor-cancel').addEventListener('click', function () { closeEditor(false); });
  $('editor-close').addEventListener('click', function () { closeEditor(false); });
  $('editor-reload').addEventListener('click', function () {
    if (editorDirty && !confirm('Discard unsaved changes and reload from disk?')) return;
    openEditor(editorPath);
  });

  document.addEventListener('keydown', function (e) {
    if (editorOpen && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveEditor();
    }
  });

  function previewFile(path) {
    window.open('/servers/' + SERVER_ID + '/files/download?path=' + encodeURIComponent(path), '_blank', 'noopener');
  }

  /* ------------------------------------------------------------------ *
   * Uploads (files / folder / zip) with progress
   * ------------------------------------------------------------------ */
  function uploadFiles(files, opts) {
    opts = opts || {};
    if (!files || !files.length) return;
    var fd = new FormData();
    fd.append('path', CURRENT_PATH);
    fd.append('auto_extract', opts.keepZip ? '0' : '1');
    if (opts.keepZip) fd.append('keep_zip', '1');
    for (var i = 0; i < files.length; i++) fd.append('files', files[i]);

    var modal = $('upload-modal');
    var bar = $('upload-bar');
    var pct = $('upload-pct');
    var size = $('upload-size');
    var status = $('upload-status');
    $('upload-modal-title').textContent = opts.title || 'Uploading…';
    modal.classList.add('open');

    function setProgress(p, loaded, total, msg) {
      bar.style.width = Math.min(p, 100) + '%';
      pct.textContent = Math.min(p, 100) + '%';
      size.textContent = formatBytes(loaded) + ' / ' + formatBytes(total);
      if (msg) status.textContent = msg;
    }

    var xhr = new XMLHttpRequest();
    xhr.open('POST', API + '/upload', true);
    xhr.upload.onprogress = function (e) {
      if (!e.lengthComputable) return;
      var percent = Math.round((e.loaded / e.total) * 100);
      setProgress(percent, e.loaded, e.total,
        percent >= 100 ? 'Processing on server (extracting / scanning)…' : 'Uploading ' + files.length + ' item(s)…');
    };
    xhr.onload = function () {
      var data = {};
      try { data = JSON.parse(xhr.responseText); } catch (err) { data = {}; }
      if (xhr.status >= 200 && xhr.status < 300 && data.success) {
        setProgress(100, 1, 1, 'Done');
        toast(data.message || 'Upload complete.', 'success');
        setTimeout(function () { modal.classList.remove('open'); reload(300); }, 500);
      } else {
        modal.classList.remove('open');
        toast(data.message || 'Upload failed (HTTP ' + xhr.status + ').', 'danger');
      }
    };
    xhr.onerror = function () {
      modal.classList.remove('open');
      toast('Network error during upload.', 'danger');
    };
    xhr.send(fd);
  }

  function bindInput(id, handler) {
    var el = $(id);
    if (!el) return;
    el.addEventListener('change', function () {
      handler(el.files);
      el.value = '';
    });
  }

  bindInput('fm-upload-input', function (files) {
    var list = Array.prototype.slice.call(files || []);
    uploadFiles(list, { title: 'Uploading ' + list.length + ' file(s)…' });
  });

  bindInput('fm-folder-input', function (files) {
    var list = Array.prototype.slice.call(files || []);
    uploadFiles(list, { title: 'Uploading folder (' + list.length + ' files)…' });
  });

  bindInput('fm-zip-input', function (files) {
    var list = Array.prototype.slice.call(files || []);
    uploadFiles(list, { title: 'Uploading & extracting ZIP…' });
  });

  /* ------------------------------------------------------------------ *
   * Search
   * ------------------------------------------------------------------ */
  var searchInput = $('fm-search');
  var searchBox = $('fm-search-results');
  var searchBody = $('fm-search-body');
  var searchTimer = null;

  function iconFor(name, isDir) {
    if (isDir) return { cls: 'dir', glyph: '📁' };
    var lower = name.toLowerCase();
    if (/\.(zip|tar|gz|tgz|rar|7z)$/.test(lower)) return { cls: 'zip', glyph: '🗜️' };
    if (lower.endsWith('.py')) return { cls: 'py', glyph: '🐍' };
    if (/\.(png|jpe?g|gif|svg|webp)$/.test(lower)) return { cls: 'img', glyph: '🖼️' };
    if (/\.(json|ya?ml|ini|cfg|toml)$/.test(lower)) return { cls: 'cfg', glyph: '⚙️' };
    return { cls: 'txt', glyph: '📄' };
  }

  function renderSearch(results) {
    searchBody.textContent = '';
    if (!results.length) {
      var empty = document.createElement('tr');
      var cell = document.createElement('td');
      cell.colSpan = 4;
      cell.className = 'vh-muted';
      cell.style.padding = '18px';
      cell.textContent = 'No matching files found.';
      empty.appendChild(cell);
      searchBody.appendChild(empty);
      return;
    }
    results.forEach(function (r) {
      var tr = document.createElement('tr');
      var ic = iconFor(r.name, r.is_dir);

      var nameCell = document.createElement('td');
      var wrap = document.createElement('div');
      wrap.className = 'vh-file-name';
      var ico = document.createElement('span');
      ico.className = 'vh-file-ico ' + ic.cls;
      ico.textContent = ic.glyph;
      var link = document.createElement(r.is_dir ? 'a' : 'span');
      link.className = 'vh-file-link';
      link.textContent = r.name;
      if (r.is_dir) {
        link.href = '/servers/' + SERVER_ID + '/files?path=' + encodeURIComponent(r.path);
      } else {
        link.style.cursor = 'pointer';
        link.addEventListener('click', function () { openEditor(r.path); });
      }
      wrap.appendChild(ico);
      wrap.appendChild(link);
      nameCell.appendChild(wrap);

      var pathCell = document.createElement('td');
      pathCell.className = 'vh-muted vh-mono';
      pathCell.style.fontSize = '0.75rem';
      pathCell.textContent = r.path;

      var sizeCell = document.createElement('td');
      sizeCell.className = 'col-size';
      sizeCell.textContent = r.size;

      var timeCell = document.createElement('td');
      timeCell.className = 'col-time';
      timeCell.textContent = r.modified;

      tr.appendChild(nameCell);
      tr.appendChild(pathCell);
      tr.appendChild(sizeCell);
      tr.appendChild(timeCell);
      searchBody.appendChild(tr);
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      clearTimeout(searchTimer);
      var q = searchInput.value.trim();
      if (q.length < 2) {
        searchBox.style.display = 'none';
        return;
      }
      searchTimer = setTimeout(function () {
        fetch(API + '/search?q=' + encodeURIComponent(q) + '&scope=' + encodeURIComponent(CURRENT_PATH))
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data.success) { toast(data.message || 'Search failed.', 'danger'); return; }
            renderSearch(data.results || []);
            searchBox.style.display = 'block';
            if (data.truncated) toast('Results truncated — refine your search.', 'warning');
          })
          .catch(function () { toast('Search request failed.', 'danger'); });
      }, 320);
    });
  }

  updateSelectionBar();
})();
