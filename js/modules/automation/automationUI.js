'use strict';

/* ════════════════════════════════════════════════════════
   AUTOMATION UI — Phase 24
   Renders the 自動化エンジン admin view and rule editor modal.
   Wraps go() to inject rendering for the 'automation' view.

   Depends on: AutomationRules, AutomationAudit, AutomationActions,
               AutomationEngine, esc, toast, VIEW_TITLES, go
   ════════════════════════════════════════════════════════ */

(function () {

  /* ── Patch VIEW_TITLES ── */
  try { VIEW_TITLES['automation'] = '自動化エンジン'; } catch (_) {}
  try { _ADMIN_ONLY.add('automation'); } catch (_) {}

  /* ── Condition type metadata (mirrors AutomationEngine evaluators) ── */
  var COND_TYPES = [
    { id: 'completion_followup', label: '引越し完了N日後',   param: 'daysAfterCompletion', unit: '日後', def: 7   },
    { id: 'pre_move_reminder',   label: '引越しN日前',       param: 'daysBeforeMove',      unit: '日前', def: 3   },
    { id: 'quote_followup',      label: '見積もり作成N日後', param: 'daysAfterQuote',      unit: '日後', def: 3   },
    { id: 'low_occupancy',       label: '稼働率N%以下アラート', param: 'occupancyBelow',   unit: '%以下', def: 50 },
    { id: 'high_occupancy',      label: '稼働率N%以上アラート', param: 'occupancyAbove',   unit: '%以上', def: 90 }
  ];

  var _editId = null;

  /* ── Wrap go() ── */
  var _origGo = window.go;
  window.go = function (view) {
    _origGo(view);
    if (view === 'automation') renderAutomation();
  };

  /* ════ Main render ════ */

  function renderAutomation() {
    var el = document.getElementById('view-automation');
    if (!el) return;
    var rules  = AutomationRules.getAll();
    var audits = AutomationAudit.getAll().slice(0, 40);
    el.innerHTML = _rulesPanel(rules) + _historyPanel(audits) + _modal();
  }

  /* ── Rules panel ── */

  function _rulesPanel(rules) {
    var rows = rules.length
      ? rules.map(_ruleRow).join('')
      : '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--gray-2)">ルールがありません</td></tr>';

    var activeCount  = rules.filter(function (r) { return r.enabled; }).length;
    var running      = window.AutomationScheduler && AutomationScheduler.isRunning();
    var statusBadge  = running
      ? '<span style="font-size:11px;color:var(--green);font-weight:600;display:flex;align-items:center;gap:4px"><span style="width:7px;height:7px;border-radius:50%;background:var(--green);display:inline-block"></span>スケジューラー稼働中</span>'
      : '<span style="font-size:11px;color:var(--gray-2)">スケジューラー停止</span>';

    return '<div class="panel" style="margin-bottom:16px">' +
      '<div class="panel-head">' +
        '<span class="panel-title">自動化ルール</span>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          statusBadge +
          '<span style="font-size:11px;color:var(--gray-2)">' + activeCount + '/' + rules.length + '件 有効</span>' +
          '<button class="btn btn-ghost btn-sm" onclick="AutomationEngine.run().then(function(n){toast(n+\'件のアクションを実行しました\');renderAutomation()})">今すぐ実行</button>' +
          '<button class="btn btn-primary btn-sm" onclick="AutomationUI.openModal()">ルールを追加</button>' +
        '</div>' +
      '</div>' +
      '<div class="table-wrap">' +
        '<table>' +
          '<thead><tr>' +
            '<th style="width:50px;text-align:center">有効</th>' +
            '<th>ルール名</th><th>条件</th><th>アクション</th><th></th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';
  }

  function _condLabel(rule) {
    var ct = COND_TYPES.find(function (c) { return c.id === rule.condType; });
    if (!ct) return rule.condType || '—';
    var val = rule.conditions[ct.param];
    return ct.label.replace('N', val !== undefined ? val : '?');
  }

  function _ruleRow(rule) {
    var checked = rule.enabled ? 'checked' : '';
    var actions = (rule.actions || []).map(function (a) {
      return AutomationActions.label(a);
    }).join('、');
    var enabledBg = rule.enabled
      ? 'background:rgba(16,185,129,.08);'
      : '';
    return '<tr style="' + enabledBg + '">' +
      '<td style="text-align:center">' +
        '<input type="checkbox" ' + checked +
          ' onchange="AutomationRules.toggle(\'' + rule.id + '\');renderAutomation()" />' +
      '</td>' +
      '<td>' +
        '<div style="font-weight:600;font-size:13px;color:var(--ink)">' + esc(rule.name) + '</div>' +
        (rule.description
          ? '<div style="font-size:11px;color:var(--gray-2);margin-top:2px">' + esc(rule.description) + '</div>'
          : '') +
      '</td>' +
      '<td style="font-size:12px;color:var(--gray-1)">' + esc(_condLabel(rule)) + '</td>' +
      '<td style="font-size:12px;color:var(--gray-1)">' + esc(actions || '—') + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn btn-ghost btn-sm" onclick="AutomationUI.openModal(\'' + rule.id + '\')">編集</button>' +
        ' ' +
        '<button class="btn btn-danger btn-sm" onclick="AutomationUI.deleteRule(\'' + rule.id + '\')">削除</button>' +
      '</td>' +
    '</tr>';
  }

  /* ── History panel ── */

  function _historyPanel(audits) {
    var rows = audits.length
      ? audits.map(function (e) {
          var d  = new Date(e.ts);
          var ts = d.getFullYear() + '/' + _p2(d.getMonth() + 1) + '/' + _p2(d.getDate()) +
                   ' ' + _p2(d.getHours()) + ':' + _p2(d.getMinutes());
          var ok = e.result === 'success';
          var badge = ok
            ? '<span style="color:var(--green);font-size:11px;font-weight:600">✓ 成功</span>'
            : '<span style="color:var(--red);font-size:11px;font-weight:600">✗ エラー</span>';
          return '<tr>' +
            '<td style="font-size:11px;color:var(--gray-2);white-space:nowrap">' + ts + '</td>' +
            '<td style="font-size:12px;font-weight:500;color:var(--ink)">' + esc(e.ruleName || '') + '</td>' +
            '<td style="font-size:12px;color:var(--gray-1)">' + esc(AutomationActions.label(e.action)) + '</td>' +
            '<td>' + badge + '</td>' +
            '<td style="font-size:11px;color:var(--gray-2);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
              esc(e.detail || '') +
            '</td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--gray-2)">実行履歴はありません</td></tr>';

    return '<div class="panel">' +
      '<div class="panel-head">' +
        '<span class="panel-title">実行履歴</span>' +
        '<button class="btn btn-ghost btn-sm" onclick="AutomationUI.clearHistory()">履歴をクリア</button>' +
      '</div>' +
      '<div class="table-wrap">' +
        '<table>' +
          '<thead><tr>' +
            '<th>日時</th><th>ルール</th><th>アクション</th><th>結果</th><th>詳細</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';
  }

  /* ── Modal HTML (embedded in view, position:fixed covers full screen) ── */

  function _modal() {
    var condOpts = COND_TYPES.map(function (ct) {
      return '<option value="' + ct.id + '">' + ct.label + '</option>';
    }).join('');

    var actionOpts = AutomationActions.list().map(function (a) {
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
        '<input type="checkbox" id="amAct_' + a.id + '" value="' + a.id + '" />' +
        '<label for="amAct_' + a.id + '" style="font-size:13px;cursor:pointer">' + esc(a.label) + '</label>' +
      '</div>';
    }).join('');

    return '<div class="overlay" id="autoModal" onclick="if(event.target===this)AutomationUI.closeModal()">' +
      '<div class="modal" style="max-width:480px">' +
        '<div class="modal-title" id="autoModalTitle">ルールを追加</div>' +
        '<div class="m-field">' +
          '<label class="m-label">ルール名 *</label>' +
          '<input class="m-input" id="amName" placeholder="例: レビュー依頼" />' +
        '</div>' +
        '<div class="m-field">' +
          '<label class="m-label">説明</label>' +
          '<input class="m-input" id="amDesc" placeholder="任意の説明" />' +
        '</div>' +
        '<div class="m-field">' +
          '<label class="m-label">条件タイプ</label>' +
          '<select class="sel" id="amCondType" style="width:100%" ' +
            'onchange="AutomationUI._onCondTypeChange(this.value)">' + condOpts + '</select>' +
        '</div>' +
        '<div class="m-field">' +
          '<label class="m-label" id="amParamLabel">日数</label>' +
          '<input class="m-input" id="amParamVal" type="number" min="1" max="365" value="7" ' +
            'style="width:120px" />' +
        '</div>' +
        '<div class="m-field">' +
          '<label class="m-label">アクション *</label>' + actionOpts +
        '</div>' +
        '<div class="m-field" style="display:flex;align-items:center;gap:10px">' +
          '<input type="checkbox" id="amEnabled" checked />' +
          '<label for="amEnabled" style="font-size:13px;cursor:pointer">このルールを有効にする</label>' +
        '</div>' +
        '<div class="m-actions">' +
          '<button class="btn btn-ghost" onclick="AutomationUI.closeModal()">キャンセル</button>' +
          '<button class="btn btn-primary" onclick="AutomationUI.saveModal()">保存</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function _p2(n) { return String(n).padStart(2, '0'); }

  /* ── Modal API ── */

  function openModal(id) {
    _editId = id || null;
    var el = document.getElementById('autoModal');
    if (!el) return;
    document.getElementById('autoModalTitle').textContent = id ? 'ルールを編集' : 'ルールを追加';

    if (id) {
      var rule = AutomationRules.get(id);
      if (!rule) return;
      document.getElementById('amName').value    = rule.name;
      document.getElementById('amDesc').value    = rule.description || '';
      document.getElementById('amCondType').value = rule.condType;
      _onCondTypeChange(rule.condType);
      var ct = COND_TYPES.find(function (c) { return c.id === rule.condType; });
      if (ct) {
        var val = rule.conditions[ct.param];
        document.getElementById('amParamVal').value = val !== undefined ? val : ct.def;
      }
      AutomationActions.list().forEach(function (a) {
        var cb = document.getElementById('amAct_' + a.id);
        if (cb) cb.checked = (rule.actions || []).indexOf(a.id) !== -1;
      });
      document.getElementById('amEnabled').checked = !!rule.enabled;
    } else {
      document.getElementById('amName').value     = '';
      document.getElementById('amDesc').value     = '';
      document.getElementById('amCondType').value = COND_TYPES[0].id;
      _onCondTypeChange(COND_TYPES[0].id);
      AutomationActions.list().forEach(function (a) {
        var cb = document.getElementById('amAct_' + a.id);
        if (cb) cb.checked = false;
      });
      document.getElementById('amEnabled').checked = true;
    }
    el.classList.add('open');
  }

  function closeModal() {
    var el = document.getElementById('autoModal');
    if (el) el.classList.remove('open');
    _editId = null;
  }

  function _onCondTypeChange(typeId) {
    var ct = COND_TYPES.find(function (c) { return c.id === typeId; });
    if (!ct) return;
    var lbl = document.getElementById('amParamLabel');
    var inp = document.getElementById('amParamVal');
    if (lbl) lbl.textContent = ct.label.replace('N', '数値') + '（' + ct.unit + '）';
    if (inp) { inp.value = ct.def; }
  }

  function saveModal() {
    var name = (document.getElementById('amName').value || '').trim();
    if (!name) { toast('ルール名を入力してください'); return; }

    var condType = document.getElementById('amCondType').value;
    var ct       = COND_TYPES.find(function (c) { return c.id === condType; });
    var paramVal = parseInt(document.getElementById('amParamVal').value, 10) || (ct ? ct.def : 7);
    var conds    = {};
    if (ct) conds[ct.param] = paramVal;

    var actions = AutomationActions.list()
      .filter(function (a) {
        var cb = document.getElementById('amAct_' + a.id);
        return cb && cb.checked;
      })
      .map(function (a) { return a.id; });

    if (!actions.length) { toast('アクションを1つ以上選択してください'); return; }

    var rule = {
      name: name,
      description: (document.getElementById('amDesc').value || '').trim(),
      enabled: document.getElementById('amEnabled').checked,
      trigger: 'schedule',
      condType: condType,
      conditions: conds,
      actions: actions
    };

    if (_editId) { AutomationRules.update(_editId, rule); }
    else         { AutomationRules.add(rule); }

    closeModal();
    renderAutomation();
    toast('ルールを保存しました');
    if (window.AuditLog) AuditLog.record('save', 'automation', rule.name, 'ルールを' + (_editId ? '編集' : '追加'));
  }

  function deleteRule(id) {
    var rule = AutomationRules.get(id);
    if (!rule) return;
    if (!confirm('「' + rule.name + '」を削除しますか？')) return;
    AutomationRules.remove(id);
    renderAutomation();
    toast('ルールを削除しました');
    if (window.AuditLog) AuditLog.record('delete', 'automation', rule.name, 'ルールを削除');
  }

  function clearHistory() {
    if (!confirm('実行履歴をすべてクリアしますか？')) return;
    AutomationAudit.clear();
    renderAutomation();
    toast('履歴をクリアしました');
  }

  /* ── Expose as globals ── */
  window.renderAutomation = renderAutomation;

  window.AutomationUI = {
    renderAutomation:  renderAutomation,
    openModal:         openModal,
    closeModal:        closeModal,
    saveModal:         saveModal,
    deleteRule:        deleteRule,
    clearHistory:      clearHistory,
    _onCondTypeChange: _onCondTypeChange
  };

})();
