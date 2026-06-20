'use strict';

/* ════════════════════════════════════════════════════════
   WMC BLOCK EDITOR
   Full-screen overlay block editor with:
   • 10 block types (heading, paragraph, image, gallery,
     button, testimonial, faq, serviceCard, cta, html)
   • HTML5 drag-and-drop reorder + ↑/↓ move buttons
   • Real-time live preview (right panel)
   • 2-second debounced auto-save to localStorage + API
   • Block picker modal (insert at any position)
   • Image picker (opens WMC Media Library)

   Opens by appending #wmcEditorOverlay to <body>.
   Stores changes back through WMCPageManager.updatePage().
   ════════════════════════════════════════════════════════ */

window.WMCBlockEditor = (function () {

  /* ── State ── */
  var _pageId       = null;
  var _blocks       = [];
  var _selectedIdx  = -1;
  var _dragFromIdx  = null;
  var _autoTimer    = null;
  var _previewMode  = false;
  var _dirty        = false;
  var _insertAfter  = -1;   /* position for block picker */

  /* ════════════════════════════════════════════════════════
     BLOCK DEFINITIONS
     ════════════════════════════════════════════════════════ */
  var BLOCK_TYPES = {
    heading:     { label:'見出し',         icon:'H₁', desc:'H1〜H4の見出し' },
    paragraph:   { label:'段落',           icon:'¶',  desc:'通常テキスト段落' },
    image:       { label:'画像',           icon:'🖼', desc:'単一画像ブロック' },
    gallery:     { label:'ギャラリー',     icon:'▦',  desc:'複数画像グリッド' },
    button:      { label:'ボタン',         icon:'⬛', desc:'CTAボタン' },
    testimonial: { label:'お客様の声',     icon:'💬', desc:'レビューカード' },
    faq:         { label:'FAQ',            icon:'❓', desc:'Q&Aアコーディオン' },
    serviceCard: { label:'サービスカード', icon:'📦', desc:'サービス紹介カード' },
    cta:         { label:'CTAセクション',  icon:'📢', desc:'行動喚起バナー' },
    html:        { label:'HTMLブロック',   icon:'</>',desc:'カスタムHTMLコード' },
  };

  var BLOCK_TYPE_ORDER = ['heading','paragraph','image','gallery','button','testimonial','faq','serviceCard','cta','html'];

  /* ── Default data for each block type ── */
  function _defaultData(type) {
    var m = {
      heading:     { level:2, text:'見出しテキスト', align:'left' },
      paragraph:   { text:'ここにテキストを入力してください。',  align:'left' },
      image:       { src:'', alt:'', caption:'', width:'full' },
      gallery:     { images:[], columns:3 },
      button:      { text:'お問い合わせ', href:'#contact', variant:'primary', align:'center' },
      testimonial: { name:'田中 太郎', company:'東京都', text:'とても丁寧なサービスでした。', rating:5, avatar:'' },
      faq:         { question:'質問を入力してください', answer:'回答を入力してください。' },
      serviceCard: { icon:'🚛', title:'サービス名', description:'サービスの説明を入力してください。', price:'¥25,000〜', badge:'人気', cta:'詳しく見る' },
      cta:         { headline:'今すぐ無料お見積り', subtext:'東京・神奈川エリア対応。スタッフが丁寧にサポートします。', primaryBtn:{text:'無料見積もり',href:'#quote'}, secondaryBtn:{text:'電話で相談',href:'tel:000'}, bg:'navy' },
      html:        { code:'<!-- カスタムHTMLをここに入力 -->' },
    };
    return JSON.parse(JSON.stringify(m[type] || {}));
  }

  /* ── Block ID generator ── */
  function _bid() { return 'blk-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,6); }

  /* ════════════════════════════════════════════════════════
     OPEN / CLOSE
     ════════════════════════════════════════════════════════ */
  function open(pageId) {
    var page = window.WMCPageManager ? WMCPageManager.getPage(pageId) : null;
    if (!page) { if (typeof toast === 'function') toast('ページが見つかりません'); return; }

    _pageId      = pageId;
    _blocks      = JSON.parse(JSON.stringify(page.blocks || []));
    _selectedIdx = -1;
    _dirty       = false;
    _previewMode = false;

    _buildOverlay(page);
    _renderBlocks();
    _renderSettings();
    _updatePreview();
    _setSaveStatus('saved');
  }

  function close() {
    if (_dirty) {
      var ok = confirm('変更が保存されていません。閉じますか？');
      if (!ok) return;
    }
    var ov = document.getElementById('wmcEditorOverlay');
    if (ov) ov.remove();
    _pageId = null;
    _blocks = [];
    clearTimeout(_autoTimer);
    /* Return to pages view */
    if (typeof wmcGo === 'function') wmcGo('pages');
  }

  /* ── Build the overlay DOM ── */
  function _buildOverlay(page) {
    var existing = document.getElementById('wmcEditorOverlay');
    if (existing) existing.remove();

    var ov = document.createElement('div');
    ov.id = 'wmcEditorOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:300;background:var(--bg);display:flex;flex-direction:column;overflow:hidden';

    ov.innerHTML =
      /* ─ Top bar ─ */
      '<div id="wceTopbar" style="height:52px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;padding:0 16px;background:var(--bg);flex-shrink:0;z-index:10">' +
        '<button onclick="WMCBlockEditor.close()" style="display:flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--line);border-radius:7px;background:none;cursor:pointer;font-size:12px;font-weight:600;color:var(--gray-1);font-family:inherit;transition:.15s" ' +
          'onmouseover="this.style.color=\'var(--ink)\'" onmouseout="this.style.color=\'var(--gray-1)\'">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="15 18 9 12 15 6"/></svg>戻る</button>' +

        '<div style="flex:1;min-width:0">' +
          '<input id="wcePageTitle" value="' + _esc(page.title) + '" ' +
            'style="font-size:15px;font-weight:700;color:var(--ink);border:none;outline:none;background:transparent;width:100%;font-family:inherit" ' +
            'onchange="WMCBlockEditor._onTitleChange(this.value)" />' +
        '</div>' +

        '<span id="wceSaveStatus" style="font-size:11px;color:var(--gray-2)">保存済み</span>' +

        '<button onclick="WMCBlockEditor.togglePreview()" id="wcePreviewBtn" ' +
          'style="padding:6px 12px;border:1px solid var(--line);border-radius:7px;background:none;cursor:pointer;font-size:12px;font-weight:600;color:var(--ink);font-family:inherit;transition:.15s">プレビュー</button>' +

        '<button onclick="WMCBlockEditor.save()" ' +
          'style="padding:6px 12px;border:1px solid var(--line);border-radius:7px;background:none;cursor:pointer;font-size:12px;font-weight:600;color:var(--ink);font-family:inherit;transition:.15s">保存</button>' +

        '<button onclick="WMCBlockEditor.publish()" ' +
          'style="padding:6px 14px;border:none;border-radius:7px;background:var(--blue);cursor:pointer;font-size:12px;font-weight:600;color:#fff;font-family:inherit;transition:.15s">' +
          (page.status === 'published' ? '更新して公開' : '公開する') +
        '</button>' +
      '</div>' +

      /* ─ Body ─ */
      '<div style="display:flex;flex:1;overflow:hidden">' +

        /* Left: canvas */
        '<div id="wceCanvas" style="flex:1;overflow-y:auto;padding:20px;background:var(--bg-soft-2)">' +
          '<div id="wceBlockList" style="max-width:680px;margin:0 auto"></div>' +
        '</div>' +

        /* Right: settings / preview */
        '<div id="wceRight" style="width:320px;border-left:1px solid var(--line);overflow-y:auto;background:var(--bg);flex-shrink:0;display:flex;flex-direction:column">' +
          '<div id="wceRightContent" style="flex:1;overflow-y:auto;padding:16px"></div>' +
        '</div>' +

      '</div>';

    document.body.appendChild(ov);
  }

  /* ════════════════════════════════════════════════════════
     BLOCK CANVAS RENDERING
     ════════════════════════════════════════════════════════ */
  function _renderBlocks() {
    var list = document.getElementById('wceBlockList');
    if (!list) return;

    var html = _insertZoneHtml(-1);

    _blocks.forEach(function(blk, idx) {
      html += _blockHtml(blk, idx);
      html += _insertZoneHtml(idx);
    });

    if (_blocks.length === 0) {
      html = '<div style="text-align:center;padding:48px 24px;color:var(--gray-2)">' +
        '<div style="font-size:36px;margin-bottom:12px;opacity:.4">📝</div>' +
        '<div style="font-size:14px;font-weight:600;color:var(--ink);margin-bottom:6px">コンテンツがありません</div>' +
        '<div style="font-size:12px">下の「+」ボタンからブロックを追加してください</div>' +
      '</div>';
      html += _insertZoneHtml(-1);
    }

    list.innerHTML = html;
    _bindBlockEvents();
  }

  function _insertZoneHtml(afterIdx) {
    return '<div class="wce-insert-zone" data-after="' + afterIdx + '" style="display:flex;align-items:center;justify-content:center;padding:4px 0;opacity:.6;transition:opacity .15s" ' +
      'onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=.6">' +
      '<button onclick="WMCBlockEditor.openBlockPicker(' + afterIdx + ')" ' +
        'style="display:flex;align-items:center;gap:5px;padding:5px 14px;border:1px dashed var(--line);border-radius:20px;background:var(--bg);cursor:pointer;font-size:12px;color:var(--gray-1);font-family:inherit;transition:.15s" ' +
        'onmouseover="this.style.borderColor=\'var(--blue)\';this.style.color=\'var(--blue)\'" ' +
        'onmouseout="this.style.borderColor=\'var(--line)\';this.style.color=\'var(--gray-1)\'">' +
        '+ ブロックを追加' +
      '</button>' +
    '</div>';
  }

  function _blockHtml(blk, idx) {
    var selected = idx === _selectedIdx;
    var borderColor = selected ? 'var(--blue)' : 'var(--line)';
    var shadow     = selected ? '0 0 0 2px rgba(37,99,235,.2)' : 'none';
    var type       = BLOCK_TYPES[blk.type] || { label: blk.type, icon:'?' };

    return (
      '<div class="wce-block" data-idx="' + idx + '" draggable="true" ' +
        'style="position:relative;border:1.5px solid ' + borderColor + ';border-radius:10px;background:var(--bg);margin-bottom:4px;' +
        'box-shadow:' + shadow + ';transition:border-color .15s,box-shadow .15s;overflow:hidden;cursor:pointer" ' +
        'onclick="WMCBlockEditor.selectBlock(' + idx + ')">' +

        /* Handle + type label */
        '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line-2);background:var(--bg-soft)">' +
          '<div class="wce-drag-handle" data-idx="' + idx + '" ' +
            'style="cursor:grab;color:var(--gray-2);font-size:14px;line-height:1;padding:2px 4px;border-radius:4px;user-select:none" ' +
            'title="ドラッグして移動" draggable="true">⠿</div>' +
          '<span style="font-size:11px;font-weight:700;color:var(--gray-1);letter-spacing:.04em;text-transform:uppercase">' +
            _esc(type.icon) + ' ' + _esc(type.label) +
          '</span>' +
          '<div style="margin-left:auto;display:flex;gap:2px">' +
            '<button onclick="event.stopPropagation();WMCBlockEditor.moveBlock(' + idx + ',' + (idx-1) + ')" ' +
              'style="' + _tbtnStyle() + '" title="上へ" ' + (idx === 0 ? 'disabled' : '') + '>↑</button>' +
            '<button onclick="event.stopPropagation();WMCBlockEditor.moveBlock(' + idx + ',' + (idx+1) + ')" ' +
              'style="' + _tbtnStyle() + '" title="下へ" ' + (idx === _blocks.length-1 ? 'disabled' : '') + '>↓</button>' +
            '<button onclick="event.stopPropagation();WMCBlockEditor.duplicateBlock(' + idx + ')" ' +
              'style="' + _tbtnStyle() + '" title="複製">⊕</button>' +
            '<button onclick="event.stopPropagation();WMCBlockEditor.deleteBlock(' + idx + ')" ' +
              'style="' + _tbtnStyle() + 'color:var(--red)" title="削除">✕</button>' +
          '</div>' +
        '</div>' +

        /* Block preview snippet */
        '<div style="padding:10px 14px;font-size:13px;color:var(--ink);min-height:36px;max-height:80px;overflow:hidden">' +
          _blockSnippet(blk) +
        '</div>' +
      '</div>'
    );
  }

  function _tbtnStyle() {
    return 'background:none;border:none;cursor:pointer;padding:3px 6px;border-radius:4px;font-size:13px;color:var(--gray-1);font-family:inherit;line-height:1;transition:.1s;';
  }

  /* Short textual preview of a block for the canvas */
  function _blockSnippet(blk) {
    var d = blk.data || {};
    switch (blk.type) {
      case 'heading':     return '<strong style="font-size:' + (20 - (d.level||2)*2) + 'px">' + _esc(d.text || '(空)') + '</strong>';
      case 'paragraph':   return '<span style="color:var(--gray-1)">' + _esc((d.text||'').slice(0,120)) + '</span>';
      case 'image':       return d.src
        ? '<img src="' + _esc(d.src) + '" style="height:60px;max-width:160px;object-fit:cover;border-radius:6px" />'
        : '<span style="color:var(--gray-2)">🖼 画像未設定</span>';
      case 'gallery':     return '<span style="color:var(--gray-1)">📷 ' + (d.images ? d.images.length : 0) + '枚の画像</span>';
      case 'button':      return '<span style="display:inline-block;padding:4px 12px;background:var(--blue);color:#fff;border-radius:6px;font-size:12px">' + _esc(d.text||'ボタン') + '</span>';
      case 'testimonial': return '<span>⭐'.repeat(Math.min(d.rating||5,5)) + ' ' + _esc((d.text||'').slice(0,80)) + '</span>';
      case 'faq':         return '<strong>' + _esc((d.question||'').slice(0,80)) + '</strong>';
      case 'serviceCard': return '<span>' + _esc(d.icon||'📦') + ' <strong>' + _esc(d.title||'サービス') + '</strong></span>';
      case 'cta':         return '<span style="font-weight:700">' + _esc((d.headline||'CTA').slice(0,60)) + '</span>';
      case 'html':        return '<code style="font-size:11px;color:var(--gray-1)">' + _esc((d.code||'').slice(0,80)) + '</code>';
      default:            return '<span style="color:var(--gray-2)">' + _esc(blk.type) + '</span>';
    }
  }

  /* ════════════════════════════════════════════════════════
     DRAG AND DROP
     ════════════════════════════════════════════════════════ */
  function _bindBlockEvents() {
    var blockEls = document.querySelectorAll('#wceBlockList .wce-block');
    blockEls.forEach(function(el) {
      var idx = parseInt(el.dataset.idx, 10);

      el.addEventListener('dragstart', function(e) {
        _dragFromIdx = idx;
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(function() { el.style.opacity = '0.4'; }, 0);
      });
      el.addEventListener('dragend', function() {
        el.style.opacity = '1';
        _dragFromIdx = null;
        document.querySelectorAll('.wce-drag-over').forEach(function(x) { x.classList.remove('wce-drag-over'); });
      });
      el.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (_dragFromIdx !== null && _dragFromIdx !== idx) {
          el.style.outline = '2px dashed var(--blue)';
        }
      });
      el.addEventListener('dragleave', function() {
        el.style.outline = '';
      });
      el.addEventListener('drop', function(e) {
        e.preventDefault();
        el.style.outline = '';
        if (_dragFromIdx !== null && _dragFromIdx !== idx) {
          moveBlock(_dragFromIdx, idx);
        }
      });
    });
  }

  /* ════════════════════════════════════════════════════════
     BLOCK OPERATIONS
     ════════════════════════════════════════════════════════ */
  function selectBlock(idx) {
    _selectedIdx = idx;
    _renderBlocks();
    _renderSettings();
    if (_previewMode) _updatePreview();
  }

  function insertBlock(type, afterIdx) {
    var blk = { id: _bid(), type: type, data: _defaultData(type) };
    var pos = (afterIdx === undefined || afterIdx < 0) ? _blocks.length : afterIdx + 1;
    _blocks.splice(pos, 0, blk);
    _selectedIdx = pos;
    _renderBlocks();
    _renderSettings();
    _updatePreview();
    _markDirty();
  }

  function deleteBlock(idx) {
    if (!confirm('このブロックを削除しますか？')) return;
    _blocks.splice(idx, 1);
    if (_selectedIdx >= _blocks.length) _selectedIdx = _blocks.length - 1;
    _renderBlocks();
    _renderSettings();
    _updatePreview();
    _markDirty();
  }

  function duplicateBlock(idx) {
    var copy = JSON.parse(JSON.stringify(_blocks[idx]));
    copy.id  = _bid();
    _blocks.splice(idx + 1, 0, copy);
    _selectedIdx = idx + 1;
    _renderBlocks();
    _renderSettings();
    _updatePreview();
    _markDirty();
  }

  function moveBlock(fromIdx, toIdx) {
    if (toIdx < 0 || toIdx >= _blocks.length) return;
    var blk = _blocks.splice(fromIdx, 1)[0];
    _blocks.splice(toIdx, 0, blk);
    _selectedIdx = toIdx;
    _renderBlocks();
    _renderSettings();
    _updatePreview();
    _markDirty();
  }

  function updateBlockData(idx, patch) {
    if (!_blocks[idx]) return;
    Object.assign(_blocks[idx].data, patch);
    _renderBlocks();
    _updatePreview();
    _markDirty();
  }

  /* ════════════════════════════════════════════════════════
     SETTINGS PANEL
     ════════════════════════════════════════════════════════ */
  function _renderSettings() {
    var el = document.getElementById('wceRightContent');
    if (!el) return;

    if (_previewMode) { _updatePreview(); return; }

    if (_selectedIdx < 0 || !_blocks[_selectedIdx]) {
      el.innerHTML =
        '<div style="text-align:center;padding:32px 16px;color:var(--gray-2)">' +
          '<div style="font-size:24px;margin-bottom:10px;opacity:.4">⚙️</div>' +
          '<div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:4px">ブロックを選択</div>' +
          '<div style="font-size:12px">ブロックをクリックすると設定が表示されます</div>' +
        '</div>';
      return;
    }

    var blk = _blocks[_selectedIdx];
    var d   = blk.data;
    var idx = _selectedIdx;

    var fields = '';
    switch (blk.type) {
      case 'heading':
        fields = _sf('見出しレベル',
          '<select onchange="WMCBlockEditor._upd(' + idx + ',{level:parseInt(this.value)})" style="' + _selStyle() + '">' +
            [1,2,3,4].map(function(l){ return '<option value="' + l + '"' + (d.level===l?' selected':'') + '>H' + l + '</option>'; }).join('') +
          '</select>') +
          _sf('テキスト', '<input value="' + _esc(d.text||'') + '" oninput="WMCBlockEditor._upd(' + idx + ',{text:this.value})" style="' + _inpStyle() + '" />') +
          _sf('配置', _alignSelect(idx, d.align));
        break;

      case 'paragraph':
        fields = _sf('テキスト', '<textarea oninput="WMCBlockEditor._upd(' + idx + ',{text:this.value})" style="' + _inpStyle() + 'resize:vertical;min-height:80px">' + _esc(d.text||'') + '</textarea>') +
          _sf('配置', _alignSelect(idx, d.align));
        break;

      case 'image':
        fields = _sf('画像', d.src
          ? '<img src="' + _esc(d.src) + '" style="width:100%;height:120px;object-fit:cover;border-radius:6px;margin-bottom:6px" />' +
            '<button onclick="WMCBlockEditor._upd(' + idx + ',{src:\'\'})" class="btn btn-ghost btn-sm" style="width:100%;margin-bottom:6px">削除</button>'
          : '') +
          '<button onclick="WMCBlockEditor.openMediaPicker(' + idx + ')" class="btn btn-primary btn-sm" style="width:100%;margin-bottom:12px">メディアから選択</button>' +
          _sf('ALTテキスト', '<input value="' + _esc(d.alt||'') + '" oninput="WMCBlockEditor._upd(' + idx + ',{alt:this.value})" style="' + _inpStyle() + '" placeholder="画像の説明" />') +
          _sf('キャプション', '<input value="' + _esc(d.caption||'') + '" oninput="WMCBlockEditor._upd(' + idx + ',{caption:this.value})" style="' + _inpStyle() + '" />');
        break;

      case 'gallery':
        var imgs = d.images || [];
        fields = _sf('列数',
          '<select onchange="WMCBlockEditor._upd(' + idx + ',{columns:parseInt(this.value)})" style="' + _selStyle() + '">' +
            [2,3,4].map(function(c){ return '<option value="' + c + '"' + (d.columns===c?' selected':'') + '>' + c + '列</option>'; }).join('') +
          '</select>') +
          '<div style="font-size:12px;font-weight:600;color:var(--gray-1);margin-bottom:6px">画像 (' + imgs.length + '枚)</div>' +
          '<button onclick="WMCBlockEditor.openMediaPicker(' + idx + ',true)" class="btn btn-primary btn-sm" style="width:100%;margin-bottom:8px">+ 画像を追加</button>' +
          (imgs.length > 0
            ? '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">' +
                imgs.map(function(img, i) {
                  return '<div style="position:relative">' +
                    '<img src="' + _esc(img.src) + '" style="width:100%;height:60px;object-fit:cover;border-radius:4px" />' +
                    '<button onclick="WMCBlockEditor._removeGalleryImg(' + idx + ',' + i + ')" ' +
                      'style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.5);border:none;border-radius:50%;width:16px;height:16px;font-size:10px;color:#fff;cursor:pointer;line-height:1;font-family:inherit">✕</button>' +
                  '</div>';
                }).join('') +
              '</div>'
            : '<div style="color:var(--gray-2);font-size:12px;text-align:center;padding:12px">画像を追加してください</div>'
          );
        break;

      case 'button':
        fields = _sf('ボタンテキスト', '<input value="' + _esc(d.text||'') + '" oninput="WMCBlockEditor._upd(' + idx + ',{text:this.value})" style="' + _inpStyle() + '" />') +
          _sf('リンク先(URL)', '<input value="' + _esc(d.href||'') + '" oninput="WMCBlockEditor._upd(' + idx + ',{href:this.value})" style="' + _inpStyle() + '" placeholder="#contact または https://..." />') +
          _sf('スタイル',
            '<select onchange="WMCBlockEditor._upd(' + idx + ',{variant:this.value})" style="' + _selStyle() + '">' +
              ['primary','secondary','outline','ghost'].map(function(v){ return '<option value="' + v + '"' + (d.variant===v?' selected':'') + '>' + v + '</option>'; }).join('') +
            '</select>') +
          _sf('配置', _alignSelect(idx, d.align));
        break;

      case 'testimonial':
        fields = _sf('お名前', '<input value="' + _esc(d.name||'') + '" oninput="WMCBlockEditor._upd(' + idx + ',{name:this.value})" style="' + _inpStyle() + '" />') +
          _sf('会社・地域', '<input value="' + _esc(d.company||'') + '" oninput="WMCBlockEditor._upd(' + idx + ',{company:this.value})" style="' + _inpStyle() + '" />') +
          _sf('レビューテキスト', '<textarea oninput="WMCBlockEditor._upd(' + idx + ',{text:this.value})" style="' + _inpStyle() + 'resize:vertical;min-height:64px">' + _esc(d.text||'') + '</textarea>') +
          _sf('評価（1〜5）',
            '<select onchange="WMCBlockEditor._upd(' + idx + ',{rating:parseInt(this.value)})" style="' + _selStyle() + '">' +
              [5,4,3,2,1].map(function(r){ return '<option value="' + r + '"' + (d.rating===r?' selected':'') + '>' + '⭐'.repeat(r) + '</option>'; }).join('') +
            '</select>');
        break;

      case 'faq':
        fields = _sf('質問', '<input value="' + _esc(d.question||'') + '" oninput="WMCBlockEditor._upd(' + idx + ',{question:this.value})" style="' + _inpStyle() + '" />') +
          _sf('回答', '<textarea oninput="WMCBlockEditor._upd(' + idx + ',{answer:this.value})" style="' + _inpStyle() + 'resize:vertical;min-height:80px">' + _esc(d.answer||'') + '</textarea>');
        break;

      case 'serviceCard':
        fields = _sf('アイコン(絵文字)', '<input value="' + _esc(d.icon||'') + '" oninput="WMCBlockEditor._upd(' + idx + ',{icon:this.value})" style="' + _inpStyle() + '" placeholder="🚛" />') +
          _sf('サービス名', '<input value="' + _esc(d.title||'') + '" oninput="WMCBlockEditor._upd(' + idx + ',{title:this.value})" style="' + _inpStyle() + '" />') +
          _sf('説明文', '<textarea oninput="WMCBlockEditor._upd(' + idx + ',{description:this.value})" style="' + _inpStyle() + 'resize:vertical;min-height:64px">' + _esc(d.description||'') + '</textarea>') +
          _sf('料金表示', '<input value="' + _esc(d.price||'') + '" oninput="WMCBlockEditor._upd(' + idx + ',{price:this.value})" style="' + _inpStyle() + '" placeholder="¥25,000〜" />') +
          _sf('バッジ', '<input value="' + _esc(d.badge||'') + '" oninput="WMCBlockEditor._upd(' + idx + ',{badge:this.value})" style="' + _inpStyle() + '" placeholder="人気" />') +
          _sf('CTAテキスト', '<input value="' + _esc(d.cta||'') + '" oninput="WMCBlockEditor._upd(' + idx + ',{cta:this.value})" style="' + _inpStyle() + '" />');
        break;

      case 'cta':
        var pb = d.primaryBtn || {text:'',href:''};
        var sb2 = d.secondaryBtn || {text:'',href:''};
        fields = _sf('見出し', '<input value="' + _esc(d.headline||'') + '" oninput="WMCBlockEditor._upd(' + idx + ',{headline:this.value})" style="' + _inpStyle() + '" />') +
          _sf('サブテキスト', '<textarea oninput="WMCBlockEditor._upd(' + idx + ',{subtext:this.value})" style="' + _inpStyle() + 'resize:vertical;min-height:56px">' + _esc(d.subtext||'') + '</textarea>') +
          _sf('プライマリボタン',
            '<input value="' + _esc(pb.text) + '" oninput="WMCBlockEditor._updCTABtn(' + idx + ',\'primary\',\'text\',this.value)" style="' + _inpStyle() + 'margin-bottom:4px" placeholder="テキスト" />' +
            '<input value="' + _esc(pb.href) + '" oninput="WMCBlockEditor._updCTABtn(' + idx + ',\'primary\',\'href\',this.value)" style="' + _inpStyle() + '" placeholder="URL" />'
          ) +
          _sf('セカンダリボタン',
            '<input value="' + _esc(sb2.text) + '" oninput="WMCBlockEditor._updCTABtn(' + idx + ',\'secondary\',\'text\',this.value)" style="' + _inpStyle() + 'margin-bottom:4px" placeholder="テキスト" />' +
            '<input value="' + _esc(sb2.href) + '" oninput="WMCBlockEditor._updCTABtn(' + idx + ',\'secondary\',\'href\',this.value)" style="' + _inpStyle() + '" placeholder="URL" />'
          ) +
          _sf('背景',
            '<select onchange="WMCBlockEditor._upd(' + idx + ',{bg:this.value})" style="' + _selStyle() + '">' +
              [{v:'navy',l:'ネイビー'},{v:'green',l:'グリーン'},{v:'white',l:'ホワイト'},{v:'gray',l:'グレー'}]
                .map(function(o){ return '<option value="' + o.v + '"' + (d.bg===o.v?' selected':'') + '>' + o.l + '</option>'; }).join('') +
            '</select>');
        break;

      case 'html':
        fields = _sf('HTMLコード',
          '<textarea oninput="WMCBlockEditor._upd(' + idx + ',{code:this.value})" ' +
            'style="' + _inpStyle() + 'resize:vertical;min-height:120px;font-family:monospace;font-size:12px">' +
            _esc(d.code||'') + '</textarea>' +
          '<div style="font-size:11px;color:var(--yellow);margin-top:4px">⚠ カスタムHTMLはそのままレンダリングされます</div>');
        break;
    }

    var typeMeta = BLOCK_TYPES[blk.type] || { label: blk.type, icon:'?' };
    el.innerHTML =
      '<div style="font-size:11px;font-weight:700;color:var(--gray-1);text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px;display:flex;align-items:center;gap:6px">' +
        '<span>' + _esc(typeMeta.icon) + '</span>' +
        '<span>' + _esc(typeMeta.label) + ' 設定</span>' +
      '</div>' +
      fields;
  }

  /* Settings field helpers */
  function _sf(label, content) {
    return '<div style="margin-bottom:12px">' +
      '<label style="display:block;font-size:11px;font-weight:600;color:var(--gray-1);margin-bottom:5px">' + label + '</label>' +
      content +
    '</div>';
  }
  function _inpStyle() { return 'width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:7px;font-size:12px;font-family:inherit;color:var(--ink);background:var(--bg);box-sizing:border-box;'; }
  function _selStyle() { return 'width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:7px;font-size:12px;font-family:inherit;color:var(--ink);background:var(--bg);cursor:pointer;'; }
  function _alignSelect(idx, cur) {
    return '<select onchange="WMCBlockEditor._upd(' + idx + ',{align:this.value})" style="' + _selStyle() + '">' +
      [{v:'left',l:'左'},{v:'center',l:'中央'},{v:'right',l:'右'}]
        .map(function(o){ return '<option value="' + o.v + '"' + (cur===o.v?' selected':'') + '>' + o.l + '</option>'; }).join('') +
    '</select>';
  }

  /* Public data-update shortcuts */
  function _upd(idx, patch) { updateBlockData(idx, patch); }
  function _updCTABtn(idx, which, field, val) {
    if (!_blocks[idx]) return;
    var key = which === 'primary' ? 'primaryBtn' : 'secondaryBtn';
    var btn = Object.assign({}, _blocks[idx].data[key] || {});
    btn[field] = val;
    var patch = {}; patch[key] = btn;
    updateBlockData(idx, patch);
  }
  function _removeGalleryImg(blockIdx, imgIdx) {
    if (!_blocks[blockIdx]) return;
    var imgs = (_blocks[blockIdx].data.images || []).slice();
    imgs.splice(imgIdx, 1);
    updateBlockData(blockIdx, { images: imgs });
    _renderSettings();
  }

  /* ════════════════════════════════════════════════════════
     LIVE PREVIEW
     ════════════════════════════════════════════════════════ */
  function togglePreview() {
    _previewMode = !_previewMode;
    var btn = document.getElementById('wcePreviewBtn');
    if (btn) btn.textContent = _previewMode ? '編集に戻る' : 'プレビュー';

    var rightEl = document.getElementById('wceRightContent');
    if (_previewMode) {
      _updatePreview();
    } else {
      _renderSettings();
    }
  }

  function _updatePreview() {
    if (!_previewMode) return;
    var el = document.getElementById('wceRightContent');
    if (!el) return;

    el.innerHTML =
      '<div style="font-size:11px;font-weight:700;color:var(--gray-1);text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px">ライブプレビュー</div>' +
      '<div style="font-size:11px;color:var(--gray-2);margin-bottom:12px">実際の表示に近いプレビューです</div>' +
      '<div style="border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff">' +
        _blocks.map(function(blk){ return _previewBlock(blk); }).join('') +
      '</div>';
  }

  function _previewBlock(blk) {
    var d = blk.data || {};
    var align = d.align || 'left';
    switch (blk.type) {
      case 'heading': {
        var sz = ['','36px','28px','22px','18px'][Math.min(d.level||2,4)];
        return '<div style="padding:12px 16px;text-align:' + align + '"><h' + (d.level||2) + ' style="margin:0;font-size:' + sz + ';font-weight:700;color:#0b0f17;font-family:inherit">' + _esc(d.text||'') + '</h' + (d.level||2) + '></div>';
      }
      case 'paragraph':
        return '<div style="padding:10px 16px;text-align:' + align + ';font-size:14px;color:#1e2532;line-height:1.7">' + _esc(d.text||'').replace(/\n/g,'<br>') + '</div>';
      case 'image':
        return d.src
          ? '<div style="padding:10px 16px">' +
              '<img src="' + _esc(d.src) + '" alt="' + _esc(d.alt||'') + '" style="width:100%;max-height:240px;object-fit:cover;border-radius:8px" />' +
              (d.caption ? '<div style="text-align:center;font-size:12px;color:#6b7280;margin-top:6px">' + _esc(d.caption) + '</div>' : '') +
            '</div>'
          : '<div style="padding:16px;text-align:center;background:#f0f2f5;color:#9ca3af;font-size:13px">🖼 画像未設定</div>';
      case 'gallery': {
        var imgs = d.images || [];
        return imgs.length
          ? '<div style="padding:10px 16px;display:grid;grid-template-columns:repeat(' + (d.columns||3) + ',1fr);gap:6px">' +
              imgs.map(function(img){ return '<img src="' + _esc(img.src) + '" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px" />'; }).join('') +
            '</div>'
          : '<div style="padding:16px;text-align:center;background:#f0f2f5;color:#9ca3af;font-size:13px">ギャラリーに画像を追加してください</div>';
      }
      case 'button': {
        var btnColor = d.variant === 'secondary' ? '#1D9E75' : d.variant === 'outline' ? 'transparent' : '#2563eb';
        var btnBorder = d.variant === 'outline' ? '2px solid #2563eb' : 'none';
        var btnTextColor = d.variant === 'outline' ? '#2563eb' : '#fff';
        return '<div style="padding:12px 16px;text-align:' + (d.align||'center') + '">' +
          '<a href="' + _esc(d.href||'#') + '" style="display:inline-block;padding:10px 24px;background:' + btnColor + ';color:' + btnTextColor + ';border:' + btnBorder + ';border-radius:8px;font-size:14px;font-weight:600;text-decoration:none">' +
            _esc(d.text||'ボタン') +
          '</a></div>';
      }
      case 'testimonial':
        return '<div style="padding:14px 16px;border-left:3px solid #2563eb;margin:8px 16px;background:#f8f9fa;border-radius:0 8px 8px 0">' +
          '<div style="font-size:13px;color:var(--yellow,#f59e0b)">' + '⭐'.repeat(Math.min(d.rating||5,5)) + '</div>' +
          '<div style="font-size:13px;color:#1e2532;line-height:1.6;margin:6px 0;font-style:italic">「' + _esc(d.text||'') + '」</div>' +
          '<div style="font-size:12px;font-weight:600;color:#6b7280">' + _esc(d.name||'') + (d.company ? ' — ' + _esc(d.company) : '') + '</div>' +
        '</div>';
      case 'faq':
        return '<div style="padding:10px 16px;border-bottom:1px solid #f0f2f5">' +
          '<div style="font-size:13px;font-weight:700;color:#0b0f17;margin-bottom:5px">Q: ' + _esc(d.question||'') + '</div>' +
          '<div style="font-size:13px;color:#6b7280;line-height:1.6">A: ' + _esc(d.answer||'') + '</div>' +
        '</div>';
      case 'serviceCard':
        return '<div style="padding:14px 16px;border:1px solid #e5e7eb;border-radius:10px;margin:8px 16px">' +
          (d.badge ? '<div style="display:inline-block;padding:2px 8px;background:rgba(37,99,235,.1);color:#2563eb;border-radius:20px;font-size:10px;font-weight:700;margin-bottom:8px">' + _esc(d.badge) + '</div>' : '') +
          '<div style="font-size:22px;margin-bottom:6px">' + _esc(d.icon||'📦') + '</div>' +
          '<div style="font-size:14px;font-weight:700;color:#0b0f17;margin-bottom:4px">' + _esc(d.title||'') + '</div>' +
          '<div style="font-size:12px;color:#6b7280;margin-bottom:8px;line-height:1.5">' + _esc(d.description||'') + '</div>' +
          (d.price ? '<div style="font-size:13px;font-weight:700;color:#2563eb;margin-bottom:8px">' + _esc(d.price) + '</div>' : '') +
        '</div>';
      case 'cta': {
        var bgColor = { navy:'#0a1f44', green:'#1D9E75', white:'#fff', gray:'#f0f2f5' }[d.bg||'navy'] || '#0a1f44';
        var textColor = (d.bg === 'white' || d.bg === 'gray') ? '#0b0f17' : '#fff';
        var pb = d.primaryBtn || {text:'',href:''};
        var sb3 = d.secondaryBtn || {text:'',href:''};
        return '<div style="padding:24px 16px;background:' + bgColor + ';text-align:center">' +
          '<div style="font-size:18px;font-weight:700;color:' + textColor + ';margin-bottom:8px">' + _esc(d.headline||'') + '</div>' +
          '<div style="font-size:13px;color:' + textColor + ';opacity:.8;margin-bottom:16px;line-height:1.5">' + _esc(d.subtext||'') + '</div>' +
          '<div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap">' +
            (pb.text ? '<a style="display:inline-block;padding:8px 20px;background:#1D9E75;color:#fff;border-radius:7px;font-size:13px;font-weight:600;text-decoration:none">' + _esc(pb.text) + '</a>' : '') +
            (sb3.text ? '<a style="display:inline-block;padding:8px 20px;background:rgba(255,255,255,.15);color:' + textColor + ';border:1px solid rgba(255,255,255,.3);border-radius:7px;font-size:13px;font-weight:600;text-decoration:none">' + _esc(sb3.text) + '</a>' : '') +
          '</div>' +
        '</div>';
      }
      case 'html':
        try { return '<div style="padding:10px 16px">' + (d.code||'') + '</div>'; }
        catch(_) { return '<div style="padding:10px 16px;color:red;font-size:11px">HTML エラー</div>'; }
      default:
        return '<div style="padding:10px 16px;color:var(--gray-2);font-size:12px">[' + blk.type + ']</div>';
    }
  }

  /* ════════════════════════════════════════════════════════
     BLOCK PICKER MODAL
     ════════════════════════════════════════════════════════ */
  function openBlockPicker(afterIdx) {
    _insertAfter = afterIdx;
    _wmcCloseModal('wceBlockPickerModal');
    var bodyHtml =
      '<div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:14px">ブロックを追加</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px">' +
      BLOCK_TYPE_ORDER.map(function(type) {
        var meta = BLOCK_TYPES[type];
        return '<button onclick="WMCBlockEditor.insertBlock(\'' + type + '\',' + afterIdx + ');_wmcCloseModal(\'wceBlockPickerModal\')" ' +
          'style="display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:12px;border:1px solid var(--line);border-radius:9px;background:var(--bg-soft);cursor:pointer;text-align:left;transition:.15s;font-family:inherit" ' +
          'onmouseover="this.style.borderColor=\'var(--blue)\';this.style.background=\'rgba(37,99,235,.04)\'" ' +
          'onmouseout="this.style.borderColor=\'var(--line)\';this.style.background=\'var(--bg-soft)\'">' +
          '<span style="font-size:18px;line-height:1">' + _esc(meta.icon) + '</span>' +
          '<span style="font-size:12px;font-weight:600;color:var(--ink)">' + _esc(meta.label) + '</span>' +
          '<span style="font-size:10px;color:var(--gray-2)">' + _esc(meta.desc) + '</span>' +
        '</button>';
      }).join('') +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn-ghost" onclick="_wmcCloseModal(\'wceBlockPickerModal\')">キャンセル</button></div>';

    var ov = document.createElement('div');
    ov.id = 'wceBlockPickerModal';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:400;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML = '<div style="background:var(--bg);border-radius:14px;padding:22px;max-width:540px;width:100%;border:1px solid var(--line);box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:80vh;overflow-y:auto">' + bodyHtml + '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e) { if (e.target === ov) _wmcCloseModal('wceBlockPickerModal'); });
  }

  /* ════════════════════════════════════════════════════════
     MEDIA PICKER (delegates to WMCMedia)
     ════════════════════════════════════════════════════════ */
  function openMediaPicker(blockIdx, isGallery) {
    if (window.WMCMedia) {
      WMCMedia.openPicker(function(url) {
        if (isGallery) {
          var imgs = (_blocks[blockIdx]?.data.images || []).slice();
          imgs.push({ src: url, alt: '' });
          updateBlockData(blockIdx, { images: imgs });
          _renderSettings();
        } else {
          updateBlockData(blockIdx, { src: url });
          _renderSettings();
        }
      });
    } else {
      var url = prompt('画像URLを入力してください:');
      if (!url) return;
      if (isGallery) {
        var imgs2 = (_blocks[blockIdx]?.data.images || []).slice();
        imgs2.push({ src: url, alt: '' });
        updateBlockData(blockIdx, { images: imgs2 });
        _renderSettings();
      } else {
        updateBlockData(blockIdx, { src: url });
        _renderSettings();
      }
    }
  }

  /* ════════════════════════════════════════════════════════
     TITLE CHANGE
     ════════════════════════════════════════════════════════ */
  function _onTitleChange(val) {
    if (!_pageId) return;
    if (window.WMCPageManager) WMCPageManager.updatePage(_pageId, { title: val });
  }

  /* ════════════════════════════════════════════════════════
     PERSISTENCE
     ════════════════════════════════════════════════════════ */
  function _markDirty() {
    _dirty = true;
    _setSaveStatus('unsaved');
    clearTimeout(_autoTimer);
    _autoTimer = setTimeout(_autoSave, 2000);
  }

  function _autoSave() {
    save();
    _setSaveStatus('autosaved');
  }

  function _setSaveStatus(state) {
    var el = document.getElementById('wceSaveStatus');
    if (!el) return;
    var labels = { saving:'保存中…', saved:'保存済み', unsaved:'未保存の変更', autosaved:'自動保存済み' };
    var colors = { saving:'var(--yellow)', saved:'var(--green)', unsaved:'var(--red)', autosaved:'var(--green)' };
    el.textContent  = labels[state] || state;
    el.style.color  = colors[state] || 'var(--gray-2)';
  }

  function save() {
    if (!_pageId || !window.WMCPageManager) return;
    _setSaveStatus('saving');
    WMCPageManager.updatePage(_pageId, { blocks: JSON.parse(JSON.stringify(_blocks)) });
    _dirty = false;
    setTimeout(function() { _setSaveStatus('saved'); }, 400);
    if (typeof AuditLog !== 'undefined') AuditLog.record('update', 'page', _pageId, 'ブロックエディターで保存');
  }

  function publish() {
    save();
    if (!_pageId || !window.WMCPageManager) return;
    WMCPageManager.setStatus(_pageId, 'published');
    if (typeof toast === 'function') toast('ページを公開しました');
  }

  /* ── Escape helper ── */
  function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  return {
    open, close, save, publish, togglePreview,
    selectBlock, insertBlock, deleteBlock, duplicateBlock, moveBlock,
    updateBlockData,
    openBlockPicker, openMediaPicker,
    _upd, _updCTABtn, _removeGalleryImg, _onTitleChange,
  };

})();
