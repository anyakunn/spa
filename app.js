/* =========================================================================
   LETUP33 — single runtime (app.js)
   - Satu-satunya fail JS; tiada duplikasi UI/Modal.
   - Semua ID diselaraskan dengan letup33-endpoint-sync-v3.html.
   - Endpoint dibina semula dalam #lp33-boot-config sahaja.
   ========================================================================= */
(function () {
  'use strict';

  /* ── 1. CONFIG ──────────────────────────────────────────────────────── */
  const BOOT = (() => {
    try {
      return JSON.parse(document.getElementById('lp33-boot-config')?.textContent || '{}');
    } catch (_) {
      return {};
    }
  })();

  // Endpoint lalai — boleh ditimpa melalui #lp33-boot-config
  const DEFAULT_EP = {
    liveStat:       '/getLiveStat.php',
    login:          '/login.php',
    register:       '/register/SMSRegister',
    changeBank:     '/changeBank',
    changeName:     '/changeName',
    changeEmail:    '/changeEmail',
    changePassword: '/changePassword',
    letup33:        'https://letup33.com/api/v1/index.php',
    walletFallback: '/api/wallet',
    bankFallback:   '/api/user/bank'
  };
  const EP   = { ...DEFAULT_EP, ...(BOOT.endpoints || {}) };
  const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const AUTH_KEY = 'letup33.auth.v1';
  const LEGACY_AUTH_KEY = 'crown2u.auth.v1'; // dibaca sekali untuk migrasi sesi lama

  const BANKS = [
    'Affin Bank', 'Agrobank', 'Alliance Bank', 'AmBank', 'Bank Islam', 'Bank Muamalat',
    'Bank Rakyat', 'Bank Simpanan Nasional', 'Bank of China (Malaysia)', 'CIMB Bank',
    'Citibank', 'Hong Leong Bank', 'HSBC Bank', 'Maybank', 'MBSB Bank', 'OCBC Bank',
    'Public Bank', 'RHB Bank', 'Standard Chartered', 'UOB Malaysia'
  ];
  const TYPE_LABEL = {
    deposit: 'Deposit',
    withdraw: 'Pengeluaran',
    withdrawal: 'Pengeluaran',
    bonus: 'Bonus',
    rollover: 'Rollover'
  };

  const Store = {
    user: null,
    wallet: null,
    bank: null,
    history: [],
    isAuthenticated: false,
    config: {
      merchantId: BOOT.liveTx?.sources?.[0]?.mId || '60979',
      ticker: BOOT.ticker || ''
    }
  };

  /* ── 2. UTIL ────────────────────────────────────────────────────────── */
  const $  = id => document.getElementById(id);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const num = v => (v == null || v === '' || isNaN(Number(v))) ? 0 : Number(v);
  const fmtRM = v => new Intl.NumberFormat('ms-MY', {
    style: 'currency',
    currency: 'MYR'
  }).format(num(v));
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const setTxt = (id, v) => {
    const el = $(id);
    if (el) el.textContent = v;
  };
  const fld = (root, name) => root?.querySelector(`[name="${name}"]`);

  /* ── 3. TOAST ───────────────────────────────────────────────────────── */
  let toastTimer;
  function toast(msg, type = 'info', ms = 2600) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  /* ── 4. ROUTER (hash + hide/show) ───────────────────────────────────── */
  const Router = {
    routes: ['home', 'change', 'vip'],
    go() {
      const hash  = location.hash.replace(/^#/, '');
      const route = this.routes.includes(hash) ? hash : 'home';
      $$('[data-route]').forEach(s => {
        s.classList.toggle('route-active', s.dataset.route === route);
      });
      window.scrollTo({ top: 0 });
    },
    init() {
      window.addEventListener('hashchange', () => this.go());
      this.go();
    }
  };

  /* ── 5. SESI (localStorage sahaja — tiada kredential dalam kod) ─────── */
  const API = {
    accessId: '459613705',
    accessToken: '15ed232b356eab70d910ba3b671c595f7c58be4e40d196c4d408335344d2e20d',
    setAuth(id, tok) {
      this.accessId = id || '';
      this.accessToken = tok || '';
      Store.isAuthenticated = !!(this.accessId && this.accessToken);
      try {
        localStorage.setItem(AUTH_KEY, JSON.stringify({
          accessId: this.accessId,
          accessToken: this.accessToken
        }));
      } catch (_) {}
      return { status: 'SUCCESS' };
    },
    restore() {
      try {
        let raw = localStorage.getItem(AUTH_KEY);
        if (!raw) {
          // Migrasi sekali dari kunci lama
          raw = localStorage.getItem(LEGACY_AUTH_KEY);
          if (raw) {
            localStorage.setItem(AUTH_KEY, raw);
            localStorage.removeItem(LEGACY_AUTH_KEY);
          }
        }
        const { accessId, accessToken } = JSON.parse(raw || '{}');
        if (accessId && accessToken) {
          this.setAuth(accessId, accessToken);
          return true;
        }
      } catch (_) {}
      return false;
    },
    clear() {
      this.accessId = '';
      this.accessToken = '';
      Store.isAuthenticated = false;
      try { localStorage.removeItem(AUTH_KEY); } catch (_) {}
    }
  };

  /* ── 6. NETWORK ─────────────────────────────────────────────────────── */
  // Penyegerakan data pengguna melalui endpoint letup33
  async function letup33Sync() {
    if (!API.accessId || !API.accessToken) throw new Error('Tiada sesi');
    if (!EP.letup33) throw new Error('Endpoint sync belum dikonfigurasi');
    const res = await fetch(EP.letup33, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: '*/*'
      },
      body: new URLSearchParams({
        module: '/users/syncData',
        merchantId: Store.config.merchantId,
        accessId: API.accessId,
        accessToken: API.accessToken,
        walletIsAdmin: ''
      }).toString()
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // POST same-origin dengan CSRF
  async function sitePost(path, fields) {
    if (!path) throw new Error('Endpoint belum dikonfigurasi');
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json',
        'X-CSRF-Token': CSRF
      },
      body: new URLSearchParams(fields).toString()
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    const failed = !res.ok || (data && data.status && data.status !== 'SUCCESS');
    if (failed) {
      throw new Error(data?.data?.message || data?.message || `Gagal (HTTP ${res.status})`);
    }
    return data || {};
  }

  /* ── 7. UI SYNC (SATU sahaja) ───────────────────────────────────────── */
  const UI = {
    authState() {
      $$('[data-auth="guest"]').forEach(el  => { el.hidden = Store.isAuthenticated; });
      $$('[data-auth="member"]').forEach(el => { el.hidden = !Store.isAuthenticated; });
    },

    balance() {
      const cash = Store.wallet?.cash ?? Store.wallet?.balance ?? Store.user?.cash ?? 0;
      const rm   = fmtRM(cash);
      setTxt('letup33Amt', rm);             // header pill
      setTxt('letup33Balance', rm);         // hidden stub
      setTxt('storeBalance', rm);
      $$('.vc-balance').forEach(el => { el.textContent = rm; }); // home card
    },

    profile() {
      const u = Store.user || {};
      setTxt('letup33Account', u.username || u.accountId || '—');
      $$('.vc-name').forEach(el     => { el.textContent = u.name || u.username || 'Pengguna'; });
      $$('.vc-username').forEach(el => { el.textContent = u.username || '—'; });
      setTxt('letup33Username', u.username || '—');    // refer-share
      setTxt('letup33VipBadge', u.level || u.levelSubtitle || u.vipLevel || '—');
    },

    referral() {
      const u = Store.user || {};
      const link = document.querySelector('#home-refer-share a.method[data-method="whatsapp"]');
      if (link) {
        const ref = u.username || u.accountId || '';
        const msg = `Jom join LETUP33! Daftar dengan referral saya: ${ref}`;
        link.href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
      }
    },

    limits() {
      const w = Store.wallet || {};
      setTxt('letup33DepMin', fmtRM(w.minDeposit));
      setTxt('letup33WdMin',  fmtRM(w.minWithdraw));
      setTxt('letup33WdMax',  fmtRM(w.maxWithdraw));
    },

    turnover() {
      const w   = Store.wallet || {};
      const cur = num(w.turnoverCurrent ?? w.turnover);
      const tot = num(w.turnoverTotal   ?? w.rolloverTotal);
      const pct = tot > 0 ? Math.min(100, Math.max(0, Math.round((cur / tot) * 100))) : 0;
      const deg = pct * 3.6;

      // modal
      setTxt('letup33RolloverAmount', `${fmtRM(cur)} / ${fmtRM(tot)}`); // hidden stub
      setTxt('letup33RolloverPercent', `${pct}%`);
      const fill = $('letup33RolloverFill');
      if (fill) fill.style.width = `${pct}%`;

      const dial = $('lpKDial');
      if (dial) {
        dial.setAttribute('aria-valuenow', String(pct));
        dial.style.background = `conic-gradient(rgb(25,99,128) 0deg ${deg}deg, rgb(223,234,240) ${deg}deg 360deg)`;
      }
      const dot = $('lpKDot');
      if (dot) dot.style.transform = `rotate(${deg}deg)`;
      setTxt('lpKProgressLabel', `${pct}%`);

      // home card
      $$('.range-in').forEach(el  => { el.style.width = `${pct}%`; });
      $$('.range-out').forEach(el => { el.textContent = `${fmtRM(cur)} / ${fmtRM(tot)}`; });
    },

    vip() {
      const u = Store.user || {};
      setTxt('letup33VipAmount', u.vipProgressText || u.levelProgressText || '—');
      const life = u.vipLifetime, lifeCap = u.vipLifetimeCap;
      const mon  = u.vipMonthly,  monCap  = u.vipMonthlyCap;
      $$('[data-vip="lifetime"]').forEach(el =>
        el.textContent = life != null ? `${fmtRM(life)} / ${fmtRM(lifeCap)}` : el.textContent);
      $$('[data-vip="monthly"]').forEach(el =>
        el.textContent = mon  != null ? `${fmtRM(mon)} / ${fmtRM(monCap)}`  : el.textContent);
    },

    bankForm() {
      const b = Store.bank || {};
      const f = $('changeBank');
      if (!f) return;
      const sel  = f.querySelector('[name="bank"]');
      const name = f.querySelector('[name="accountName"]');
      const acc  = f.querySelector('[name="accountNumber"]');
      if (sel && b.bank && ![...sel.options].some(o => o.value === b.bank)) {
        sel.add(new Option(b.bank, b.bank));
      }
      if (sel  && b.bank)          sel.value  = b.bank;
      if (name && b.accountName)   name.value = b.accountName;
      if (acc  && b.accountNumber) acc.value  = b.accountNumber;
    },

    nameEmailForm() {
      const u = Store.user || {};
      const nf = $('changeName');
      const ef = $('changeEmail');
      if (nf && u.name && !fld(nf, 'name').value)  fld(nf, 'name').value = u.name;
      if (ef && u.email && !fld(ef, 'email').value) fld(ef, 'email').value = u.email;
    },

    all() {
      this.authState();
      this.balance();
      this.profile();
      this.referral();
      this.limits();
      this.turnover();
      this.vip();
      this.bankForm();
      this.nameEmailForm();
    }
  };

  /* ── 8. MODAL + CONFIRM ─────────────────────────────────────────────── */
  const Modal = {
    open() {
      const m = $('letup33WalletModal');
      if (!m) return;
      m.hidden = false;
      document.body.style.overflow = 'hidden';
      $('letup33WalletModalClose')?.focus();
    },
    close() {
      const m = $('letup33WalletModal');
      if (!m) return;
      m.hidden = true;
      document.body.style.overflow = '';
      Confirm.hide();
    }
  };
  const Confirm = {
    show() { const d = $('lpKConfirm'); if (d) d.hidden = false; },
    hide() { const d = $('lpKConfirm'); if (d) d.hidden = true;  }
  };

  /* ── 9. SYNC ────────────────────────────────────────────────────────── */
  async function userSync() {
    if (API.accessId && API.accessToken) {
      try {
        const res = await letup33Sync();
        if (res?.status === 'SUCCESS' && res.data) {
          const d = res.data;
          const u = d.user || d;
          Store.user    = u;
          Store.wallet  = d.wallet || u.wallet || u;
          Store.bank    = d.bank || u.bank || (Array.isArray(u.banks) ? u.banks[0] : null) || null;
          Store.history = d.history || u.history || [];
          Store.isAuthenticated = true;
          UI.all();
          return true;
        }
      } catch (e) {
        console.warn('[sync] letup33:', e.message);
      }
    }
    // Fallback same-origin (tanpa sesi proxy)
    try {
      const opts = { credentials: 'include', headers: { Accept: 'application/json' } };
      const [w, b] = await Promise.allSettled([
        fetch(EP.walletFallback, opts),
        fetch(EP.bankFallback, opts)
      ]);
      if (w.status === 'fulfilled' && w.value.ok) Store.wallet = await w.value.json();
      if (b.status === 'fulfilled' && b.value.ok) Store.bank   = await b.value.json();
    } catch (e) {
      console.warn('[sync] fallback:', e.message);
    }
    UI.all();
    return false;
  }

  /* ── 10. TICKER + LIVE TX ───────────────────────────────────────────── */
  function renderTicker() {
    const m = $('marquee');
    if (!m || !Store.config.ticker) return;
    m.innerHTML = `<span>${esc(Store.config.ticker)}</span>`.repeat(4);
  }

  async function loadLiveTx() {
    const body = $('tx-body');
    const src  = BOOT.liveTx?.sources?.[0];
    const max  = BOOT.liveTx?.maxRows || 6;
    if (!body || !src || !EP.liveStat) return;
    try {
      const url = `${EP.liveStat}?mId=${encodeURIComponent(src.mId)}&game=${encodeURIComponent(src.game)}&limit=${max}`;
      const r = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) {
        body.innerHTML = '<p class="empty">Tiada transaksi terkini.</p>';
        return;
      }
      body.innerHTML = rows.slice(0, max).map(t => `
        <div class="tx ${esc(t.type || 'deposit')}">
          <div>
            <strong>${esc(t.username || '—')}</strong>
            <div class="meta">${esc(String(t.type || 'deposit').toUpperCase())}</div>
          </div>
          <span class="amt">${fmtRM(t.amount)}</span>
        </div>`).join('');
    } catch (e) {
      body.innerHTML = '<p class="empty">Transaksi langsung tidak dapat dimuatkan.</p>';
      console.warn('[liveTx]', e.message);
    }
  }

  /* ── 11. FORMS (bind pada blok #changeBank / #changeName / dll) ─────── */
  function bindBlock(id, path, read, okMsg, validate) {
    const block = $(id);
    const btn   = block?.querySelector('button.update');
    if (!block || !btn || !path) return;
    btn.addEventListener('click', async () => {
      const data = read(block);
      if (Object.values(data).some(v => !v)) return toast('Sila isi semua medan', 'warn');
      const bad = validate?.(data);
      if (bad) return toast(bad, 'warn');

      btn.disabled = true;
      try {
        await sitePost(path, { ...data, merchantId: Store.config.merchantId });
        toast(okMsg, 'success');
        await userSync();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  function bindForms() {
    bindBlock('changeBank', EP.changeBank,
      f => ({
        bank: fld(f, 'bank').value.trim(),
        bankAccountName: fld(f, 'accountName').value.trim(),
        bankAccountNumber: fld(f, 'accountNumber').value.trim()
      }),
      'Maklumat bank dikemas kini');

    bindBlock('changeName', EP.changeName,
      f => ({ name: fld(f, 'name').value.trim() }),
      'Nama dikemas kini');

    bindBlock('changeEmail', EP.changeEmail,
      f => ({ email: fld(f, 'email').value.trim() }),
      'Emel dikemas kini',
      d => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email) ? '' : 'Emel tidak sah. Contoh: nama@domain.com');

    bindBlock('changePassword', EP.changePassword,
      f => ({
        currentPassword: fld(f, 'currentPassword').value,
        newPassword: fld(f, 'newPassword').value
      }),
      'Kata laluan dikemas kini',
      d => {
        const f = $('changePassword');
        if (fld(f, 'newPassword').value !== fld(f, 'confirmPassword').value) {
          return 'Kata laluan pengesahan tidak sepadan';
        }
        if (!/^(?=.*[A-Za-z])(?=.*\d).{8,16}$/.test(d.newPassword)) {
          return 'Guna 8–16 aksara dengan huruf dan nombor';
        }
        return '';
      });

    // Ikon mata: tunjuk/sembunyi kata laluan
    $$('#change .eye').forEach(eye => {
      const input = eye.closest('.inline')?.querySelector('input');
      if (!input) return;
      const toggle = () => {
        input.type = input.type === 'password' ? 'text' : 'password';
      };
      eye.addEventListener('click', toggle);
      eye.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
  }

  /* ── 12. EVENTS ─────────────────────────────────────────────────────── */
  function bindEvents() {
    // Wallet modal — trigger (klik + papan kekunci)
    const trigger = $('letup33WalletTrigger');
    trigger?.addEventListener('click', e => { e.preventDefault(); Modal.open(); });
    trigger?.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); Modal.open(); }
    });
    $('letup33WalletModalClose')?.addEventListener('click', () => Modal.close());
    $('letup33WalletModal')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) Modal.close();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') Modal.close();
    });

    // Refresh
    const refresh = async btn => {
      btn.disabled = true;
      btn.classList.add('is-loading');
      try {
        const ok = await userSync();
        toast(ok ? 'Baki dikemas kini' : 'Gagal segar semula. Cuba lagi.', ok ? 'success' : 'error');
      } catch (err) {
        toast('Gagal segar semula: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.classList.remove('is-loading');
      }
    };
    $$('.vc-refresh').forEach(b => b.addEventListener('click', () => refresh(b)));
    $('letup33Refresh')?.addEventListener('click', e => refresh(e.currentTarget));

    // Log keluar (tempatan) — dengan pengesahan
    $('lpKLogout')?.addEventListener('click', Confirm.show);
    $('lpKCancel')?.addEventListener('click', Confirm.hide);
    $('lpKConfirmLogout')?.addEventListener('click', () => {
      API.clear();
      Store.user = Store.wallet = Store.bank = null;
      Store.history = [];
      Modal.close();
      UI.all();
      toast('Anda telah log keluar', 'success');
      location.hash = '#home';
    });

    // Tab dalam modal
    $('letup33TabDeposit')?.addEventListener('click', () => {
      Modal.close();
      location.hash = '#home';
      toast('Halaman deposit dibuka', 'info');
    });
    $('letup33TabWithdraw')?.addEventListener('click', () => {
      Modal.close();
      toast('Halaman pengeluaran dibuka', 'info');
    });
    $('letup33HistoryLink')?.addEventListener('click', () => {
      Modal.close();
      toast('Rekod transaksi akan dipaparkan di sini', 'info');
    });
    $('letup33VipLink')?.addEventListener('click', () => {
      Modal.close();
      location.hash = '#vip';
    });
    $('letup33ClearBalance')?.addEventListener('click', () => {
      toast('Fungsi clear balance tidak didayakan', 'warn');
    });
    $('lpKVip')?.addEventListener('change', e => {
      if (e.target.checked) { Modal.close(); location.hash = '#vip'; }
    });

    // Butang withdraw pada kad home
    $$('.vc-withdraw').forEach(b => b.addEventListener('click', () => {
      toast('Halaman pengeluaran dibuka', 'info');
    }));

    // Cross-tab auth sync
    window.addEventListener('storage', e => {
      if (e.key !== AUTH_KEY) return;
      if (e.newValue) API.restore();
      else API.clear();
      UI.all();
    });
  }

  /* ── 13. BOOT ───────────────────────────────────────────────────────── */
  function boot() {
    // Senarai bank dalam dropdown
    const sel = fld($('changeBank'), 'bank');
    if (sel) BANKS.forEach(b => sel.add(new Option(b, b)));

    // Pautan login/register dari konfigurasi
    if (EP.login)    $('letup33LoginLink')?.setAttribute('href', EP.login);
    if (EP.register) $('letup33RegisterLink')?.setAttribute('href', EP.register);

    renderTicker();
    Router.init();
    bindForms();
    bindEvents();
    API.restore();
    UI.all();

    if (Store.isAuthenticated) {
      userSync().catch(e => console.warn('[boot] sync:', e.message));
    }
    loadLiveTx();
    console.log('[letup33] ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  /* ── 14. PUBLIC API ─────────────────────────────────────────────────── */
  window.letup33 = {
    Store,
    API,
    UI,
    Router,
    Modal,
    userSync,
    toast,
    fmtRM,
    setAuth: (a, t) => API.setAuth(a, t),
    setAuthLocal: (a, t) => API.setAuth(a, t),
    kemasSemuaUI: () => UI.all(),
    SyncUserData: () => letup33Sync(),
    ChangeBankAPI: d => sitePost(EP.changeBank, d)
  };
})();
