/* =========================================================
   MÀN HÌNH HIỂN THỊ TRUNG TÂM (TV SẢNH) – QMS ĐA ĐIỂM · Bản demo
   - Nhận lệnh gọi số (bản thật: sự kiện WebSocket từ Local Server)
   - Danh sách số vừa gọi cập nhật NGAY khi có lệnh gọi
   - Khung gọi số hiện lần lượt theo hàng đợi; thời lượng theo giọng đọc, tối đa 12 giây
   - Hai cách xử lý gọi dồn: (a) lần lượt, đọc 2 lần; (b) gộp tối đa 3 số, đọc 1 lần
   ========================================================= */
(() => {
  'use strict';

  /* ---------- Cấu hình hiển thị (bản thật lấy từ CMS theo mã TV) ---------- */
  const CFG = {
    site: 'HCM',
    popupMax: 12,          // giây, thời gian tối đa của khung gọi 1 số
    mergeMax: 15,          // giây, thời gian tối đa của khung gọi gộp
    repeat: 2,             // số lần đọc mỗi số (theo đặc tả)
    listSize: 6,           // 1 số mới nhất + 5 số trước đó
    cardsPerPage: 4,
    pageSec: 8,
    slideSec: 11,
    marqueeSpeed: 100,     // px/giây trên canvas 1920
    videos: [],            // ví dụ: ['media/huong-dan-dat-lich.mp4', 'media/tin-tuc.mp4']
    marquee: [
      'Trung tâm làm việc từ thứ Hai đến thứ Sáu: sáng 07:30–11:30, chiều 13:30–16:30',
      'Đặt lịch trước qua ứng dụng di động để được ưu tiên phục vụ',
      'Người cao tuổi, phụ nữ mang thai, người khuyết tật vui lòng liên hệ bàn lễ tân để được hỗ trợ',
      'Vui lòng giữ phiếu số thứ tự cho đến khi hoàn tất thủ tục'
    ],
    urgent: 'THÔNG BÁO: Hệ thống điện sẽ được kiểm tra lúc 11:00. Quý công dân vui lòng giữ phiếu và theo dõi loa thông báo'
  };

  /* ---------- Danh mục dịch vụ (theo bảng danh mục trong đặc tả) ---------- */
  const SERVICES = [
    { code: 'A', short: 'Đất đai · Cấp mới, cấp đổi', counters: ['01', '02', '03'], sla: 20, issued: 67, called: 44, booked: 0 },
    { code: 'B', short: 'Đất đai · Giao dịch bảo đảm', counters: ['04', '05'], sla: 10, issued: 31, called: 26, booked: 0 },
    { code: 'C', short: 'Tư pháp · Quốc tịch, hộ tịch', counters: ['06', '07'], sla: 15, issued: 48, called: 41, booked: 0 },
    { code: 'D', short: 'Tư pháp · Công chứng', counters: ['08'], sla: 10, issued: 40, called: 37, booked: 0 },
    { code: 'F', short: 'Vận tải, phù hiệu xe', counters: ['11'], sla: 15, issued: 12, called: 9, booked: 0 },
    { code: 'G', short: 'BHXH, BHYT', counters: ['12', '13'], sla: 15, issued: 40, called: 31, booked: 0 },
    { code: 'K', short: 'Trả kết quả chung', counters: ['18', '19', '20'], sla: 2, issued: 55, called: 53, booked: 0 }
  ];
  const PRI = { code: 'V', issued: 5, called: 3 };
  const ALL_COUNTERS = SERVICES.flatMap((s) => s.counters).sort();

  /* ---------- Trạng thái ---------- */
  const st = { lunch: false, closed: false, offline: false, urgent: false, evac: false, offlineSince: 0, lastSync: new Date() };
  let recent = [
    { num: 'A-0044', counter: '02' },
    { num: 'K-0053', counter: '19' },
    { num: 'C-0041', counter: '07' },
    { num: 'V-0003', counter: '12', tag: 'priority' },
    { num: 'B-0026', counter: '05' },
    { num: 'G-0031', counter: '13' }
  ];
  const queue = [];
  let showing = false;

  /* ---------- Tiện ích ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(4, '0');
  const fmt = (code, n) => `${code}-${pad(n)}`;
  const svg = (id) => `<svg class="ic"><use href="#${id}"/></svg>`;
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const hhmm = (d) => d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const waitingOf = (s) => s.issued - s.called - s.booked;
  const etaOf = (s) => { const w = waitingOf(s); return w <= 0 ? 0 : Math.max(5, Math.round((w * s.sla) / s.counters.length / 5) * 5); };
  const levelOf = (eta) => (eta < 15 ? 'low' : eta <= 35 ? 'mid' : 'high');
  const serviceOf = (counter) => SERVICES.find((s) => s.counters.includes(counter));

  /* ---------- Co giãn canvas 1920 × 1080 ---------- */
  const params = new URLSearchParams(location.search);
  const isTV = params.get('tv') === '1';
  if (isTV) document.body.classList.add('is-tv');
  function fit() {
    const panel = isTV ? 0 : $('#sim').offsetWidth + 24;
    const gap = isTV ? 0 : 60;
    const s = Math.min((innerWidth - panel - gap) / 1920, (innerHeight - gap) / 1080);
    const f = $('#frame');
    f.style.width = 1920 * s + 'px';
    f.style.height = 1080 * s + 'px';
    $('#tv').style.transform = `scale(${s})`;
  }
  addEventListener('resize', fit);

  /* ---------- Đồng hồ ---------- */
  function tick() {
    const d = new Date();
    $('#clockTime').textContent = hhmm(d);
    $('#clockDate').textContent = d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    if (st.offline) renderConn();
  }

  /* =========================================================
     VIDEO / SLIDE MINH HỌA
     ========================================================= */
  const SLIDES = [
    { ic: 'i-phone', k: 'Đặt lịch trước', t: 'Đặt lịch qua ứng dụng, đến đúng giờ, không phải chờ lâu', b: ['Chọn Trung tâm, thủ tục và khung giờ', 'Nhận mã QR trên điện thoại', 'Quét mã tại Kiosk để nhận số ưu tiên'], bg: 'linear-gradient(135deg,#0A5BC9,#0047AB 50%,#002A66)' },
    { ic: 'i-file', k: 'Hồ sơ đất đai', t: 'Chuẩn bị hồ sơ cấp đổi giấy chứng nhận', b: ['Đơn đề nghị theo mẫu', 'Bản gốc giấy chứng nhận đã cấp', 'CCCD gắn chip của người đứng tên'], bg: 'linear-gradient(135deg,#1D9E75,#0F6E56 50%,#085041)' },
    { ic: 'i-qr', k: 'Thanh toán', t: 'Nộp phí, lệ phí không dùng tiền mặt', b: ['Chuyển khoản qua mã QR tại quầy', 'Thẻ ngân hàng hoặc ví điện tử', 'Nhận biên lai điện tử'], bg: 'linear-gradient(135deg,#534AB7,#3C3489 50%,#26215C)' },
    { ic: 'i-star', k: 'Ý kiến của bạn', t: 'Đánh giá mức độ hài lòng sau khi được phục vụ', b: ['Chạm biểu tượng cảm xúc trên máy tính bảng tại quầy', 'Góp ý giúp nâng cao chất lượng phục vụ'], bg: 'linear-gradient(135deg,#D85A30,#993C1D 50%,#712B13)' }
  ];
  let slideIdx = 0, slideT = 0, mediaPaused = false, videoEl = null;
  function buildSlides() {
    $('#slides').innerHTML = SLIDES.map((s) => `
      <div class="slide">
        <div class="slide-bg" style="background:${s.bg}"></div>
        <div class="slide-ic">${svg(s.ic)}</div>
        <div class="slide-txt"><small>${s.k}</small><h2>${s.t}</h2><ul>${s.b.map((x) => `<li>${x}</li>`).join('')}</ul></div>
      </div>`).join('');
    showSlide(0);
  }
  function showSlide(i) {
    $$('.slide').forEach((el, j) => el.classList.toggle('is-on', j === i));
    slideIdx = i; slideT = 0;
  }
  setInterval(() => {
    if (mediaPaused || videoEl) return;
    slideT += 0.1;
    $('#mediaBar').style.transform = `scaleX(${Math.min(1, slideT / CFG.slideSec)})`;
    if (slideT >= CFG.slideSec) showSlide((slideIdx + 1) % SLIDES.length);
  }, 100);

  /* Phát video thật nếu có cấu hình playlist; lỗi thì quay về slide minh họa */
  function initVideo() {
    if (!CFG.videos.length) return buildSlides();
    let vi = 0;
    videoEl = document.createElement('video');
    Object.assign(videoEl, { muted: true, playsInline: true, autoplay: true });
    videoEl.src = CFG.videos[0];
    videoEl.addEventListener('ended', () => { vi = (vi + 1) % CFG.videos.length; videoEl.src = CFG.videos[vi]; videoEl.play(); });
    videoEl.addEventListener('timeupdate', () => { $('#mediaBar').style.transform = `scaleX(${videoEl.currentTime / (videoEl.duration || 1)})`; });
    videoEl.addEventListener('error', () => { videoEl.remove(); videoEl = null; $('.media-chip').style.display = ''; buildSlides(); });
    $('#media').prepend(videoEl);
    $('.media-chip').style.display = 'none';
  }
  function pauseMedia(on) {
    mediaPaused = on;
    $('#media').classList.toggle('is-paused', on);
    if (videoEl) on ? videoEl.pause() : videoEl.play().catch(() => {});
  }

  /* =========================================================
     DẢI TÌNH HÌNH HÀNG ĐỢI
     ========================================================= */
  let page = 0, pageT = 0;
  const prevVals = {};
  /* Thẻ thứ 8 là nhóm ưu tiên để 2 trang luôn đủ 4 thẻ */
  const cardItems = () => [...SERVICES, { code: 'V', short: 'Đối tượng ưu tiên', pri: true, issued: PRI.issued, called: PRI.called, booked: 0, sla: 0, counters: ['*'] }];
  const pages = () => Math.ceil(cardItems().length / CFG.cardsPerPage);
  function renderCards(animate) {
    const list = cardItems().slice(page * CFG.cardsPerPage, (page + 1) * CFG.cardsPerPage);
    const box = $('#cards');
    box.innerHTML = list.map((s, i) => {
      const w = waitingOf(s), eta = etaOf(s), lv = levelOf(eta);
      const cur = s.called > 0 ? fmt(s.code, s.called) : '—';
      const key = s.code;
      const bumpN = prevVals[key] && prevVals[key].cur !== cur ? 'bump' : '';
      const bumpW = prevVals[key] && prevVals[key].w !== w ? 'bump' : '';
      prevVals[key] = { cur, w };
      const etaTxt = s.pri ? 'Theo quầy' : eta ? '~' + eta + ' phút' : 'Không chờ';
      return `<div class="qcard ${s.pri ? 'is-pri' : ''}" style="--i:${i}">
        <div class="qc-top"><span class="qc-code">${s.code}</span><span class="qc-name">${s.short}</span></div>
        <div class="qc-mid"><span>ĐANG GỌI ĐẾN</span><b class="${bumpN}">${cur}</b></div>
        <div class="qc-bot"><span class="lv-${w && !s.pri ? lv : 'low'} ${bumpW}">${svg('i-users')} ${w} chờ</span><span class="qc-eta">${svg('i-clock')} ${etaTxt}</span></div>
      </div>`;
    }).join('');
    box.classList.remove('is-in');
    if (animate) { void box.offsetWidth; box.classList.add('is-in'); }
    $('#dots').innerHTML = Array.from({ length: pages() }, (_, i) => `<i class="${i === page ? 'on' : ''}"></i>`).join('');
    const total = SERVICES.reduce((a, s) => a + waitingOf(s), 0) + (PRI.issued - PRI.called);
    $('#totalNum').textContent = total;
  }
  setInterval(() => {
    if (mediaPaused) return;
    pageT += 1;
    if (pageT >= CFG.pageSec) { pageT = 0; page = (page + 1) % pages(); renderCards(true); }
  }, 1000);

  /* =========================================================
     DANH SÁCH SỐ VỪA GỌI
     ========================================================= */
  const TAGS = {
    priority: (c, big) => `<span class="tag tag-priority">${big ? svg('i-star') : ''}ƯU TIÊN</span>`,
    booking: (c, big) => `<span class="tag tag-booking">${big ? svg('i-phone') + 'ĐẶT LỊCH TRƯỚC' : 'ĐẶT LỊCH'}</span>`,
    recall: (c, big) => `<span class="tag tag-recall">GỌI LẠI</span>`,
    transfer: (c, big) => `<span class="tag tag-transfer">${big ? 'CHUYỂN TỪ QUẦY ' + c.from : 'CHUYỂN QUẦY'}</span>`
  };
  const tagOf = (c, big) => (c.tag ? TAGS[c.tag](c, big) : '');

  function renderBoard(animate) {
    const body = $('#boardBody');
    if (!recent.length) {
      body.innerHTML = `<div class="empty">${svg('i-ticket')}<b>Chưa có số được gọi</b><span>Mời Quý công dân lấy số tại Kiosk và theo dõi màn hình này.</span></div>`;
      return;
    }
    const [top, ...rest] = recent;
    body.innerHTML =
      `<div class="r r-top ${animate ? 'is-new' : ''}"><span class="cap">VỪA GỌI</span>
         <span class="n">${top.num}</span>
         ${top.tag ? `<span style="position:absolute;top:14px;right:40px">${tagOf(top)}</span>` : ''}
         <span class="c">${top.counter}</span></div>` +
      rest.map((c) => `<div class="r r-row"><span class="n">${c.num}</span>${tagOf(c)}<span class="c">${c.counter}</span></div>`).join('');
    body.classList.remove('is-shift');
    if (animate) { void body.offsetWidth; body.classList.add('is-shift'); }
  }

  /* =========================================================
     GỌI SỐ
     ========================================================= */
  function addCall(c) {
    if (st.offline) return toast('TV đang mất kết nối nên không nhận được lệnh gọi. Loa và màn hình quầy vẫn hoạt động nếu nối với Local Server.');
    if (st.closed || st.lunch) return toast('Đang ngoài giờ phục vụ, không có lệnh gọi số.');
    c.time = new Date();
    recent = [c, ...recent.filter((r) => r.num !== c.num)].slice(0, CFG.listSize);
    st.lastSync = new Date();
    renderBoard(true);
    renderCards(false);
    if (st.evac) return;
    queue.push(c);
    updateQ();
    if (showing) renderNext(); else pump();
  }

  async function pump() {
    if (showing || !queue.length) return;
    showing = true;
    await sleep(400);          // gom các lệnh gọi đến gần như cùng lúc (gọi dồn)
    pauseMedia(true);
    const call = $('#call');
    call.classList.add('is-on');
    let first = true;
    while (queue.length && !st.evac) {
      const merge = policy() === 'merge' && queue.length >= 2;
      const batch = merge ? queue.splice(0, 3) : [queue.shift()];
      updateQ();
      renderCall(batch, merge, first);
      first = false;
      const est = merge ? 1.5 + 4.2 * batch.length + 0.8 : 1.5 + 4.5 * CFG.repeat + 0.5;
      const cap = merge ? CFG.mergeMax : CFG.popupMax;
      runProgress(Math.min(est, cap));
      await announce(batch, merge ? 1 : CFG.repeat, cap, merge);
    }
    call.classList.remove('is-on');
    await sleep(350);
    showing = false;
    pauseMedia(false);
  }

  function renderCall(batch, merge, first) {
    const card = $('#callCard');
    if (!merge) {
      const c = batch[0];
      const tags = [c.tag && TAGS[c.tag](c, true)].filter(Boolean).join('');
      card.innerHTML = `
        <div class="cc-band">${svg('i-mega')}${c.tag === 'recall' ? 'MỜI LẠI CÔNG DÂN CÓ SỐ' : 'MỜI CÔNG DÂN CÓ SỐ'}</div>
        <div class="cc-main">
          <div class="cc-col"><span class="num cc-n cc-pulse">${c.num}</span><small>SỐ PHIẾU</small></div>
          <div class="cc-arr">${svg('i-arrow')}</div>
          <div class="cc-col"><span class="num cc-c">${c.counter}</span><small>ĐẾN QUẦY</small></div>
        </div>
        <div class="cc-tags">${tags}</div>
        <div class="cc-next" id="ccNext"></div>
        <div class="cc-prog"><i id="ccProg"></i></div>`;
    } else {
      card.innerHTML = `
        <div class="cc-band">${svg('i-mega')}MỜI CÁC SỐ SAU</div>
        <div class="cm-rows">${batch.map((c, i) => `
          <div class="cm-row" data-i="${i}">
            <span class="num n">${c.num}${c.tag ? tagOf(c) : ''}</span>
            <span class="a">${svg('i-arrow')}</span>
            <span class="c"><small>QUẦY</small><b class="num">${c.counter}</b></span>
          </div>`).join('')}</div>
        <div class="cc-next" id="ccNext"></div>
        <div class="cc-prog"><i id="ccProg"></i></div>`;
    }
    renderNext();
    if (!first) { card.classList.remove('is-swap'); void card.offsetWidth; card.classList.add('is-swap'); }
  }
  function renderNext() {
    const el = $('#ccNext');
    if (!el) return;
    if (!queue.length) { el.style.display = 'none'; return; }
    el.style.display = '';
    const n = queue[0];
    el.innerHTML = `Tiếp theo: <b>${n.num}</b> ${svg('i-arrow')} Quầy <b>${n.counter}</b>${queue.length > 1 ? ` <span style="opacity:.7">· và ${queue.length - 1} số khác</span>` : ''}`;
  }
  function runProgress(sec) {
    const p = $('#ccProg');
    p.style.transition = 'none'; p.style.transform = 'scaleX(1)';
    void p.offsetWidth;
    p.style.transition = `transform ${sec}s linear`; p.style.transform = 'scaleX(0)';
  }
  const highlight = (i) => $$('.cm-row').forEach((r) => r.classList.toggle('is-reading', +r.dataset.i === i));

  /* ---------- Âm thanh mô phỏng: ding-dong (WebAudio) + giọng đọc trình duyệt ---------- */
  let ac = null, viVoice = null;
  const LETTER = { A: 'a', B: 'bê', C: 'xê', D: 'đê', F: 'ép', G: 'giê', K: 'ca', V: 'vê' };
  const DIG = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  const spell = (s) => [...s].map((d) => DIG[+d]).join(', ');
  const sentence = (c) => `Mời số ${LETTER[c.num[0]] || c.num[0]}, ${spell(c.num.slice(2))}, đến quầy số ${spell(c.counter)}`;
  const soundOn = () => $('#sound').checked && ac;

  function tone(f, t, d) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + d + 0.05);
  }
  async function ding() { const t = ac.currentTime; tone(659.25, t, 0.9); tone(523.25, t + 0.55, 1.1); await sleep(1600); }
  function speak(text) {
    return new Promise((res) => {
      if (!('speechSynthesis' in window) || !viVoice) return res();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = viVoice; u.lang = viVoice.lang; u.rate = 0.9;
      const safety = setTimeout(res, 8000);
      u.onend = u.onerror = () => { clearTimeout(safety); res(); };
      speechSynthesis.speak(u);
    });
  }
  function loadVoices() {
    if (!('speechSynthesis' in window)) return;
    viVoice = speechSynthesis.getVoices().find((v) => /^vi/i.test(v.lang)) || null;
    $('#voiceNote').textContent = viVoice
      ? `Giọng đọc: ${viVoice.name}. Bản thật phát qua loa IP bằng TTS FPT/Viettel/Google.`
      : 'Trình duyệt chưa có giọng tiếng Việt, demo chỉ phát ding-dong. Bản thật phát qua loa IP bằng TTS FPT/Viettel/Google.';
  }
  if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

  async function announce(batch, times, cap, merge) {
    let timedOut = false;
    const run = (async () => {
      if (soundOn()) {
        await ding();
        for (let i = 0; i < batch.length && !timedOut; i++) {
          if (merge) highlight(i);
          for (let r = 0; r < times && !timedOut; r++) {
            if (viVoice) await speak(sentence(batch[i])); else await sleep(4200);
            await sleep(300);
          }
        }
        await sleep(700);
      } else {
        await sleep(1500);
        for (let i = 0; i < batch.length && !timedOut; i++) {
          if (merge) highlight(i);
          await sleep((merge ? 4200 : 4500) * times);
        }
        await sleep(merge ? 800 : 500);
      }
    })();
    await Promise.race([run, sleep(cap * 1000).then(() => { timedOut = true; })]);
    if (timedOut && 'speechSynthesis' in window) speechSynthesis.cancel();
  }

  /* =========================================================
     THAO TÁC MÔ PHỎNG CỦA CÁN BỘ
     ========================================================= */
  function callNext(counter) {
    const s = serviceOf(counter);
    if (!s) return;
    if (waitingOf(s) <= 0) return toast(`Quầy ${counter}: không còn số chờ (${s.short}).`);
    s.called++;
    addCall({ num: fmt(s.code, s.called), counter });
  }
  function callRandom() {
    const ok = ALL_COUNTERS.filter((c) => waitingOf(serviceOf(c)) > 0);
    if (ok.length) callNext(pick(ok));
  }
  function callBurst() {
    const svcs = SERVICES.filter((s) => waitingOf(s) > 0).sort(() => Math.random() - 0.5).slice(0, 3);
    svcs.forEach((s, i) => setTimeout(() => callNext(pick(s.counters)), i * 120));
  }
  function recall() {
    if (!recent.length) return toast('Chưa có số nào để gọi lại.');
    addCall({ ...recent[0], tag: 'recall' });
  }
  function callPriority() {
    if (PRI.called >= PRI.issued) PRI.issued++;
    PRI.called++;
    addCall({ num: fmt(PRI.code, PRI.called), counter: pick(ALL_COUNTERS), tag: 'priority' });
  }
  function callBooking() {
    const s = SERVICES[0];
    s.issued++; s.booked++;
    addCall({ num: fmt(s.code, s.issued), counter: pick(s.counters), tag: 'booking' });
  }
  function transfer() {
    const s = SERVICES[0];
    addCall({ num: fmt(s.code, Math.max(1, s.called - 1)), counter: '15', tag: 'transfer', from: '03' });
  }

  /* Giả lập Kiosk tiếp tục cấp số */
  setInterval(() => { const s = pick(SERVICES); s.issued++; renderCards(false); }, 7000);

  /* Tự động gọi số */
  let autoT;
  function scheduleAuto() {
    clearTimeout(autoT);
    if (!$('#autoCall').checked) return;
    autoT = setTimeout(() => { callRandom(); scheduleAuto(); }, 15000 + Math.random() * 10000);
  }

  const policy = () => ($('input[name="policy"]:checked') || {}).value || 'seq';
  const updateQ = () => { $('#qCount').textContent = queue.length; };

  /* =========================================================
     TRẠNG THÁI HỆ THỐNG
     ========================================================= */
  function applyState() {
    const board = $('#board');
    const alt = st.closed || st.lunch;
    board.classList.toggle('has-state', alt);
    if (st.closed) {
      $('#bsIc').innerHTML = svg('i-moon');
      $('#bsTitle').textContent = 'NGOÀI GIỜ LÀM VIỆC';
      $('#bsText').innerHTML = 'Trung tâm tạm ngưng tiếp nhận. Quý công dân có thể đặt lịch trước qua ứng dụng di động.';
      $('#bsHours').style.display = '';
    } else if (st.lunch) {
      $('#bsIc').innerHTML = svg('i-coffee');
      $('#bsTitle').textContent = 'NGHỈ TRƯA';
      $('#bsText').innerHTML = 'Trung tâm tiếp tục phục vụ lúc <b>13:30</b>. Quý công dân vui lòng giữ phiếu, số thứ tự vẫn được giữ nguyên.';
      $('#bsHours').style.display = 'none';
    }
    board.classList.toggle('is-offline', st.offline);
    if (st.offline) renderConn();
    $('#strip').style.filter = st.offline ? 'grayscale(1)' : '';
    $('#strip').style.opacity = st.offline ? '.5' : '';

    if ($('#ftr').classList.contains('is-urgent') !== st.urgent) {
      $('#ftr').classList.toggle('is-urgent', st.urgent);
      $('#ftrLabel').textContent = st.urgent ? 'KHẨN' : 'THÔNG BÁO';
      setMarquee();
    }

    $('#evac').classList.toggle('is-on', st.evac);
    if (st.evac) { queue.length = 0; updateQ(); }
  }
  function renderConn() {
    const s = Math.floor((Date.now() - st.offlineSince) / 1000);
    let txt = `Mất kết nối ${s} giây · dữ liệu cập nhật lúc ${hhmm(st.lastSync)}`;
    if (s >= 60) txt += ' · Vui lòng theo dõi màn hình tại quầy và loa thông báo';
    $('#connText').textContent = txt;
  }
  setInterval(() => { if (st.offline) renderConn(); }, 1000);

  /* ---------- Chữ chạy: tốc độ cố định 100 px/giây ---------- */
  function setMarquee() {
    const el = $('#ftrText');
    el.innerHTML = st.urgent ? CFG.urgent : CFG.marquee.join('<em>●</em>');
    const trackW = $('.ftr-track').offsetWidth || 1620;
    const textW = el.scrollWidth;
    el.style.setProperty('--from', trackW + 'px');
    el.style.setProperty('--to', -textW + 'px');
    el.style.setProperty('--dur', (trackW + textW) / CFG.marqueeSpeed + 's');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  }

  /* =========================================================
     BẢNG MÔ PHỎNG
     ========================================================= */
  let toastT;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.classList.add('is-on');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('is-on'), 3500);
  }
  $('#counterSel').innerHTML = ALL_COUNTERS.map((c) => `<option value="${c}">Quầy ${c}</option>`).join('');
  $('#sim').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sim]');
    if (!b) return;
    const k = b.dataset.sim;
    if (k === 'next') callNext($('#counterSel').value);
    if (k === 'random') callRandom();
    if (k === 'burst') callBurst();
    if (k === 'recall') recall();
    if (k === 'priority') callPriority();
    if (k === 'booking') callBooking();
    if (k === 'transfer') transfer();
    if (k === 'dayStart') { recent = []; renderBoard(false); toast('Danh sách số vừa gọi đã được xóa (đầu ngày).'); }
  });
  $('#sim').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.state) {
      st[t.dataset.state] = t.checked;
      if (t.dataset.state === 'offline' && t.checked) st.offlineSince = Date.now();
      applyState();
    }
    if (t.id === 'autoCall') scheduleAuto();
    if (t.id === 'sound' && t.checked) {
      try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch (err) { ac = null; }
      loadVoices();
    }
  });

  /* Phím tắt khi trình chiếu: Space gọi ngẫu nhiên · B gọi dồn · R gọi lại */
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); callRandom(); }
    if (e.key === 'b' || e.key === 'B') callBurst();
    if (e.key === 'r' || e.key === 'R') recall();
  });

  /* ---------- Khởi động ---------- */
  fit(); tick(); setInterval(tick, 1000);
  initVideo();
  renderCards(true);
  renderBoard(false);
  setMarquee();
  if (isTV && params.get('auto') !== '0') { $('#autoCall').checked = true; scheduleAuto(); }
  if (document.fonts) document.fonts.ready.then(() => { fit(); setMarquee(); });
})();
