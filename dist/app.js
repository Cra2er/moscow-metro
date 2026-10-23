/* Moscow Metro. Browser-local D3 application, no accounts or network requests. */
(() => {
  'use strict';
  const data = window.METRO_DATA;
  const byId = id => document.getElementById(id);
  if (!window.d3 || !data) {
    byId('coverage').textContent = 'Не удалось загрузить схему. Обновите страницу.';
    return;
  }
  const nf = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 1});
  const integer = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 0});
  const esc = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const periodText = period => {if(period==='mcd-reported')return 'МЦД · опубликованные сутки';const [year, q] = period.split('-Q'); return `${['I','II','III','IV'][Number(q)-1]} квартал ${year}`;};
  const traffic = (station, p) => station.traffic[p];
  const metrics = {
    total: {label:'Пассажиропоток', short:'Пассажиропоток', unit:'проходов', flow:true, get:(s,p)=>data.periods[p]==='mcd-reported' ? s.reportedDaily?.value : traffic(s,p) ? traffic(s,p)[0]+traffic(s,p)[1] : null},
    age: {label:'Возраст станции', short:'Возраст', unit:'лет', get:s=>s.age},
    serviceAge: {label:'Возраст в метро / МЦД', short:'В сети', unit:'лет', get:s=>s.serviceAge},
    year: {label:'Год открытия', short:'Год открытия', unit:'', get:s=>s.year},
    depth: {label:'Глубина', short:'Глубина', unit:'м', get:s=>s.depth},
    distance: {label:'Расстояние до центра', short:'До центра', unit:'км', get:s=>s.distance},
    timeToCenter: {label:'Время до центра', short:'До центра по сети', unit:'мин', get:s=>s.timeToCenter},
    platforms: {label:'Количество платформ', short:'Платформы', unit:'', get:s=>s.platforms},
    tracks: {label:'Количество путей', short:'Пути', unit:'', get:s=>s.tracks},
    platformLength: {label:'Длина платформы', short:'Длина платформы', unit:'м', get:s=>s.platformLength},
    platformWidth: {label:'Ширина платформы', short:'Ширина платформы', unit:'м', get:s=>s.platformWidth},
    interval: {label:'Интервал (Яндекс Метро)', short:'Интервал в схеме', unit:'мин', get:s=>s.interval},
    constant: {label:'Как на схеме', short:'Без показателя', unit:'', get:()=>1}
  };
  const defaults = {size:'total', color:'age', sizeInverse:false, colorInverse:false, period:data.defaultPeriod ?? data.periods.length-1, amplitude:100, labels:true};
  let saved = {};
  try {saved = JSON.parse(localStorage.getItem('moscow-metro-v1') || '{}') || {};} catch {}
  const state = {...defaults, ...saved};
  for (const key of ['size','color']) if (!Object.hasOwn(metrics,state[key])) state[key] = defaults[key];
  for (const key of ['sizeInverse','colorInverse','labels']) if(typeof state[key] !== 'boolean') state[key]=defaults[key];
  if (!Number.isInteger(state.period) || state.period<0 || state.period>=data.periods.length) state.period=defaults.period;
  if (!Number.isFinite(state.amplitude)) state.amplitude=100;
  state.amplitude=Math.max(50,Math.min(220,state.amplitude));
  const persist = () => {try {localStorage.setItem('moscow-metro-v1',JSON.stringify(state));} catch {}};
  let selected = null;
  let hovered = null;
  let width = 0, height = 0, initialized = false;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduceMotion ? 0 : 650;
  const svg = d3.select('#map');
  const viewport = svg.append('g').attr('class','viewport');
  viewport.append('g').attr('class','geometry').html(data.background);
  const markers = data.stations.flatMap(station=>station.points.map((point,index)=>{
    const meta=station.pointMeta?.[index]||{line:station.line,lineName:station.lineName,color:station.color,r:5};
    return {station:{...station,...meta,reportedDaily:station.reportedDailyByLine?.[meta.line]||null},point,key:`${station.id}-${index}`};
  }));
  const stationVariants=[...new Map(markers.map(d=>[`${d.station.id}:${d.station.line}`,d.station])).values()];
  const hitIndex = d3.Delaunay.from(markers,d=>d.point[0],d=>d.point[1]);
  const nearestStation = event => {
    const point=d3.zoomTransform(svg.node()).invert(d3.pointer(event,svg.node()));
    return markers[hitIndex.find(point[0],point[1])].station;
  };
  const nodes = viewport.append('g').attr('class','metric-layer').selectAll('g').data(markers,d=>d.key).join('g')
    .attr('class','station-node').attr('transform',d=>`translate(${d.point.join(',')})`)
    .attr('tabindex',0).attr('role','button').attr('aria-label',d=>`${d.station.name}, ${d.station.lineName}`);
  nodes.append('circle').attr('class','station-circle').attr('r',5).attr('fill',d=>d.station.color).attr('stroke','none');
  nodes.append('circle').attr('class','station-hit').attr('r',18);
  const labels = viewport.append('g').attr('class','station-labels');
  const anchors = {a:['start',.75],b:['end',.75],c:['end',-.25],d:['start',-.25],e:['middle',.75],f:['end',.35],g:['middle',-.25],h:['start',.35]};
  labels.selectAll('text').data(data.labels).join('text').attr('class','station-label')
    .attr('x',d=>d.x).attr('y',d=>d.y).attr('font-size',d=>d.fontSize)
    .attr('text-anchor',d=>(anchors[d.textAnchor]||anchors.a)[0])
    .each(function(d){const a=anchors[d.textAnchor]||anchors.a; d3.select(this).selectAll('tspan').data(d.text.split('\n')).join('tspan').attr('x',d.x).attr('dy',(_,i)=>i ? (d.lineHeight||d.fontSize) : `${a[1]}em`).text(t=>t);});
  const zoom = d3.zoom().scaleExtent([.13,3]).on('zoom',event=>{
    viewport.attr('transform',event.transform);
    nodes.select('.station-hit').attr('r',Math.max(13,16/event.transform.k));
    byId('tooltip').hidden=true;
  });
  svg.call(zoom).on('dblclick.zoom',null).on('click',event=>{
    if (event.target===svg.node()) selectStation(null);
  });
  function moveTo(cx,cy,k,animate=true) {
    const t=d3.zoomIdentity.translate(width/2-k*cx,height/2-k*cy).scale(k);
    if(animate && !reduceMotion) svg.transition().duration(600).call(zoom.transform,t);
    else svg.call(zoom.transform,t);
  }
  function resize() {
    const rect=svg.node().getBoundingClientRect();
    const oldWidth=width,oldHeight=height;
    const transform=d3.zoomTransform(svg.node());
    width=rect.width;height=rect.height;
    svg.attr('viewBox',`0 0 ${width} ${height}`);
    if(!initialized && width && height) {
      initialized=true;
      moveTo(1510,1510,Math.min(.65,Math.max(.32,width/1500)),false);
    } else if(oldWidth && oldHeight && width && height) {
      const center=transform.invert([oldWidth/2,oldHeight/2]);
      moveTo(center[0],center[1],transform.k,false);
    }
  }
  new ResizeObserver(resize).observe(svg.node());
  function rawValue(station,key) {
    const value=metrics[key].get(station,state.period);
    return typeof value==='number' && Number.isFinite(value) && value>=0 ? value : null;
  }
  function weight(station,channel) {
    const value=rawValue(station,state[channel]);
    return value===null || (state[`${channel}Inverse`] && value===0) ? null : state[`${channel}Inverse`] ? 1/value : value;
  }
  function channelStats(channel) {
    const rows=stationVariants.map(s=>({id:s.id,value:rawValue(s,state[channel]),weight:weight(s,channel)})).filter(s=>s.weight!==null);
    return {count:new Set(rows.map(r=>r.id)).size,max:d3.max(rows,d=>d.weight)||1,extent:d3.extent(rows,d=>d.value)};
  }
  function format(value,key,short=false) {
    if(value===null || value===undefined) return 'нет данных';
    if(key==='constant') return '—';
    if(key==='year') return String(value);
    if(short && value>=1e6) return `${nf.format(value/1e6)} млн`;
    if(short && value>=1e3 && metrics[key].flow) return `${nf.format(value/1e3)} тыс.`;
    const unit=key==='total'&&data.periods[state.period]==='mcd-reported'?'поездок/сутки':metrics[key].unit;
    return `${(metrics[key].flow ? integer : nf).format(value)}${unit ? ' '+unit : ''}`;
  }
  const formatStation=(station,key)=>`${key==='age'&&station.agePrecision==='year'?'≈ ':''}${format(rawValue(station,key),key)}`;
  function stationHTML(station,detail=false) {
    const rows=[...new Set([state.size,state.color,'total','age',...(detail?['serviceAge','depth','platforms','tracks','platformLength','platformWidth','timeToCenter','distance','interval']:[])])].filter(k=>k!=='constant'&&([state.size,state.color,'total','age'].includes(k)||rawValue(station,k)!==null));
    const daily=station.reportedDaily;
    const dates=[station.opened?'Открытие: '+station.opened.split('-').reverse().join('.'):null,station.serviceOpened?'В сети метро / МЦД: '+station.serviceOpened.split('-').reverse().join('.'):null].filter(Boolean);
    const openingLink=station.openingSource?`<br><a class="station-source" href="${esc(station.openingSource)}" target="_blank" rel="noopener">Источник даты открытия ↗</a>`:'';
    const facts=detail&&station.metadata?Object.entries(station.metadata).map(([key,value])=>`<div>${esc({type:'Тип',platformType:'Платформы',district:'Расположение'}[key])}: ${esc(value)}</div>`).join(''):'';
    const notes=detail&&station.notes?Object.entries(station.notes).map(([key,value])=>`<div>${esc(metrics[key]?.short||key)}: ${esc(value)}</div>`).join(''):'';
    return `${detail ? '<button class="close" id="detail-close" aria-label="Закрыть станцию">×</button>' : ''}<div class="station-name">${esc(station.name)}</div><div class="station-line"><span class="line-badge" style="background:${esc(station.color)}">${esc(station.line)}</span>${esc(station.lineName)}</div><div class="station-values">${rows.map(key=>`<div class="station-row"><span>${esc(metrics[key].short)}</span><strong>${esc(formatStation(station,key))}</strong></div>`).join('')}</div>${detail ? `<div class="station-date">${dates.map(esc).join('<br>')}${openingLink}</div><div class="station-facts">${facts}${notes}</div>${daily?`<div class="station-daily">МЦД: ${integer.format(daily.value)} поездок/сутки<br><a href="${esc(daily.source)}" target="_blank" rel="noopener">Публикация ${daily.date.split('-').reverse().join('.')}</a></div>`:''}${station.stationUrl?`<a class="station-source" href="${esc(station.stationUrl)}" target="_blank" rel="noopener">Справочник станции ↗</a>`:''}` : ''}`;
  }
  function updateDetail() {
    const panel=byId('station-detail');panel.hidden=!selected;
    if(selected) {panel.innerHTML=stationHTML(selected,true);byId('detail-close').onclick=()=>selectStation(null);}
  }
  function selectStation(station) {
    selected=station;byId('tooltip').hidden=true;
    nodes.classed('is-selected',d=>d.station.id===station?.id);
    updateDetail();
  }
  nodes.on('pointerenter',function(event,d){
    if(event.pointerType==='touch' || selected) return;
    hovered=nearestStation(event);
    const el=byId('tooltip');el.innerHTML=stationHTML(hovered);el.hidden=false;
    placeTooltip(event);
  }).on('pointermove',event=>{if(!byId('tooltip').hidden){const station=nearestStation(event);if(station.id!==hovered?.id||station.line!==hovered?.line){hovered=station;byId('tooltip').innerHTML=stationHTML(station);}placeTooltip(event);}}).on('pointerleave',()=>{hovered=null;byId('tooltip').hidden=true;})
    .on('click',event=>{event.stopPropagation();const station=nearestStation(event);selectStation(selected?.id===station.id&&selected?.line===station.line?null:station);})
    .on('keydown',(event,d)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectStation(d.station);}});
  function placeTooltip(event) {
    const el=byId('tooltip');if(el.hidden) return;
    const [x,y]=d3.pointer(event,svg.node());
    el.style.left=`${Math.max(8,Math.min(width-el.offsetWidth-10,x+17))}px`;
    el.style.top=`${Math.max(8,Math.min(height-el.offsetHeight-12,y+12))}px`;
  }
  function update(animate=true) {
    const ss=channelStats('size'),cs=channelStats('color');
    const radius=d=>{const w=weight(d.station,'size');return w===null ? d.station.r : state.size==='constant' ? d.station.r*state.amplitude/100 : Math.max(2.5,26*state.amplitude/100*Math.sqrt(w/ss.max));};
    const tone=(color,t)=>{const c=d3.hsl(color);c.l=.84-.59*t;return c.formatHex();};
    const fill=d=>{const w=weight(d.station,'color');if(state.color==='constant')return d.station.color;if(w===null){const c=d3.hsl(d.station.color);c.l=.93;return c.formatHex();}return tone(d.station.color,w/cs.max);};
    const circles=nodes.select('.station-circle');circles.interrupt();
    (animate?circles.transition().duration(duration).ease(d3.easeCubicInOut):circles).attr('r',radius).attr('fill',fill)
      .attr('stroke','none').attr('stroke-dasharray',null);
    nodes.attr('aria-label',d=>`${d.station.name}, ${d.station.lineName}. ${metrics[state.size].short}: ${format(rawValue(d.station,state.size),state.size)}. ${metrics[state.color].short}: ${format(rawValue(d.station,state.color),state.color)}.`);
    labels.style('display',state.labels?null:'none');
    for(const channel of ['size','color']) {
      byId(`${channel}-metric`).value=state[channel];
      document.querySelectorAll(`[data-channel="${channel}"]`).forEach(button=>button.setAttribute('aria-pressed',String(state[`${channel}Inverse`] === (button.dataset.inverse==='true'))));
    }
    byId('size-hint').textContent=state.size==='constant'?'Исходный размер кружков Яндекс Метро':state.sizeInverse?'Площадь кружка ∝ 1 / показатель':'Площадь кружка ∝ показатель';
    byId('color-hint').textContent=state.color==='constant'?'Исходный цвет ветки Яндекс Метро':state.colorInverse?'Цвет ветки · меньше значение — темнее':'Цвет ветки · больше значение — темнее';
    byId('period').value=state.period;
    byId('period-section').hidden=!(metrics[state.size].flow || metrics[state.color].flow);
    byId('period-hint').textContent=data.periods[state.period]==='mcd-reported'?'Часть станций МЦД · публикации 2025–2026 · разные даты и методики':'Метро и МЦК · сумма входов и выходов за квартал';
    byId('amplitude').value=state.amplitude;byId('amplitude-value').textContent=state.amplitude+'%';
    byId('labels').checked=state.labels;
    const zeroMessage=['size','color'].some(c=>state[`${c}Inverse`] && stationVariants.some(s=>rawValue(s,state[c])===0))?' · 0 исключён из обратной шкалы':'';
    byId('coverage').textContent=`Данные: размер ${ss.count}/${data.stations.length} · светлота ${cs.count}/${data.stations.length}. Пропуски — мелкие / бледные точки${zeroMessage}.`;
    byId('map-caption').textContent=`${metrics[state.size].short}${state.sizeInverse?' ⁻¹':''} × ${metrics[state.color].short}${state.colorInverse?' ⁻¹':''}`;
    byId('legend').hidden=state.color==='constant'||!cs.count;
    byId('legend-title').textContent=metrics[state.color].label;
    byId('legend-start').textContent=format(cs.extent[state.colorInverse?1:0],state.color,true);
    byId('legend-end').textContent=format(cs.extent[state.colorInverse?0:1],state.color,true);
    // Use the same domain as the mark fill: zero-to-max, or reciprocal.
    const minWeight=state.colorInverse?1/cs.extent[1]:cs.extent[0];
    document.querySelector('.gradient').style.background='none';
    document.querySelector('.gradient').innerHTML=['#da2128','#48b85e','#0078bf'].map(color=>`<span style="background:linear-gradient(to right,${tone(color,minWeight/cs.max)},${tone(color,1)})"></span>`).join('');
    if(hovered&&!byId('tooltip').hidden) byId('tooltip').innerHTML=stationHTML(hovered);
    updateDetail();persist();
  }
  for(const channel of ['size','color']) {
    const select=byId(`${channel}-metric`);
    for(const [key,metric] of Object.entries(metrics)){const option=document.createElement('option');option.value=key;option.textContent=key==='constant'&&channel==='color'?'Цвет ветки':metric.label;select.append(option);}
    select.addEventListener('change',()=>{state[channel]=select.value;update();});
  }
  for(let i=data.periods.length-1;i>=0;i--){const option=document.createElement('option');option.value=i;option.textContent=periodText(data.periods[i]);byId('period').append(option);}
  document.querySelectorAll('[data-channel]').forEach(button=>button.onclick=()=>{state[button.dataset.channel+'Inverse']=button.dataset.inverse==='true';update();});
  byId('period').onchange=event=>{state.period=Number(event.target.value);update();};
  byId('amplitude').oninput=event=>{state.amplitude=Number(event.target.value);update(false);};
  byId('labels').onchange=event=>{state.labels=event.target.checked;update(false);};
  byId('zoom-in').onclick=()=>svg.transition().duration(reduceMotion?0:300).call(zoom.scaleBy,1.5);
  byId('zoom-out').onclick=()=>svg.transition().duration(reduceMotion?0:300).call(zoom.scaleBy,1/1.5);
  byId('fit').onclick=()=>moveTo(data.size.width/2,data.size.height/2,Math.min((width-55)/data.size.width,(height-55)/data.size.height));
  byId('sources-open').onclick=()=>byId('sources').showModal();
  byId('sources-close').onclick=()=>byId('sources').close();
  byId('sources').onclick=event=>{if(event.target===byId('sources')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}};
  document.addEventListener('keydown',event=>{if(event.key==='Escape')selectStation(null);});
  if(data.coverage){const c=data.coverage.counts,m=data.coverage.mcdCounts;byId('coverage-details').textContent=`Станций: ${data.coverage.stations}, из них МЦД: ${data.coverage.mcdStations}. Возраст: ${c.age} (МЦД ${m.age}); платформы: ${c.platforms} (МЦД ${m.platforms}); пути: ${c.tracks} (МЦД ${m.tracks}); длина платформ: ${c.platformLength}; ширина: ${c.platformWidth}; глубина: ${c.depth}. Суточные публикации МЦД: ${c.reportedDaily} станций. Прочитано ${data.coverage.articles} индивидуальных справочных карточек.`;}
  update(false);
})();
