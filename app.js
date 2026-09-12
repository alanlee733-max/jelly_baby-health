/* app.js — 저장 · 화면 전환 · 홈 · 오늘
 *
 * 이 파일에는 판정 기준이 없습니다. 기준은 criteria.json 에서 읽고,
 * 판정은 evaluate.js 에 맡깁니다. 여기는 "읽고 · 그리고 · 저장"만 합니다.
 *
 * 저장 위치 (localStorage)
 *   nt:baby              아기 정보 1건
 *   nt:log:YYYY-MM-DD    하루 기록 1건
 * 판정 결과는 저장하지 않습니다. 화면을 그릴 때마다 다시 계산합니다.
 */

(function () {
  'use strict';

  var KEY_BABY = 'nt:baby';
  var KEY_LOG = 'nt:log:';

  var state = {
    criteria: null,
    baby: null,
    date: todayStr(),   // '오늘' 화면이 보고 있는 날짜
    dirty: false        // 저장하지 않은 입력이 있는지
  };

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  /* ── 날짜 도우미 ─────────────────────────────────────────
     화면에는 사용자의 지역 날짜를 쓰고, 저장 키는 'YYYY-MM-DD' 문자열입니다. */
  function todayStr() {
    var d = new Date();
    return [d.getFullYear(),
            String(d.getMonth() + 1).padStart(2, '0'),
            String(d.getDate()).padStart(2, '0')].join('-');
  }

  function shiftDate(dateStr, days) {
    var p = dateStr.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + days);
    return [d.getFullYear(),
            String(d.getMonth() + 1).padStart(2, '0'),
            String(d.getDate()).padStart(2, '0')].join('-');
  }

  var WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  function prettyDate(dateStr) {
    var p = dateStr.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return (+p[1]) + '월 ' + (+p[2]) + '일 (' + WEEK[d.getDay()] + ')';
  }

  /* ── 저장소 ──────────────────────────────────────────────
     사파리 시크릿 모드 등에서 localStorage 가 막힐 수 있어 전부 감쌉니다. */
  function lsGet(key) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
    catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { alert('저장하지 못했습니다. 브라우저의 저장 공간이 막혀 있을 수 있습니다.'); return false; }
  }
  function lsDel(key) { try { localStorage.removeItem(key); } catch (e) {} }

  function loadLog(date) { return lsGet(KEY_LOG + date); }
  function saveLog(log) { return lsSet(KEY_LOG + log.date, log); }

  function allLogs() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(KEY_LOG) === 0) {
          var v = lsGet(k);
          if (v && v.date) out.push(v);
        }
      }
    } catch (e) {}
    out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return out;
  }

  /* ── 부팅 ────────────────────────────────────────────────
     criteria.json 을 먼저 읽습니다. 이게 없으면 앱이 할 수 있는 일이 없습니다. */
  function boot() {
    fetch('criteria.json', { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (criteria) {
        state.criteria = criteria;
        state.baby = lsGet(KEY_BABY);
        buildFromCriteria();
        wire();
        $('#boot').hidden = true;
        $('#app').hidden = false;
        $('#nav').hidden = false;
        go(state.baby ? 'home' : 'setup');
        registerSW();
      })
      .catch(function (err) {
        var boot = $('#boot');
        boot.className = 'boot error';
        boot.innerHTML =
          '<div><p><b>기준 파일(criteria.json)을 읽지 못했습니다.</b></p>' +
          '<p>index.html 파일을 더블클릭해서 연 경우에 생기는 문제입니다.<br>' +
          '작은 웹서버로 열거나 GitHub Pages 주소로 접속해 주세요.<br>' +
          'README.md 의 "실행 방법"에 두 줄 명령이 적혀 있습니다.</p>' +
          '<p class="meta">' + String(err.message || err) + '</p></div>';
      });
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    // 오프라인일 때는 등록(=갱신 확인)을 건너뜁니다. 이미 설치된 서비스워커는 그대로 동작하고,
    // 어차피 실패할 요청 때문에 비행기모드에서 시스템 알림이 뜨는 것을 막습니다.
    if (navigator.onLine === false) return;
    navigator.serviceWorker.register('sw.js').catch(function () { /* 없어도 앱은 동작합니다 */ });
  }

  /* ── criteria.json 으로 화면 만들기 ─────────────────────
     칩·체크박스 목록을 여기서 만듭니다. HTML 에는 선택지가 하나도 없습니다.
     기준 파일에 색을 하나 추가하면 화면에도 그대로 하나 늘어납니다. */
  function buildFromCriteria() {
    var c = state.criteria.categories;

    chipsFromLevels($('#chips-stoolColor'), (c.stool || {}).colors);
    chipsFromLevels($('#chips-stoolTexture'), (c.stool || {}).textures);
    chipsFromLevels($('#chips-jaundice'), (c.jaundice || {}).levels);
    chipsFromLevels($('#chips-alertness'), (c.alertness || {}).levels);

    if (c.jaundice) $('#hint-jaundice').textContent = c.jaundice.reference || '';

    // 즉시 상담 신호 체크박스
    var rf = state.criteria.generalRedFlags || {};
    $('#symptoms-title').firstChild.nodeValue = (rf.label || '즉시 상담이 필요한 신호') + ' ';
    $('#symptoms-note').textContent = rf.note || '';
    var box = $('#checks-symptoms');
    box.innerHTML = '';
    (rf.items || []).forEach(function (item) {
      var lab = document.createElement('label');
      lab.className = 'check';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = item.id;
      cb.dataset.symptom = '1';
      var sp = document.createElement('span');
      sp.textContent = item.label;
      lab.appendChild(cb);
      lab.appendChild(sp);
      box.appendChild(lab);
    });

    // 홈·근거 화면의 고정 문구
    $('#home-disclaimer-text').textContent = state.criteria.disclaimer || '';
    $('#basis-disclaimer').textContent = state.criteria.disclaimer || '';
    $('#basis-purpose').textContent = state.criteria.purpose || '';
    var ver = '기준 버전 ' + (state.criteria.version || '—') +
              ' · 검토일 ' + (state.criteria.lastReviewed || '—');
    $('#home-criteria-version').textContent = ver;
    $('#basis-version').textContent = ver;

    renderBasis();
  }

  // { id: {label, flag} } 형태를 칩 버튼들로 바꿉니다.
  function chipsFromLevels(container, levels) {
    if (!container) return;
    container.innerHTML = '';
    Object.keys(levels || {}).forEach(function (id) {
      var def = levels[id];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.value = id;
      if (def.flag) b.dataset.flag = def.flag;   // 선택했을 때 노랑/빨강으로 보이게
      b.textContent = def.label || id;
      b.setAttribute('role', container.dataset.mode === 'multi' ? 'checkbox' : 'radio');
      b.setAttribute('aria-checked', 'false');
      container.appendChild(b);
    });
  }

  /* ── 칩 선택 도우미 ──────────────────────────────────── */
  function chipValue(container) {              // 단일 선택
    var on = container.querySelector('.chip.on');
    return on ? on.dataset.value : null;
  }
  function chipValues(container) {             // 다중 선택
    return $$('#' + container.id + ' .chip.on').map(function (b) { return b.dataset.value; });
  }
  function setChip(container, value) {
    $$('#' + container.id + ' .chip').forEach(function (b) {
      var on = Array.isArray(value) ? value.indexOf(b.dataset.value) >= 0 : b.dataset.value === value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function onChipClick(e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    var box = chip.parentElement;
    if (box.dataset.mode === 'multi') {
      var on = !chip.classList.contains('on');
      chip.classList.toggle('on', on);
      chip.setAttribute('aria-checked', on ? 'true' : 'false');
    } else {
      var already = chip.classList.contains('on');
      $$('#' + box.id + ' .chip').forEach(function (b) {
        b.classList.remove('on'); b.setAttribute('aria-checked', 'false');
      });
      if (!already) {                          // 같은 칩을 다시 누르면 선택 해제
        chip.classList.add('on');
        chip.setAttribute('aria-checked', 'true');
      }
    }
    // 설정 화면의 칩은 '오늘' 기록과 무관하므로 저장 대상으로 표시하지 않습니다.
    if (chip.closest('#form-log')) touched();
  }

  /* ── 화면 전환 ──────────────────────────────────────── */
  function go(screen) {
    // 다른 화면으로 넘어가기 전에, 입력하다 만 내용을 조용히 저장합니다.
    // 새벽에 저장 버튼을 깜빡해도 기록이 날아가지 않도록.
    if (document.body.dataset.screen === 'today' && screen !== 'today') flush();

    document.body.dataset.screen = screen;
    $$('.nav-btn').forEach(function (b) {
      b.setAttribute('aria-current', b.dataset.screen === screen ? 'page' : 'false');
    });
    window.scrollTo(0, 0);

    if (screen === 'home') renderHome();
    if (screen === 'today') renderToday();
    if (screen === 'trend') renderTrend();
    if (screen === 'setup') fillBabyForm();
  }

  function touched() { state.dirty = true; updateLiveSignals(); }

  function flush() {
    if (!state.dirty) return;
    var log = collectLog();
    if (saveLog(log)) state.dirty = false;
  }

  /* ── 설정 화면 ──────────────────────────────────────── */
  function fillBabyForm() {
    var b = state.baby;
    $('#setup-close').hidden = !b;
    $('#setup-danger').hidden = !b;
    if (!b) return;
    $('#baby-name').value = b.name || '';
    $('#baby-birthdate').value = b.birthDate || '';
    $('#baby-birthweight').value = b.birthWeight || '';
    setChip($('#baby-feedingtype'), b.feedingType || null);
  }

  function submitBaby(e) {
    e.preventDefault();
    var err = $('#setup-error');
    var name = $('#baby-name').value.trim();
    var birthDate = $('#baby-birthdate').value;
    var birthWeight = parseInt($('#baby-birthweight').value, 10);
    var feedingType = chipValue($('#baby-feedingtype'));

    var problems = [];
    if (!name) problems.push('이름');
    if (!birthDate) problems.push('생년월일');
    if (!isFinite(birthWeight) || birthWeight <= 0) problems.push('출생 체중');
    if (!feedingType) problems.push('수유 방식');

    if (problems.length) {
      err.textContent = problems.join(', ') + ' 을(를) 입력해 주세요.';
      err.hidden = false;
      return;
    }
    if (birthDate > todayStr()) {
      err.textContent = '생년월일이 오늘보다 뒤일 수 없습니다.';
      err.hidden = false;
      return;
    }
    err.hidden = true;

    state.baby = { name: name, birthDate: birthDate, birthWeight: birthWeight, feedingType: feedingType };
    lsSet(KEY_BABY, state.baby);
    go('home');
  }

  /* ── 홈 ─────────────────────────────────────────────── */
  function renderHome() {
    var baby = state.baby;
    if (!baby) return go('setup');

    var today = todayStr();
    var log = loadLog(today);
    var r = NTEvaluate.evaluate(log, baby, state.criteria);

    // 일령은 기록이 있든 없든 항상 보여야 합니다.
    // evaluate 는 기록이 없으면 일령을 셀 수 없으므로(날짜가 없어서) 여기서 직접 셉니다.
    var day = NTEvaluate.dayOfLife(today, baby.birthDate);
    $('#home-babyname').textContent = baby.name;
    $('#home-age').textContent = (day != null && day >= 1) ? '생후 ' + day + '일' : '생후 —일';
    $('#home-date').textContent = prettyDate(today);

    var LIGHT = {
      red:    '오늘 확인이 필요한 항목이 있습니다',
      yellow: '오늘 살펴볼 항목이 있습니다',
      green:  '오늘 입력한 항목은 모두 기준 범위입니다',
      none:   '오늘 기록이 아직 없습니다'
    };
    $('#home-light').dataset.flag = r.overall;
    $('#home-light-text').textContent = LIGHT[r.overall];

    var wrap = $('#home-cards');
    wrap.innerHTML = '';
    r.items.forEach(function (it) { wrap.appendChild(card(it)); });
    r.missing.forEach(function (m) {
      wrap.appendChild(card({ label: m.label, flag: 'missing', message: '아직 입력하지 않음' }));
    });

    $('#home-record').textContent = log ? '오늘 기록 이어서 쓰기' : '오늘 기록하기';
  }

  function card(it) {
    var el = document.createElement('div');
    el.className = 'card';
    el.dataset.flag = it.flag;

    var head = document.createElement('div');
    head.className = 'card-head';
    var dot = document.createElement('span');
    dot.className = 'sig';
    if (it.flag !== 'missing') dot.dataset.flag = it.flag;
    var lab = document.createElement('span');
    lab.className = 'card-label';
    lab.textContent = it.label;
    head.appendChild(dot);
    head.appendChild(lab);
    el.appendChild(head);

    var msg = document.createElement('p');
    msg.className = 'card-msg';
    msg.textContent = it.message;
    el.appendChild(msg);

    // green 이 아닌 항목에는 참고 문구와 출처 링크를 반드시 함께 보여줍니다.
    if (it.flag !== 'green' && it.flag !== 'missing') {
      if (it.note) {
        var note = document.createElement('p');
        note.className = 'card-note';
        note.textContent = it.note;
        el.appendChild(note);
      }
      if (it.source) el.appendChild(sourceLine(it.source));
    }
    return el;
  }

  function sourceLine(src) {
    var p = document.createElement('p');
    p.className = 'src';
    p.appendChild(document.createTextNode('출처: '));
    var a = document.createElement('a');
    a.href = src.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = src.name;
    p.appendChild(a);
    return p;
  }

  /* ── 오늘 : 기록 입력 ──────────────────────────────── */
  function renderToday() {
    var log = loadLog(state.date);
    fillLogForm(log);
    state.dirty = false;

    $('#today-date').textContent = prettyDate(state.date);
    var day = NTEvaluate.dayOfLife(state.date, state.baby.birthDate);
    $('#today-age').textContent = (day != null && day >= 1)
      ? '생후 ' + day + '일'
      : '출생 전 날짜입니다';
    $('#date-next').disabled = state.date >= todayStr();   // 미래는 볼 수 없습니다
    $('#save-note').textContent = '';
    updateLiveSignals();
  }

  function fillLogForm(log) {
    log = log || {};
    setStep('breastFeedCount', log.breastFeedCount);
    setStep('formulaFeedCount', log.formulaFeedCount);
    setStep('wetDiaperCount', log.wetDiaperCount);
    setStep('stoolCount', log.stoolCount);

    $('#in-formulaTotalMl').value = log.formulaTotalMl != null ? log.formulaTotalMl : '';
    $('#in-sleepTotalHours').value = log.sleepTotalHours != null ? log.sleepTotalHours : '';
    $('#in-temperature').value = log.temperature != null ? log.temperature : '';
    $('#in-weightGram').value = log.weightGram != null ? log.weightGram : '';
    $('#in-memo').value = log.memo || '';

    setChip($('#chips-stoolColor'), log.stoolColor || []);
    setChip($('#chips-stoolTexture'), log.stoolTexture || null);
    setChip($('#chips-jaundice'), log.jaundiceLevel || null);
    setChip($('#chips-alertness'), log.alertness || null);

    var symptoms = log.symptoms || [];
    $$('#checks-symptoms input').forEach(function (cb) {
      cb.checked = symptoms.indexOf(cb.value) >= 0;
    });
  }

  function setStep(name, value) {
    var n = (typeof value === 'number' && isFinite(value)) ? value : 0;
    $('#val-' + name).textContent = n;
    $('#val-' + name).dataset.value = n;
  }
  function getStep(name) { return parseInt($('#val-' + name).dataset.value || '0', 10); }

  function numOrNull(sel) {
    var v = $(sel).value.trim();
    if (v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  // 화면의 입력값을 그대로 dailyLog 한 건으로 모읍니다.
  function collectLog() {
    return {
      date: state.date,
      breastFeedCount: getStep('breastFeedCount'),
      formulaFeedCount: getStep('formulaFeedCount'),
      formulaTotalMl: numOrNull('#in-formulaTotalMl'),
      wetDiaperCount: getStep('wetDiaperCount'),
      stoolCount: getStep('stoolCount'),
      stoolColor: chipValues($('#chips-stoolColor')),
      stoolTexture: chipValue($('#chips-stoolTexture')),
      sleepTotalHours: numOrNull('#in-sleepTotalHours'),
      temperature: numOrNull('#in-temperature'),
      jaundiceLevel: chipValue($('#chips-jaundice')),
      alertness: chipValue($('#chips-alertness')),
      weightGram: numOrNull('#in-weightGram'),
      symptoms: $$('#checks-symptoms input').filter(function (cb) { return cb.checked; })
                                            .map(function (cb) { return cb.value; }),
      memo: $('#in-memo').value.trim() || null
    };
  }

  /* 입력하는 동안 각 섹션 옆의 점을 실시간으로 칠합니다.
     저장 전에도 지금 입력값이 어떤 신호인지 바로 보입니다. */
  function updateLiveSignals() {
    if (!state.baby || !state.criteria) return;
    var r = NTEvaluate.evaluate(collectLog(), state.baby, state.criteria);
    $$('.sig[data-sig]').forEach(function (el) {
      var it = r.byKey[el.dataset.sig];
      if (it) el.dataset.flag = it.flag;
      else el.removeAttribute('data-flag');
    });
  }

  function submitLog(e) {
    e.preventDefault();
    var log = collectLog();
    if (!saveLog(log)) return;
    state.dirty = false;
    var r = NTEvaluate.evaluate(log, state.baby, state.criteria);
    $('#save-note').textContent = '저장했습니다' +
      (r.overall === 'red' ? ' · 확인이 필요한 항목이 있습니다' : '');
    updateLiveSignals();
  }

  /* ── 추이 : 5단계에서 chart.js 가 채웁니다 ─────────── */
  function renderTrend() {
    if (window.NTTrend && typeof window.NTTrend.render === 'function') {
      window.NTTrend.render(allLogs(), state.baby, state.criteria);
    }
  }

  /* ── 근거 ───────────────────────────────────────────── */
  function renderBasis() {
    var wrap = $('#basis-categories');
    wrap.innerHTML = '';
    var cats = state.criteria.categories || {};

    Object.keys(cats).forEach(function (key) {
      var c = cats[key];
      var box = document.createElement('section');
      box.className = 'box';

      var h = document.createElement('h2');
      h.className = 'box-title';
      h.textContent = c.label || key;
      box.appendChild(h);

      // reference 는 문자열일 수도, { breast: '...', formula: '...' } 일 수도 있습니다.
      if (typeof c.reference === 'string') {
        box.appendChild(para(c.reference));
      } else if (c.reference && typeof c.reference === 'object') {
        Object.keys(c.reference).forEach(function (k) { box.appendChild(para(c.reference[k])); });
      }
      if (c.note) {
        var n = para(c.note);
        n.className = 'box-hint';
        box.appendChild(n);
      }
      var src = findSource(c.sourceId);
      if (src) box.appendChild(sourceLine(src));
      wrap.appendChild(box);
    });

    var rf = state.criteria.generalRedFlags || {};
    $('#basis-redflags-title').textContent = rf.label || '';
    $('#basis-redflags-note').textContent = rf.note || '';
    var ul = $('#basis-redflags-list');
    ul.innerHTML = '';
    (rf.items || []).forEach(function (it) {
      var li = document.createElement('li');
      li.textContent = it.label;
      ul.appendChild(li);
    });
    var rfSrc = findSource(rf.sourceId);
    var holder = $('#basis-redflags-src');
    holder.innerHTML = '';
    if (rfSrc) holder.appendChild(sourceLine(rfSrc));
  }

  function para(text) {
    var p = document.createElement('p');
    p.textContent = text;
    return p;
  }

  function findSource(id) {
    var list = (state.criteria && state.criteria.sources) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ── 내보내기 / 불러오기 / 삭제 ─────────────────────── */
  function exportAll() {
    var data = { app: 'newborn-daily-tracker', exportedAt: new Date().toISOString(),
                 baby: state.baby, logs: allLogs() };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'baby-log-' + todayStr() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function importAll(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.logs)) throw new Error('형식이 다릅니다');
        if (!confirm('기록 ' + data.logs.length + '건을 불러옵니다. 같은 날짜는 덮어씁니다. 계속할까요?')) return;
        if (data.baby) { state.baby = data.baby; lsSet(KEY_BABY, data.baby); }
        data.logs.forEach(function (log) { if (log && log.date) saveLog(log); });
        alert('불러왔습니다.');
        go('home');
      } catch (err) {
        alert('불러오지 못했습니다: ' + (err.message || err));
      }
    };
    reader.readAsText(file);
  }

  function wipeAll() {
    if (!confirm('모든 기록과 아기 정보를 지웁니다. 되돌릴 수 없습니다. 계속할까요?')) return;
    if (!confirm('정말 지울까요? 먼저 "기록 내보내기"로 백업해 두는 것을 권합니다.')) return;
    allLogs().forEach(function (l) { lsDel(KEY_LOG + l.date); });
    lsDel(KEY_BABY);
    state.baby = null;
    location.reload();
  }

  /* ── 이벤트 연결 ────────────────────────────────────── */
  function wire() {
    $$('.nav-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.screen === 'today') state.date = todayStr();
        go(b.dataset.screen);
      });
    });

    $('#home-settings').addEventListener('click', function () { go('setup'); });
    $('#setup-close').addEventListener('click', function () { go('home'); });
    $('#form-baby').addEventListener('submit', submitBaby);
    $('#baby-feedingtype').addEventListener('click', onChipClick);

    $('#home-record').addEventListener('click', function () {
      state.date = todayStr();
      go('today');
    });

    $('#date-prev').addEventListener('click', function () {
      flush();
      state.date = shiftDate(state.date, -1);
      renderToday();
    });
    $('#date-next').addEventListener('click', function () {
      if (state.date >= todayStr()) return;
      flush();
      state.date = shiftDate(state.date, 1);
      renderToday();
    });

    // 스테퍼 (− / +)
    $('#form-log').addEventListener('click', function (e) {
      var btn = e.target.closest('.step-btn');
      if (!btn) return;
      var row = btn.closest('[data-stepper]');
      var name = row.dataset.stepper;
      var next = Math.max(0, Math.min(60, getStep(name) + (+btn.dataset.step)));
      setStep(name, next);
      touched();
    });

    $$('#form-log .chips').forEach(function (box) { box.addEventListener('click', onChipClick); });
    $('#form-log').addEventListener('input', touched);
    $('#form-log').addEventListener('change', touched);
    $('#form-log').addEventListener('submit', submitLog);

    $('#trend-tabs').addEventListener('click', function (e) {
      var tab = e.target.closest('.tab');
      if (!tab) return;
      $$('#trend-tabs .tab').forEach(function (t) {
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      renderTrend();
    });

    $('#btn-export').addEventListener('click', exportAll);
    $('#btn-import').addEventListener('click', function () { $('#import-file').click(); });
    $('#import-file').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) importAll(e.target.files[0]);
      e.target.value = '';
    });
    $('#btn-wipe').addEventListener('click', wipeAll);

    // 앱을 백그라운드로 보내거나 닫을 때도 입력 중이던 내용을 지킵니다.
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  // 5단계(chart.js)와 테스트에서 쓰도록 최소한만 밖으로 엽니다.
  window.NTApp = {
    state: state,
    allLogs: allLogs,
    go: go,
    todayStr: todayStr,
    // 추이 화면의 신호 스트립에서 그날 기록으로 바로 이동
    openDate: function (date) { state.date = date; go('today'); },
    activeTab: function () {
      var t = document.querySelector('#trend-tabs .tab[aria-selected="true"]');
      return t ? t.dataset.tab : 'weight';
    }
  };

  var booted = false;
  function bootOnce() { if (booted) return; booted = true; boot(); }
  document.addEventListener('DOMContentLoaded', bootOnce);
  if (document.readyState !== 'loading') bootOnce();
})();
