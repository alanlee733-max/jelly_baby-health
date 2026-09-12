/* evaluate.js — 판정 로직 (순수 함수)
 *
 * evaluate(log, baby, criteria) 하나만 보면 됩니다.
 * DOM 도 localStorage 도 전혀 건드리지 않습니다. 같은 입력이면 언제나 같은 출력입니다.
 *
 * 판정 결과는 저장하지 않습니다. 화면을 그릴 때마다 이 함수를 다시 부릅니다.
 * 그래서 criteria.json 을 고치면 과거 기록도 자동으로 새 기준으로 다시 평가됩니다.
 *
 * 기준 수치·라벨·출처는 전부 criteria 인자에서 옵니다. 이 파일에는 기준값이 없습니다.
 */

(function (root) {
  'use strict';

  var RANK = { none: 0, green: 1, yellow: 2, red: 3 };

  function worse(a, b) { return (RANK[b] || 0) > (RANK[a] || 0) ? b : a; }

  /* 일령: 출생일이 1일. 날짜 문자열('YYYY-MM-DD')을 UTC 로 읽어
     서머타임·시간대 때문에 하루가 밀리는 일을 막습니다. */
  function toUTC(dateStr) {
    if (!dateStr) return NaN;
    var p = String(dateStr).split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  }

  function dayOfLife(dateStr, birthDateStr) {
    var d = toUTC(dateStr), b = toUTC(birthDateStr);
    if (isNaN(d) || isNaN(b)) return null;
    return Math.floor((d - b) / 86400000) + 1;
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  // 소수점 첫째 자리까지, 불필요한 .0 은 떼기 (예: 11.0% → 11%)
  function fmt(n, digits) {
    var s = Number(n).toFixed(digits == null ? 1 : digits);
    return s.replace(/\.0+$/, '');
  }

  // 체온은 관례대로 소수점 한 자리를 항상 유지합니다 (38 → 38.0)
  function degC(n) { return Number(n).toFixed(1); }

  function findSource(criteria, id) {
    var list = (criteria && criteria.sources) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ────────────────────────────────────────────────────────────
     evaluate(log, baby, criteria, now)

     now 는 선택입니다. 넣지 않으면 지금까지처럼 모든 항목을 곧바로 판정합니다.
     넣으면 criteria.partialDay 규칙에 따라, '오늘 진행 중인 하루'의 총계 항목
     (수유·기저귀 횟수)을 아직 판정하지 않고 '집계 중'으로 미룹니다.
     오전 10시에 수유 2회를 '부족'이라고 말하지 않기 위해서입니다.
     now 를 넣어도 같은 인자면 같은 결과가 나오므로 순수 함수는 그대로입니다.

     반환값
       dayOfLife : 일령 (숫자 또는 null)
       overall   : 'red' | 'yellow' | 'green' | 'none'  (판정할 게 없으면 none)
       items     : 판정된 항목들. 심한 순서(red→yellow→green)로 정렬됨
                   { key, label, flag, message, note, source:{name,url} }
       byKey     : items + pending 을 key 로 찾기 쉽게 만든 객체 (섹션별 신호용)
       missing   : 아직 입력하지 않은 항목 [{ key, label }]
       pending   : 오늘이 끝나기 전이라 아직 판정하지 않은 항목 [{ key, label, message }]
       symptoms  : 체크된 즉시 상담 신호 [{ id, label }]
     ──────────────────────────────────────────────────────────── */
  function evaluate(log, baby, criteria, now) {
    var cats = (criteria && criteria.categories) || {};
    var items = [];
    var missing = [];
    var pending = [];
    var day = (baby && log) ? dayOfLife(log.date, baby.birthDate) : null;

    // 오늘 진행 중인 하루인지, 그래서 어떤 항목을 미룰지 정합니다.
    var defer = deferRules(log, criteria, now);
    var cutoffText = defer.cutoffText;

    function label(key, fallback) {
      return (cats[key] && cats[key].label) || fallback || key;
    }

    function push(key, flag, message) {
      var c = cats[key] || {};
      items.push({
        key: key,
        label: label(key),
        flag: flag,
        message: message,
        note: c.note || null,
        source: findSource(criteria, c.sourceId)
      });
    }

    function miss(key, fallback) {
      missing.push({ key: key, label: label(key, fallback) });
    }

    // 아직 판정하지 않고 지금까지의 값만 보여줍니다.
    function hold(key, message) {
      pending.push({
        key: key,
        label: label(key),
        flag: 'pending',
        message: message + ' · ' + cutoffText + '부터 기준과 비교합니다'
      });
    }

    if (!log || !baby || day === null) {
      // 기록이 없는 날. 판정하지 않고 전부 '아직 입력하지 않음'으로 둡니다.
      ['feeding', 'wetDiapers', 'stool', 'jaundice', 'alertness', 'temperature', 'weight']
        .forEach(function (k) { miss(k); });
      return { dayOfLife: day, overall: 'none', items: [], byKey: {},
               missing: missing, pending: [], symptoms: [] };
    }

    /* ── 수유 ────────────────────────────────────────────────
       하루 총 수유 횟수(모유+분유)를 봅니다. 어떤 기준표를 쓸지는 baby.feedingType 이 정합니다.
       혼합 수유라면 두 횟수를 합쳐 보는 것이 맞고, 분유만 먹는 아기는 모유 횟수가 0 이라
       합계를 써도 결과가 같습니다. */
    (function () {
      var c = cats.feeding;
      if (!c || !c.thresholds) return;

      var breast = isNum(log.breastFeedCount) ? log.breastFeedCount : null;
      var formula = isNum(log.formulaFeedCount) ? log.formulaFeedCount : null;
      if (breast === null && formula === null) { miss('feeding'); return; }

      var total = (breast || 0) + (formula || 0);

      // 하루가 아직 진행 중이면 횟수를 기준과 비교하지 않습니다.
      if (defer.rules.feeding === 'all') { hold('feeding', '지금까지 수유 ' + total + '회'); return; }

      var th, basis;

      if (baby.feedingType === 'formula') {
        var f = c.thresholds.formula || {};
        if (day <= 7) { th = f.week1; basis = '분유 · 생후 7일 이내'; }
        else { th = f.after; basis = '분유 · 생후 8일 이후'; }
      } else {
        th = c.thresholds.breast;
        basis = baby.feedingType === 'mixed' ? '혼합' : '모유';
      }
      if (!th) { miss('feeding'); return; }

      var flag = total >= th.greenMin ? 'green' : (total >= th.yellowMin ? 'yellow' : 'red');
      push('feeding', flag,
        '오늘 수유 ' + total + '회 (' + basis + ' 기준 하루 ' + th.greenMin + '회 이상)');
    })();

    /* ── 젖은 기저귀 ────────────────────────────────────────
       일령 5 이상이면 '5plus', 아니면 해당 일령의 값이 기준입니다. */
    (function () {
      var c = cats.wetDiapers;
      if (!c || !c.minByDayOfLife) return;
      if (!isNum(log.wetDiaperCount)) { miss('wetDiapers'); return; }

      var n = log.wetDiaperCount;
      if (defer.rules.wetDiapers === 'all') {
        hold('wetDiapers', '지금까지 젖은 기저귀 ' + n + '개');
        return;
      }

      var table = c.minByDayOfLife;
      var min = day >= 5 ? table['5plus'] : table[String(day)];
      if (!isNum(min)) { miss('wetDiapers'); return; }
      var flag = n >= min ? 'green' : (n >= min - 1 ? 'yellow' : 'red');
      push('wetDiapers', flag,
        '오늘 젖은 기저귀 ' + n + '개 (생후 ' + day + '일 기준 최소 ' + min + '개)');
    })();

    /* ── 대변 ────────────────────────────────────────────────
       색 중 가장 높은 등급을 채택합니다. 단 태변처럼 meconiumOnly 로 표시된 색은
       일령 3 을 넘으면 green 대신 yellow 로 낮춥니다. 형태 등급도 함께 반영하고,
       횟수가 0 이면 zeroCountFlag 를 적용합니다. */
    (function () {
      var c = cats.stool;
      if (!c) return;

      var colors = Array.isArray(log.stoolColor) ? log.stoolColor : [];
      var texture = log.stoolTexture || null;
      var count = isNum(log.stoolCount) ? log.stoolCount : null;

      if (count === null && !colors.length && !texture) { miss('stool'); return; }

      var flag = 'none';
      var reasons = [];

      colors.forEach(function (id) {
        var def = (c.colors || {})[id];
        if (!def) return;
        var f = def.flag;
        if (def.meconiumOnly && day > 3 && f === 'green') {
          f = 'yellow';
          reasons.push(def.label + ' (생후 3일까지가 일반적)');
        } else {
          reasons.push(def.label);
        }
        flag = worse(flag, f);
      });

      if (texture) {
        var t = (c.textures || {})[texture];
        if (t) { reasons.push(t.label); flag = worse(flag, t.flag); }
      }

      // 횟수가 0일 때의 판정만 하루가 끝나갈 때까지 미룹니다.
      // 흰 변·혈변처럼 시간과 무관한 색·형태 판정은 여기서 그대로 살아 있습니다.
      var holdZero = defer.rules.stool === 'zeroCount';

      if (count === 0 && c.zeroCountFlag && !holdZero) {
        flag = worse(flag, c.zeroCountFlag);
        reasons.unshift('오늘 대변 0회');
      } else if (count !== null) {
        reasons.unshift((holdZero ? '지금까지' : '오늘') + ' 대변 ' + count + '회');
      }

      if (flag === 'none') {
        if (holdZero && count === 0) hold('stool', '지금까지 대변 0회');
        else miss('stool');
        return;
      }
      push('stool', flag, reasons.join(' · '));
    })();

    /* ── 체중 ────────────────────────────────────────────────
       감소율 = (출생체중 − 오늘체중) / 출생체중 × 100 */
    (function () {
      var c = cats.weight;
      if (!c || !c.thresholds) return;
      if (!isNum(log.weightGram) || !isNum(baby.birthWeight) || baby.birthWeight <= 0) {
        miss('weight'); return;
      }

      var th = c.thresholds;
      var lossPct = (baby.birthWeight - log.weightGram) / baby.birthWeight * 100;
      var delta = log.weightGram - baby.birthWeight;
      var base = '오늘 ' + log.weightGram + 'g · 출생체중 ' + baby.birthWeight + 'g 대비 ' +
                 (delta >= 0 ? '+' : '−') + Math.abs(delta) + 'g (' +
                 (lossPct > 0 ? '−' + fmt(lossPct) : '+' + fmt(-lossPct)) + '%)';

      if (lossPct >= th.redLossPct) {
        push('weight', 'red', base + ' — 기준: ' + th.redLossPct + '% 이상 감소');
      } else if (lossPct >= th.yellowLossPct) {
        push('weight', 'yellow', base + ' — 기준: ' + th.yellowLossPct + '% 이상 감소');
      } else if (isNum(th.regainByDay) && day >= th.regainByDay && log.weightGram < baby.birthWeight) {
        push('weight', 'yellow',
          base + ' — 기준: 생후 ' + th.regainByDay + '일까지 출생체중 회복');
      } else {
        push('weight', 'green', base);
      }
    })();

    /* ── 체온 ──────────────────────────────────────────────── */
    (function () {
      var c = cats.temperature;
      if (!c || !c.thresholds) return;
      if (!isNum(log.temperature)) { miss('temperature'); return; }

      var th = c.thresholds;
      var t = log.temperature;
      var range = '정상 범위 ' + degC(th.greenMin) + '~' + degC(th.greenMax) + '°C';
      var flag, msg;

      if (t < th.redLow) {
        flag = 'red'; msg = '체온 ' + degC(t) + '°C (' + degC(th.redLow) + '°C 미만, ' + range + ')';
      } else if (t >= th.redHigh) {
        flag = 'red'; msg = '체온 ' + degC(t) + '°C (' + degC(th.redHigh) + '°C 이상, ' + range + ')';
      } else if (t >= th.greenMin && t <= th.greenMax) {
        flag = 'green'; msg = '체온 ' + degC(t) + '°C (' + range + ')';
      } else {
        flag = 'yellow'; msg = '체온 ' + degC(t) + '°C (' + range + ')';
      }
      push('temperature', flag, msg);
    })();

    /* ── 황달 · 활력 : criteria 의 levels 에 적힌 flag 를 그대로 씁니다 ── */
    [['jaundice', log.jaundiceLevel, '황달 범위: '],
     ['alertness', log.alertness, '활력: ']
    ].forEach(function (row) {
      var key = row[0], value = row[1], prefix = row[2];
      var c = cats[key];
      if (!c || !c.levels) return;
      if (!value) { miss(key); return; }
      var lv = c.levels[value];
      if (!lv) { miss(key); return; }
      push(key, lv.flag, prefix + lv.label);
    });

    /* ── 즉시 상담 신호 : 하나라도 켜지면 다른 항목과 무관하게 red ── */
    var symptoms = [];
    var rf = (criteria && criteria.generalRedFlags) || {};
    var checked = Array.isArray(log.symptoms) ? log.symptoms : [];
    if (checked.length) {
      var defs = rf.items || [];
      checked.forEach(function (id) {
        var found = null;
        for (var i = 0; i < defs.length; i++) if (defs[i].id === id) { found = defs[i]; break; }
        symptoms.push(found || { id: id, label: id });
      });
      items.push({
        key: 'symptoms',
        label: rf.label || '즉시 상담이 필요한 신호',
        flag: 'red',
        message: '체크한 신호 ' + symptoms.length + '개: ' +
                 symptoms.map(function (s) { return s.label; }).join(', '),
        note: rf.note || null,
        source: findSource(criteria, rf.sourceId)
      });
    }

    // 종합 = 항목 중 가장 높은 등급. 증상이 하나라도 있으면 무조건 red.
    var overall = 'none';
    items.forEach(function (it) { overall = worse(overall, it.flag); });
    if (symptoms.length) overall = 'red';

    // 심한 항목이 위로 오도록 정렬.
    // 같은 등급이면 '즉시 상담이 필요한 신호'를 맨 앞에 둡니다 — 가장 급한 항목이라서.
    var order = items.slice();
    order.sort(function (a, b) {
      var d = (RANK[b.flag] || 0) - (RANK[a.flag] || 0);
      if (d !== 0) return d;
      if (a.key === 'symptoms') return -1;
      if (b.key === 'symptoms') return 1;
      return 0;
    });

    var byKey = {};
    items.forEach(function (it) { byKey[it.key] = it; });
    pending.forEach(function (it) { byKey[it.key] = it; });

    return {
      dayOfLife: day,
      overall: overall,
      items: order,
      byKey: byKey,
      missing: missing,
      pending: pending,
      symptoms: symptoms
    };
  }

  /* criteria.partialDay 를 읽어, 이 기록이 '오늘 진행 중인 하루' 인지 판단합니다.
     now 가 없거나, 기록이 오늘이 아니거나, 기준 시각을 넘겼으면 아무것도 미루지 않습니다. */
  function deferRules(log, criteria, now) {
    var none = { rules: {}, cutoffText: '' };
    var pd = criteria && criteria.partialDay;
    if (!pd || !now || !log || !log.date) return none;

    var d = (now instanceof Date) ? now : new Date(now);
    if (isNaN(d.getTime())) return none;

    var today = d.getFullYear() + '-' +
                String(d.getMonth() + 1).padStart(2, '0') + '-' +
                String(d.getDate()).padStart(2, '0');
    if (today !== log.date) return none;                 // 지난 날짜는 그대로 판정합니다
    if (!isNum(pd.cutoffHour) || d.getHours() >= pd.cutoffHour) return none;

    return { rules: pd.defer || {}, cutoffText: hourText(pd.cutoffHour) };
  }

  function hourText(h) {
    if (h === 0) return '자정';
    if (h < 12) return '오전 ' + h + '시';
    if (h === 12) return '정오';
    if (h < 18) return '오후 ' + (h - 12) + '시';
    return '밤 ' + (h - 12) + '시';
  }

  var api = { evaluate: evaluate, dayOfLife: dayOfLife, RANK: RANK, worse: worse };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;  // 검증 스크립트용
  root.NTEvaluate = api;                                                      // 브라우저용
  root.evaluate = evaluate;
})(typeof globalThis !== 'undefined' ? globalThis : this);
