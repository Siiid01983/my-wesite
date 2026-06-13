(function () {
  const header = document.getElementById('siteHeader');
  const onScroll = () => {
    if (window.scrollY > 20) header.classList.add('scrolled');
    else header.classList.remove('scrolled');
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const toggle = document.getElementById('navToggle');
  const mobileNav = document.getElementById('mobileNav');
  toggle.addEventListener('click', () => {
    const open = mobileNav.classList.toggle('open');
    toggle.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    mobileNav.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.style.overflow = open ? 'hidden' : '';
  });
  mobileNav.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', () => {
      mobileNav.classList.remove('open');
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      mobileNav.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    });
  });

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.section, .trust-strip, .hero-content, .hero-visual').forEach((el) => {
    el.classList.add('reveal');
    io.observe(el);
  });

  // ===== MULTI-STEP QUOTE FORM =====
  (function () {
    const form = document.getElementById('quoteForm');
    if (!form) return;

    const stepEls = [
      document.getElementById('formStep1'),
      document.getElementById('formStep2'),
      document.getElementById('formStep3'),
      document.getElementById('formStep4'),
    ];
    const progressFill = document.getElementById('formProgressFill');
    const stepLabels = form.querySelectorAll('.step-label');
    const successEl = document.getElementById('formSuccess');
    const progressWrap = form.querySelector('.form-progress-wrap');
    let current = 1;
    let _trackStarted = false;

    function _hmTrack(name, params) {
      try {
        const p = Object.assign({ form: 'quote' }, params || {});
        if (typeof gtag === 'function') gtag('event', name, p);
        if (Array.isArray(window.dataLayer)) window.dataLayer.push(Object.assign({ event: name }, p));
      } catch(_) {}
    }

    function showStep(n) {
      stepEls.forEach((el, i) => el.classList.toggle('active', i + 1 === n));
      stepLabels.forEach((el, i) => {
        el.classList.toggle('active', i + 1 === n);
        el.classList.toggle('done', i + 1 < n);
      });
      if (progressFill) progressFill.style.width = (n / 4 * 100) + '%';
      if (!_trackStarted && n === 1) { _hmTrack('quote_started'); _trackStarted = true; }
      else if (n > current) _hmTrack('quote_step_completed', { step: current });
      current = n;
      const _allInputs = stepEls[n - 1].querySelectorAll('input:not([type="radio"]):not([type="checkbox"]), textarea');
      const firstInput = Array.from(_allInputs).find(el => el.offsetParent !== null);
      if (firstInput) setTimeout(() => firstInput.focus(), 80);
    }

    function hideError(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
    function showError(id) { const el = document.getElementById(id); if (el) el.style.display = 'block'; }

    function validate(step) {
      hideError('step1Error'); hideError('step2Error');
      hideError('step3Error'); hideError('step4Error'); hideError('submitError');
      if (step === 1) {
        if (!form.querySelector('[name="service"]:checked')) { showError('step1Error'); return false; }
      }
      if (step === 2) {
        const a = form.querySelector('[name="currentAddress"]').value.trim();
        const b = form.querySelector('[name="newAddress"]').value.trim();
        if (!a || !b) {
          const _e2 = document.getElementById('step2Error');
          if (_e2) _e2.textContent = !a && !b ? '引越し元と引越し先の住所を両方ご入力ください。' : !a ? '引越し元の住所をご入力ください。' : '引越し先の住所をご入力ください。';
          showError('step2Error'); return false;
        }
      }
      if (step === 3) {
        if (!form.querySelector('[name="date"]').value) { showError('step3Error'); return false; }
      }
      if (step === 4) {
        const name  = form.querySelector('[name="name"]').value.trim();
        const email = form.querySelector('[name="email"]').value.trim();
        if (!name || !email || !email.includes('@')) { showError('step4Error'); return false; }
      }
      return true;
    }

    document.getElementById('step1Next').addEventListener('click', () => { if (validate(1)) showStep(2); });
    document.getElementById('step2Back').addEventListener('click', () => showStep(1));
    document.getElementById('step2Next').addEventListener('click', () => { if (validate(2)) showStep(3); });
    document.getElementById('step3Back').addEventListener('click', () => showStep(2));
    document.getElementById('step3Next').addEventListener('click', () => { if (validate(3)) showStep(4); });
    document.getElementById('step4Back').addEventListener('click', () => showStep(3));

    document.querySelectorAll('[name="service"]').forEach(r => {
      r.addEventListener('change', () => {
        setTimeout(() => { if (validate(1)) showStep(2); }, 320);
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validate(4)) return;
      _hmTrack('quote_submitted');
      const btn = document.getElementById('submitBtn');
      const _btnText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '送信中...';
      try {
        const resp = await fetch('https://formspree.io/f/xdajqzlo', {
          method: 'POST',
          body: new FormData(form),
          headers: { 'Accept': 'application/json' }
        });
        if (resp.ok) {
          let bookingRef = null;
          try {
            if (typeof BookingService !== 'undefined') {
              const _bk = await BookingService.createBooking({
                name:     form.querySelector('[name="name"]').value.trim()    || '',
                email:    form.querySelector('[name="email"]').value.trim()   || '',
                phone:    (form.querySelector('[name="tel"]') || {value:''}).value.trim() || '',
                service:  (form.querySelector('[name="service"]:checked') || {}).value || '',
                date:     form.querySelector('[name="date"]').value            || '',
                time:     (form.querySelector('[name="time"]') || {value:''}).value || '',
                fromAddr: form.querySelector('[name="currentAddress"]').value.trim() || '',
                toAddr:   form.querySelector('[name="newAddress"]').value.trim()     || '',
                notes:    (form.querySelector('[name="message"]') || {value:''}).value || '',
                status:   '新規',
              });
              bookingRef = _bk && _bk.id;
            }
          } catch(sbErr) {
            console.error('[QuoteForm] Supabase write failed:', sbErr.message);
          }
          if (!bookingRef) {
            const _d = new Date(), _p = n => String(n).padStart(2, '0');
            bookingRef = 'HM-' + _d.getFullYear() + _p(_d.getMonth()+1) + _p(_d.getDate()) + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
          }
          sessionStorage.removeItem('hm_quote');
          stepEls.forEach(el => { el.classList.remove('active'); el.style.display = 'none'; });
          if (progressWrap) progressWrap.style.display = 'none';
          if (successEl) successEl.style.display = 'block';
          const _refNum = document.getElementById('successRefNum');
          const _refWrap = document.getElementById('successRefWrap');
          if (_refNum) _refNum.textContent = bookingRef;
          if (_refWrap) _refWrap.style.display = '';
          const _copyBtn = document.getElementById('successCopyBtn');
          if (_copyBtn) {
            _copyBtn.onclick = function() {
              navigator.clipboard.writeText(bookingRef).then(function() {
                _copyBtn.textContent = 'コピーしました ✓';
                setTimeout(function() { _copyBtn.textContent = 'コピー'; }, 2000);
              }).catch(function() {});
            };
          }
          _hmTrack('quote_success');

          /* ── PHP mailer — confirmation email via send_email.php ── */
          fetch('send_email.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to_email:    form.querySelector('[name="email"]').value.trim(),
              to_name:     form.querySelector('[name="name"]').value.trim(),
              booking_ref: bookingRef,
              service:     (form.querySelector('[name="service"]:checked') || {}).value || '',
              move_date:   form.querySelector('[name="date"]').value || '',
              time_slot:   (form.querySelector('[name="time"]') || {value:''}).value || '未定',
              from_addr:   form.querySelector('[name="currentAddress"]').value.trim() || '',
              to_addr:     form.querySelector('[name="newAddress"]').value.trim() || '',
            }),
          }).catch(function(_mailErr) {
            console.warn('[send_email] request failed:', _mailErr);
          });

          /* ── Redirect to home after 5 s so user can note the reference number ── */
          setTimeout(function() { window.location.href = '/'; }, 5000);

          const bookedDate = form.querySelector('[name="date"]').value;
          if (bookedDate) {
            BOOKED_DATES.add(bookedDate);
            try {
              const _lb = JSON.parse(localStorage.getItem('hm_booked') || '[]');
              if (!_lb.includes(bookedDate)) _lb.push(bookedDate);
              localStorage.setItem('hm_booked', JSON.stringify(_lb));
            } catch(e) {}
            renderCalendar();
            renderCompactCalendar();
            const _fb = document.querySelector('.calendar-selection-feedback');
            if (_fb) {
              const _fn = document.createElement('p');
              _fn.className = 'selection-text';
              _fn.style.color = '#1D9E75';
              _fn.textContent = 'ご予約ありがとうございます。選択した日程は仮予約済みとなりました。';
              _fb.appendChild(_fn);
            }
            const gcalLink = document.getElementById('gcalLink');
            if (gcalLink) {
              const _d1 = bookedDate.replace(/-/g, '');
              const _nd = new Date(bookedDate); _nd.setDate(_nd.getDate() + 1);
              const _d2 = formatDateString(_nd).replace(/-/g, '');
              gcalLink.href = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
                + '&text=' + encodeURIComponent('Hello Moving 引越し予約')
                + '&dates=' + _d1 + '/' + _d2
                + '&details=' + encodeURIComponent('Hello Movingへのお引越しご予約を承りました。')
                + '&location=' + encodeURIComponent('Tokyo, Japan');
              gcalLink.style.display = 'inline-flex';
            }
          }
        } else {
          console.error('[QuoteForm] Formspree error status:', resp.status);
          _hmTrack('quote_error', { reason: 'formspree', status: resp.status });
          btn.disabled = false;
          btn.textContent = _btnText;
          showError('submitError');
        }
      } catch(submitErr) {
        console.error('[QuoteForm] submit error:', submitErr);
        _hmTrack('quote_error', { reason: 'network' });
        btn.disabled = false;
        btn.textContent = _btnText;
        showError('submitError');
      }
    });

    document.querySelectorAll('[data-service]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const val = link.dataset.service;
        const radio = form.querySelector(`[name="service"][value="${val}"]`);
        if (radio) radio.checked = true;
        openBookingApp(val);
      });
    });

    form.addEventListener('input', () => {
      const data = {};
      new FormData(form).forEach((v, k) => data[k] = v);
      sessionStorage.setItem('hm_quote', JSON.stringify(data));
    });

    const _saved = JSON.parse(sessionStorage.getItem('hm_quote') || 'null');
    if (_saved) {
      Object.entries(_saved).forEach(([k, v]) => {
        const radios = form.querySelectorAll(`[name="${k}"][type="radio"],[name="${k}"][type="checkbox"]`);
        if (radios.length) {
          radios.forEach(r => { if (r.value === v) r.checked = true; });
          return;
        }
        const el = form.querySelector(`[name="${k}"]`);
        if (el) el.value = v;
      });
    }
    showStep(1);
  })();

  // ===== BOOKING CALENDAR =====
  const ADMIN_AVAILABILITY = {
    booked:  ["2026-06-10", "2026-06-11"],
    limited: ["2026-06-12"]
  };
  const BOOKED_DATES  = new Set(ADMIN_AVAILABILITY.booked);
  try { JSON.parse(localStorage.getItem('hm_booked') || '[]').forEach(d => BOOKED_DATES.add(d)); } catch(e) {}
  const LIMITED_DATES = new Set(ADMIN_AVAILABILITY.limited);
  const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
  const AVAILABLE_SYMBOL = '○';
  const BOOKED_SYMBOL = '×';
  const LIMITED_SYMBOL = '△';

  localStorage.removeItem('hm_park');
  let PARK_MODE = false;

  function updateParkUI() {
    const btn = document.getElementById('parkModeToggle');
    const banner = document.getElementById('parkModeBanner');
    if (btn) { btn.classList.toggle('active', PARK_MODE); btn.textContent = PARK_MODE ? '▶ Resume' : '⏸ Park'; }
    if (banner) banner.style.display = PARK_MODE ? 'block' : 'none';
  }

  function formatDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatJapaneseDate(date) {
    const year = date.getFullYear();
    const month = MONTH_NAMES[date.getMonth()];
    const day = date.getDate();
    const dayName = DAY_NAMES[date.getDay()];
    return `${year}年${month}${day}日（${dayName}）`;
  }

  function renderCalendar() {
    const container = document.querySelector('.calendar-container');
    if (!container) return;
    container.innerHTML = '';
    const today = new Date();

    for (let monthOffset = 0; monthOffset < 2; monthOffset++) {
      const date = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
      const year = date.getFullYear();
      const month = date.getMonth();
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      const monthDiv = document.createElement('div');
      monthDiv.className = 'calendar-month';

      const hdr = document.createElement('div');
      hdr.className = 'month-header';
      hdr.innerHTML = `<h3 class="month-title">${year}年 ${MONTH_NAMES[month]}</h3>`;
      monthDiv.appendChild(hdr);

      const grid = document.createElement('div');
      grid.className = 'calendar-grid';

      DAY_NAMES.forEach(day => {
        const dayHeader = document.createElement('div');
        dayHeader.className = 'day-header';
        dayHeader.textContent = day;
        grid.appendChild(dayHeader);
      });

      for (let i = 0; i < firstDay; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'calendar-day empty';
        grid.appendChild(emptyDay);
      }

      for (let d = 1; d <= daysInMonth; d++) {
        const dayBtn = document.createElement('button');
        dayBtn.className = 'calendar-day';
        dayBtn.type = 'button';

        const dateObj = new Date(year, month, d);
        const dateStr = formatDateString(dateObj);
        const isBeforeToday = dateObj < new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const tomorrow = new Date(today.getTime() + 86400000);
        const isTodayOrTomorrow = (dateObj.toDateString() === today.toDateString()) || (dateObj.toDateString() === tomorrow.toDateString());

        if (isBeforeToday) {
          dayBtn.classList.add('empty');
          dayBtn.disabled = true;
          dayBtn.innerHTML = '';
        } else if (PARK_MODE || BOOKED_DATES.has(dateStr)) {
          dayBtn.classList.add('booked');
          dayBtn.disabled = true;
          dayBtn.innerHTML = `<div class="cal-day-num">${d}</div><div class="cal-status">${BOOKED_SYMBOL}</div>`;
          dayBtn.setAttribute('aria-label', `${d}日 - 満了`);
        } else if (LIMITED_DATES.has(dateStr)) {
          dayBtn.classList.add('limited');
          dayBtn.innerHTML = `<div class="cal-day-num">${d}</div><div class="cal-status">${LIMITED_SYMBOL}</div>`;
          dayBtn.setAttribute('aria-label', `${d}日 - 残りわずか`);
          dayBtn.addEventListener('click', (e) => { e.preventDefault(); selectDate(dateObj, isTodayOrTomorrow); });
        } else {
          dayBtn.classList.add('available');
          dayBtn.innerHTML = `<div class="cal-day-num">${d}</div><div class="cal-status">${AVAILABLE_SYMBOL}</div>`;
          dayBtn.setAttribute('aria-label', `${d}日 - 空き`);
          dayBtn.addEventListener('click', (e) => { e.preventDefault(); selectDate(dateObj, isTodayOrTomorrow); });
        }

        grid.appendChild(dayBtn);
      }

      monthDiv.appendChild(grid);
      container.appendChild(monthDiv);
    }
  }

  function selectDate(dateObj, isTodayOrTomorrow) {
    const dateInput = document.querySelector('input[name="date"]');
    const dateStr = formatDateString(dateObj);
    const japaneseDate = formatJapaneseDate(dateObj);

    if (dateInput) {
      dateInput.value = dateStr;
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const selectionMsg = document.getElementById('selectionMessage');
    if (selectionMsg) selectionMsg.textContent = `ご選択ありがとうございます。${japaneseDate}のお引越しで承知いたしました。`;

    const urgentNotice = document.getElementById('urgentNotice');
    const quickMovingCheckbox = document.querySelector('input[name="quickMoving"]');
    const urgentCard = document.querySelector('.service-card-urgent');

    if (isTodayOrTomorrow) {
      if (quickMovingCheckbox) { quickMovingCheckbox.checked = true; quickMovingCheckbox.dispatchEvent(new Event('change', { bubbles: true })); }
      if (urgentNotice) urgentNotice.style.display = 'flex';
      if (urgentCard) urgentCard.classList.add('highlight');
    } else {
      if (urgentNotice) urgentNotice.style.display = 'none';
      if (urgentCard) urgentCard.classList.remove('highlight');
    }

    document.querySelectorAll('.calendar-day.selected').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('.calendar-day').forEach(el => {
      if (!el.classList.contains('booked') && !el.classList.contains('empty')) {
        const aria = el.getAttribute('aria-label') || '';
        if (aria.includes(`${dateObj.getDate()}日`)) el.classList.add('selected');
      }
    });

    const qf = document.getElementById('quoteForm');
    if (qf) {
      qf.classList.remove('form-pulse');
      void qf.offsetWidth;
      qf.classList.add('form-pulse');
      setTimeout(() => qf.classList.remove('form-pulse'), 800);
    }

    const quoteSection = document.getElementById('quote');
    if (quoteSection) setTimeout(() => { quoteSection.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 300);
  }

  const STANDARDS = [
    { title: '時間厳守', desc: 'お約束の時間を守り、お客様の一日を尊重します.' },
    { title: '丁寧な養生', desc: '床・壁・家具を傷つけない養生を徹底します.' },
    { title: '清潔な作業', desc: '整理整頓を心がけ、後片付けまで丁寧に行います.' },
    { title: '安全第一', desc: '作業中の安全管理と保険で万一に備えます.' }
  ];

  function renderStandards() {
    const g = document.getElementById('standardsGrid');
    if (!g) return;
    g.innerHTML = '';
    STANDARDS.forEach(s => {
      const it = document.createElement('div');
      it.className = 'standard-item';
      it.innerHTML = `<div class="std-icon" aria-hidden="true">●</div><div class="std-body"><h4>${s.title}</h4><p>${s.desc}</p></div>`;
      g.appendChild(it);
    });
  }

  function initImageLightbox() {
    const overlay = document.createElement('div');
    overlay.className = 'image-lightbox';
    overlay.innerHTML = `
      <div class="lightbox-backdrop" role="dialog" aria-modal="true" aria-label="画像の拡大表示">
        <button class="lightbox-close" type="button" aria-label="閉じる">×</button>
        <img class="lightbox-image" alt="" />
        <p class="lightbox-caption"></p>
      </div>`;
    document.body.appendChild(overlay);
    const lightboxImage = overlay.querySelector('.lightbox-image');
    const lightboxCaption = overlay.querySelector('.lightbox-caption');
    const closeButton = overlay.querySelector('.lightbox-close');
    const closeLightbox = () => { overlay.classList.remove('active'); lightboxImage.src = ''; lightboxCaption.textContent = ''; };
    overlay.addEventListener('click', (event) => { if (event.target === overlay || event.target === closeButton) closeLightbox(); });
    closeButton.addEventListener('click', closeLightbox);
    document.querySelectorAll('.gallery-image img, .before-after-image img').forEach(img => {
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', () => { lightboxImage.src = img.src; lightboxImage.alt = img.alt || ''; lightboxCaption.textContent = img.alt || ''; overlay.classList.add('active'); });
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && overlay.classList.contains('active')) closeLightbox(); });
  }

  function renderCompactCalendar() {
    const el = document.getElementById('compactCalendar');
    if (!el) return;
    el.innerHTML = '';
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const dateStr = formatDateString(d);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'compact-day';
      btn.dataset.date = dateStr;
      if (PARK_MODE || BOOKED_DATES.has(dateStr)) {
        btn.classList.add('booked');
        btn.textContent = `${d.getDate()} ${BOOKED_SYMBOL}`;
        btn.disabled = true;
      } else if (LIMITED_DATES.has(dateStr)) {
        btn.classList.add('limited');
        btn.textContent = `${d.getDate()} ${LIMITED_SYMBOL}`;
        btn.addEventListener('click', () => selectDate(d, (i === 0 || i === 1)));
      } else {
        btn.classList.add('available');
        btn.textContent = `${d.getDate()} ${AVAILABLE_SYMBOL}`;
        btn.addEventListener('click', () => selectDate(d, (i === 0 || i === 1)));
      }
      el.appendChild(btn);
    }
  }

  // initialize all
  updateParkUI();
  renderCalendar();
  renderCompactCalendar();
  renderStandards();
  initImageLightbox();

  // Park Mode toggle
  const _parkBtn = document.getElementById('parkModeToggle');
  if (_parkBtn) {
    _parkBtn.addEventListener('click', () => {
      PARK_MODE = !PARK_MODE;
      localStorage.setItem('hm_park', PARK_MODE);
      updateParkUI();
      renderCalendar();
      renderCompactCalendar();
    });
  }

  // Dark mode toggle
  document.querySelectorAll('#darkToggle, #darkToggleMobile').forEach(btn => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      const dark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('hm_theme', dark ? 'dark' : 'light');
    });
  });

  // ===== UPLOAD DROP ZONE =====
  (function() {
    const zone = document.getElementById('uploadZone');
    const input = document.getElementById('photoUpload');
    const list  = document.getElementById('uploadFileList');
    if (!zone || !input || !list) return;

    let selectedFiles = new DataTransfer();

    function renderList() {
      list.innerHTML = '';
      Array.from(selectedFiles.files).forEach((file, i) => {
        const item = document.createElement('div');
        item.className = 'upload-file-item';
        item.innerHTML = `<span title="${file.name}">${file.name}</span>
          <button type="button" class="upload-file-remove" aria-label="削除" data-index="${i}">×</button>`;
        list.appendChild(item);
      });
    }

    function addFiles(newFiles) {
      Array.from(newFiles).slice(0, 5 - selectedFiles.files.length).forEach(f => selectedFiles.items.add(f));
      input.files = selectedFiles.files;
      renderList();
    }

    input.addEventListener('change', () => { addFiles(input.files); });

    list.addEventListener('click', e => {
      const btn = e.target.closest('.upload-file-remove');
      if (!btn) return;
      e.preventDefault(); e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      const rebuild = new DataTransfer();
      Array.from(selectedFiles.files).forEach((f, i) => { if (i !== idx) rebuild.items.add(f); });
      selectedFiles = rebuild;
      input.files = selectedFiles.files;
      renderList();
    });

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      addFiles(e.dataTransfer.files);
    });
  })();

  document.querySelectorAll('.liveChatTrigger').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      window.location.href = 'mailto:hellomoving1@gmail.com?subject=お問い合わせ';
    });
  });

  // Use replaceState for internal section anchors so the browser back button
  // always returns to the referring page (e.g. a search engine results page)
  // rather than cycling through hash history entries.
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    const hash = link.getAttribute('href');
    if (!hash || hash === '#') return;
    link.addEventListener('click', e => {
      const target = document.querySelector(hash);
      if (!target) return;
      e.preventDefault();
      history.replaceState(null, '', hash);
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

})();

// ── Postal code lookup (ZipCloud API) ───────────────────
function zipLookup(zipEl, addrBlockEl, addrValEl, bldgFieldEl, hiddenEl, statusEl, manualEl) {
  var raw = zipEl.value.replace(/[^\d]/g, '');
  if (raw.length < 7) { statusEl.className = 'zip-status'; statusEl.textContent = ''; return; }
  statusEl.className = 'zip-status loading';
  statusEl.textContent = '';
  fetch('https://zipcloud.ibsnet.co.jp/api/search?zipcode=' + raw)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.results && data.results[0]) {
        var r = data.results[0];
        var base = r.address1 + r.address2 + r.address3;
        addrValEl.textContent = base;
        addrBlockEl.style.display = '';
        bldgFieldEl.style.display = '';
        if (manualEl) { manualEl.style.display = 'none'; var _mi = manualEl.querySelector('input'); if (_mi) _mi.value = ''; }
        var bldgIn = bldgFieldEl.querySelector('input');
        hiddenEl.value = base + (bldgIn && bldgIn.value ? '　' + bldgIn.value : '');
        statusEl.className = 'zip-status ok';
        statusEl.textContent = '✓';
      } else {
        addrBlockEl.style.display = 'none';
        bldgFieldEl.style.display = 'none';
        hiddenEl.value = '';
        statusEl.className = 'zip-status err';
        statusEl.textContent = '住所が見つかりませんでした';
        if (manualEl) manualEl.style.display = '';
      }
    })
    .catch(function() {
      addrBlockEl.style.display = 'none';
      bldgFieldEl.style.display = 'none';
      hiddenEl.value = '';
      statusEl.className = 'zip-status err';
      statusEl.textContent = '住所が見つかりませんでした';
      if (manualEl) manualEl.style.display = '';
    });
}

function wireZip(zipId, addrBlockId, addrValId, bldgFieldId, hiddenId, statusId, manualId) {
  var zipEl = document.getElementById(zipId);
  if (!zipEl) return;
  var addrBlockEl = document.getElementById(addrBlockId);
  var addrValEl   = document.getElementById(addrValId);
  var bldgFieldEl = document.getElementById(bldgFieldId);
  var hiddenEl    = document.getElementById(hiddenId);
  var statusEl    = document.getElementById(statusId);
  var manualEl    = manualId ? document.getElementById(manualId) : null;
  if (!addrBlockEl || !addrValEl || !bldgFieldEl || !hiddenEl || !statusEl) return;

  var timer;
  zipEl.addEventListener('input', function() {
    var digits = zipEl.value.replace(/[^\d]/g, '');
    zipEl.value = digits.length > 3 ? digits.slice(0, 3) + '-' + digits.slice(3, 7) : digits;
    clearTimeout(timer);
    if (digits.length >= 7) {
      timer = setTimeout(function() {
        zipLookup(zipEl, addrBlockEl, addrValEl, bldgFieldEl, hiddenEl, statusEl, manualEl);
      }, 400);
    } else {
      statusEl.className = 'zip-status';
      statusEl.textContent = '';
      addrBlockEl.style.display = 'none';
      bldgFieldEl.style.display = 'none';
      hiddenEl.value = '';
      if (manualEl && digits.length === 0) manualEl.style.display = 'none';
    }
  });

  var bldgIn = bldgFieldEl.querySelector('input');
  if (bldgIn) {
    bldgIn.addEventListener('input', function() {
      if (addrValEl.textContent) {
        hiddenEl.value = addrValEl.textContent + (bldgIn.value ? '　' + bldgIn.value : '');
      }
    });
  }

  if (manualEl) {
    var manualIn = manualEl.querySelector('input');
    if (manualIn) {
      manualIn.addEventListener('input', function() {
        hiddenEl.value = manualIn.value.trim();
      });
    }
  }
}

// Wire hero quote form postal code fields
wireZip('qFromZip', 'qFromAddrBlock', 'qFromAddrVal', 'qFromBldgField', 'qFromAddr', 'qFromZipStatus', 'qFromManual');
wireZip('qToZip',   'qToAddrBlock',   'qToAddrVal',   'qToBldgField',   'qToAddr',   'qToZipStatus',   'qToManual');
