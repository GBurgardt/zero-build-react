// zero/mornings/app.js
import React, { useMemo, useState, useEffect, useCallback } from 'react';

const DAYS = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const TABS = ['Vision', 'Gratitude', 'Intention', 'Tasks', 'Medicine'];

function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}

function startOfWeek(d = new Date()) {
  const day = (d.getDay() + 6) % 7; // 0 = Mon
  const s = new Date(d);
  s.setDate(d.getDate() - day);
  s.setHours(0,0,0,0);
  return s;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function parseXMLSafe(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('Invalid XML');
  return doc;
}

function extractDayFromXML(doc) {
  const sel = (q) => doc.querySelector(q);
  const getText = (el) => (el ? el.textContent.trim() : '');
  const dayEl = sel('day');
  const date = dayEl?.getAttribute('date') || todayStr();
  const visionEl = sel('vision');
  const gratitudeEls = Array.from(doc.querySelectorAll('gratitude > item'));
  const intentionEls = Array.from(doc.querySelectorAll('intention > item'));
  const taskEls = Array.from(doc.querySelectorAll('tasks > task'));
  const medEl = sel('medicine');
  const titleEl = sel('vision_title');
  const horizon = visionEl?.getAttribute('horizon') || 'daily';

  return {
    date,
    vision: getText(visionEl),
    visionTitle: getText(titleEl),
    gratitude: gratitudeEls.map((e) => ({ text: getText(e), category: e.getAttribute('category') || 'other' })),
    intention: intentionEls.map((e) => ({ text: getText(e), verb: e.getAttribute('verb') || '', timebox: e.getAttribute('timebox') || '' })),
    tasks: taskEls.map((e) => ({ text: getText(e), done: (e.getAttribute('done')||'false') === 'true' })),
    medicine: getText(medEl),
    horizon,
  };
}

function inferDots(day) {
  return {
    vis: !!(day.vision && day.vision.trim()),
    gra: (day.gratitude||[]).length > 0,
    int: (day.intention||[]).length > 0,
    tsk: (day.tasks||[]).length > 0,
    med: !!(day.medicine && day.medicine.trim()),
  };
}

function loadStore() {
  try { return JSON.parse(localStorage.getItem('mornings:days')||'{}'); } catch { return {}; }
}
function saveStore(map) {
  try { localStorage.setItem('mornings:days', JSON.stringify(map)); } catch {}
}

export default function App() {
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()));
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [activeTab, setActiveTab] = useState('Vision');
  const [daysMap, setDaysMap] = useState(() => loadStore());
  const [rawInput, setRawInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [compare, setCompare] = useState([]); // array de fechas

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const selectedDay = daysMap[selectedDate] || null;

  useEffect(() => { saveStore(daysMap); }, [daysMap]);

  const shiftWeek = (delta) => setWeekStart((w) => addDays(w, delta*7));

  const handleImport = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const prompt = buildPrompt(rawInput);
      const resp = await fetch('/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5', messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ], temperature: 0.2 })
      });
      const data = await resp.json();
      if (!resp.ok || !data.text) throw new Error(data.detail || data.error || 'LLM error');
      const xml = data.text.trim();
      const doc = parseXMLSafe(xml);
      const dayObj = extractDayFromXML(doc);
      setDaysMap((m) => ({ ...m, [dayObj.date]: dayObj }));
      setSelectedDate(dayObj.date);
      setRawInput('');
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, [rawInput]);

  const toggleCompare = (dateStr) => {
    setCompare((prev) => prev.includes(dateStr) ? prev.filter(d => d !== dateStr) : [...prev, dateStr]);
  };

  const compareDays = compare.map(d => ({ date: d, day: daysMap[d] })).filter(x => x.day);

  return (
    React.createElement('div', { className: 'layout' },
      React.createElement('aside', { className: 'sidebar' },
        React.createElement('div', { className: 'brand' }, 'Mornings'),
        React.createElement('div', { className: 'week-header' },
          React.createElement('button', { className: 'nav-btn', onClick: () => shiftWeek(-1) }, '←'),
          React.createElement('div', null, weekLabel(weekStart)),
          React.createElement('button', { className: 'nav-btn', onClick: () => shiftWeek(1) }, '→')
        ),
        React.createElement('div', { className: 'week-strip' },
          ...weekDays.map((d, idx) => {
            const ds = todayStr(d);
            const entry = daysMap[ds];
            const dots = entry ? inferDots(entry) : {};
            return React.createElement('div', {
              key: ds, className: `day ${selectedDate === ds ? 'active' : ''}`,
              onClick: () => setSelectedDate(ds), title: ds
            },
              React.createElement('small', null, DAYS[idx]),
              React.createElement('strong', null, String(d.getDate()).padStart(2,'0')),
              React.createElement('div', { className: 'dots' },
                React.createElement('div', { className: `dot ${dots.vis ? 'on' : ''}`, title: 'Vision' }),
                React.createElement('div', { className: `dot ${dots.gra ? 'on' : ''}`, title: 'Gratitude' }),
                React.createElement('div', { className: `dot ${dots.int ? 'on' : ''}`, title: 'Intention' }),
                React.createElement('div', { className: `dot ${dots.tsk ? 'on' : ''}`, title: 'Tasks' })
              ),
              entry && React.createElement('div', { className: 'hint' }, entry.visionTitle ? entry.visionTitle.slice(0, 26) : '')
            );
          })
        ),
        React.createElement('div', { className: 'filters' },
          React.createElement('button', { className: 'chip', onClick: () => setWeekStart(startOfWeek(new Date())) }, 'Hoy'),
          React.createElement('button', { className: 'chip', onClick: () => setCompare([]) }, 'Clear Compare')
        )
      ),
      React.createElement('main', { className: 'main' },
        React.createElement('div', { className: 'topbar' },
          React.createElement('h2', { className: 'date-title' }, datePretty(selectedDate)),
          React.createElement('div', { className: 'row' },
            React.createElement('button', { className: 'chip', onClick: () => toggleCompare(selectedDate) }, compare.includes(selectedDate) ? '✓ Comparing' : 'Compare'),
            React.createElement('button', { className: 'chip', onClick: () => setActiveTab('Vision') }, 'Focus Vision')
          )
        ),
        React.createElement('div', { className: 'panel' },
          React.createElement('div', { className: 'tabs' },
            ...TABS.map(t => React.createElement('div', { key: t, className: `tab ${activeTab === t ? 'active' : ''}`, onClick: () => setActiveTab(t) }, t))
          ),
          React.createElement('div', { className: 'section' },
            renderTabContent(activeTab, selectedDay)
          )
        ),
        React.createElement('div', { className: 'two' },
          React.createElement('div', { className: 'panel' },
            React.createElement('h3', { className: 'title' }, 'Importar transcripción'),
            React.createElement('p', { className: 'muted' }, 'Pega tu morning routine. Se estructurará con AI.'),
            React.createElement('textarea', { className: 'input', value: rawInput, onChange: (e) => setRawInput(e.target.value), placeholder: 'Pega texto aquí...' }),
            React.createElement('div', { className: 'row' },
              React.createElement('button', { className: 'button', onClick: handleImport, disabled: loading || !rawInput.trim() }, loading ? 'Procesando…' : 'Estructurar con AI'),
              error && React.createElement('span', { className: 'muted' }, error)
            ),
            React.createElement('p', { className: 'hint' }, 'Los datos se guardan localmente en tu navegador.')
          ),
          React.createElement('div', { className: 'panel' },
            React.createElement('h3', { className: 'title' }, 'Comparación rápida (Vision)'),
            compareDays.length === 0 ? React.createElement('p', { className: 'muted' }, 'Selecciona días con “Compare”')
            : React.createElement('div', { className: 'list' },
                ...compareDays.map(({ date, day }) => React.createElement('div', { key: date, className: 'li' },
                  React.createElement('div', { className: 'row', style: { justifyContent: 'space-between' } },
                    React.createElement('strong', null, datePretty(date)),
                    day.horizon && React.createElement('span', { className: 'pill' }, horizonLabel(day.horizon))
                  ),
                  day.visionTitle && React.createElement('div', { className: 'muted' }, day.visionTitle),
                  day.vision && React.createElement('div', null, sliceText(day.vision, 320))
                ))
              )
          )
        )
      )
    )
  );
}

function renderTabContent(tab, day) {
  if (!day) return React.createElement('p', { className: 'muted' }, 'Sin datos para este día.');
  switch (tab) {
    case 'Vision':
      return (
        React.createElement(React.Fragment, null,
          day.visionTitle && React.createElement('h3', { className: 'title' }, day.visionTitle),
          day.vision && React.createElement('p', null, day.vision),
          day.horizon && React.createElement('div', { className: 'pill' }, horizonLabel(day.horizon))
        )
      );
    case 'Gratitude':
      return React.createElement('ul', { className: 'list' }, ...(day.gratitude||[]).map((g, i) => React.createElement('li', { key: i, className: 'li' }, g.text)));
    case 'Intention':
      return React.createElement('ul', { className: 'list' }, ...(day.intention||[]).map((it, i) => React.createElement('li', { key: i, className: 'li' }, `${(it.verb||'').toUpperCase()} — ${it.text}${it.timebox?` (${it.timebox})`:''}`)));
    case 'Tasks':
      return React.createElement('ul', { className: 'list' }, ...(day.tasks||[]).map((t, i) => React.createElement('li', { key: i, className: 'li' }, `${t.done ? '✅' : '⬜️'} ${t.text}`)));
    case 'Medicine':
      return day.medicine ? React.createElement('blockquote', null, `“${day.medicine}”`) : React.createElement('p', { className: 'muted' }, 'Sin medicina.');
    default:
      return null;
  }
}

function buildPrompt(raw) {
  return (
`You are a disciplined extractor. Return STRICT XML with this structure and order. No explanations.
<day date="${todayStr()}">
  <vision horizon="daily"></vision>
  <vision_title></vision_title>
  <gratitude>
    <item category="self"></item>
  </gratitude>
  <intention>
    <item verb="activate" timebox="today"></item>
  </intention>
  <tasks>
    <task done="false"></task>
  </tasks>
  <medicine></medicine>
  <themes>
    <theme name="entrepreneurship" strength="0.5"/>
  </themes>
  <signals>
    <vision_change score="0.0"/>
  </signals>
  <source></source>
</day>
Rules:
- Tags in English exactly as above; include empty tags if missing.
- Keep content in original language (Spanish input → Spanish content).
- Gratitude and Intention as bullets (items). Max 10 items each. Do not invent tasks.
- Extract horizon if present (e.g., "en dos años" → horizon="2y"). Else horizon="daily".
- Ignore small talk/logistics/noise; keep only meaningful content.

Input:
${raw}`
  );
}

const systemPrompt = `You structure Morning Routine transcripts into strict XML for UI rendering. Do not add commentary. Always return valid XML.`;

function weekLabel(weekStart) {
  const end = addDays(weekStart, 6);
  const opts = { month: 'short', day: 'numeric' };
  return `${weekStart.toLocaleDateString('es-AR', opts)} – ${end.toLocaleDateString('es-AR', opts)}`;
}
function datePretty(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
function horizonLabel(h) {
  if (h === '2y') return 'Horizon: 2 años';
  if (h === '1y') return 'Horizon: 1 año';
  if (h === 'daily') return 'Horizon: día';
  return `Horizon: ${h}`;
}
function sliceText(t, n) { return (t||'').length > n ? t.slice(0, n) + '…' : (t||''); }
