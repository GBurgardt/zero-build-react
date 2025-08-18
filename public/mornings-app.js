// public/mornings-app.js
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
  const [rawInput, setRawInput] = useState(`Buen día, esta es amor de otro fin. Son las diez, creo, de la mañana. Estoy arrancando. Vamos a empezar para agradecer. Te agradezco profundamente y el corazón por tener salud.
Eh... Agradezco por mis amigos, por sentirme bien. Y me sano, bastante estable.
Agradezco por... compañía ahora, viste, para que me siento cómodo y bueno, la relación sentimental, digamos. Agradezco por lo que estoy recibiendo. También agradezco por el laburo, por el trabajo, me gusta, bien, bien.
Bueno, agradezco por tu familia anda bien. Que mis amigos dentro de todo andan bien. Les dejo partir a la gente que quiera anda bien, la gente que quiera. Disfrutan de casa, comida.
Agradezco por los planes que tengo, por... Agradezco por mi nosotros también. Aquí hay cosas que me apasionan, que no tienen me llaman de la pasión para el día. Eso es muy importante la agradezco. La. Curiosidad, la pasión con lo que hago. Correcto, ya me de ahí sin precaución.
No. Bueno, vamos con la visión. Los años me veo... tengo una normalidad en la que hacer con Elian, como la que pudimos hacer, pero más intensa.
Estamos los dos ahí, siguiendo las estrategias empresariales, el producto que estamos creando que está muy bueno. Ahí teniendo charlas apasionadas por qué se sigue desarrollando el producto, pero bien cómodos, bien en esa situación. Luego tengo que dar una charla de IA porque una charla no, tengo que hacer un stream hablando para hacer recortes y subir porque tengo 20.000 seguidores y hablo de cosas que a la gente le interesa mucho escuchando hablar.
Soy muy interesante igual que ahora, pero debería tener 20.000 seguidores. Entonces tengo 20.000.
bueno seguramente va a estar bien acá en un lugar o no pero si viajando sintiéndome como y bien tengo confianza elevadísimo por estar tan activo estoy muy activo haciendo muchas cosas pero un estado de comodidad total. Voy a ser como un genio loco del stream, digamos. Con sentido de que voy a hablar de conciencia, de inteligencia artificiales, pero con un conocimiento muy profundo y unas opiniones muy locas.
Y la gente me va a reconocer por la calle, básicamente.
bueno dame un café Ay no sabe.
Esa fue una charla con mi bosquero, ignorala, estoy haciendo el amor en rutin, mientras tanto. Bueno, retomando un poco... Bueno, la visión es un poco esa. No hay mucho más, digamos. Esa es un poco la idea de Luis Hernando, no? Y la intención para eso es, bueno, seguir en lo que hice ayer con Elian, por ejemplo, seguir activando esos activos de juntarme con Elian.
activar más que nada la parte empresarial con él que es una parte de la visión y la otra parte de la visión es la parte de influencer que bueno la sigo activando, codeando mucho y eso. Estoy mucho por el hogar.
Listo Gracias.
Así solo.
Todo lo del kiosco ignorado, porque fui a comprar huevo con dos kioscos distintos, pero bueno, eso no lo pongas en el resumen. Entonces, la intención es un poco esa, intensionar, ahí seguir con este camino..`);
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
      const resp = await fetch('/zero-api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5', messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ], temperature: 0.2 })
      });
      const txt = await resp.text();
      try { console.log('[mornings][raw-response]', txt.slice(0, 4000)); } catch(_) {}
      let data; try { data = JSON.parse(txt); } catch { throw new Error('Respuesta no JSON del servidor'); }
      if (!resp.ok || !data.text) throw new Error(data.detail || data.error || 'LLM error');
      const xml = data.text.trim();
      try { console.log('[mornings][xml]', xml.slice(0, 4000)); } catch(_) {}
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
`You are a disciplined extractor. Return STRICT XML ONLY, no commentary, following this EXACT structure and order. The first tag MUST be an internal monologue of exactly 100 lines that reasons through the transcript to derive the sections.
<day date="${todayStr()}">
  <internal_monologue>
  <!-- 100 lines, each non-empty, reflecting step-by-step reasoning about the user's transcript: what is their long-term vision, what is today's vision, core themes, what belongs to gratitude, what is intention vs task, what to ignore as noise. Do not reference being an AI. No XML tags inside except text. Exactly 100 lines. -->
  </internal_monologue>
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
- Tags and order are mandatory as shown. Include empty tags if missing content.
- Content language = user's original language (Spanish here).
- Fill <vision> with a substantial, coherent paragraph (120–300 palabras) extracted and cleaned from the transcript; NEVER leave it empty. Capture both the drive (emprender/divulgar/IA/streaming) and modalities (tiempos, energía, foco). If longer-horizon is explicit (e.g., "en dos años"), set horizon accordingly (e.g., "2y").
- <vision_title> = 60–80 caracteres, resumen claro del día.
- <gratitude> and <intention> as itemized bullets. Max 10 each. Intention items normalized with verb attribute and optional timebox.
- <tasks> only if explicit, operational; do not invent. Empty is allowed.
- <medicine> short lyrical sentence if present.
- <themes> up to 5 with strengths summing ~1.0.
- <signals> include a rough vision_change score between 0 and 1 based on similarity vs the immediate past inferred from text.
- Ignore small talk/logistics/noise (e.g., kiosco, charlas laterales) unless it clarifies sections.

Input transcript (raw):
${raw}`
  );
}

const systemPrompt = `You structure Morning Routine transcripts into strict XML for UI rendering. Do not add commentary. Always return valid XML. The first tag MUST be <internal_monologue> with exactly 100 non-empty lines. Never leave <vision> empty; write a substantive 120–300-word paragraph and a concise <vision_title>.`;

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
