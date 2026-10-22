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
  const periodText = period => {const [year, q] = period.split('-Q'); return `${['I','II','III','IV'][Number(q)-1]} квартал ${year}`;};
  const traffic = (station, p) => station.traffic[p];
  const metrics = {
    incoming: {label:'Входы пассажиров', short:'Входы', unit:'проходов', flow:true, get:(s,p)=>traffic(s,p)?.[0]},
    outgoing: {label:'Выходы пассажиров', short:'Выходы', unit:'проходов', flow:true, get:(s,p)=>traffic(s,p)?.[1]},
    total: {label:'Входы + выходы', short:'Пассажиропоток', unit:'проходов', flow:true, get:(s,p)=>traffic(s,p) ? traffic(s,p)[0]+traffic(s,p)[1] : null},
    age: {label:'Возраст станции', short:'Возраст', unit:'лет', get:s=>s.age},
    year: {label:'Год открытия', short:'Год открытия', unit:'', get:s=>s.year},
    depth: {label:'Глубина', short:'Глубина', unit:'м', get:s=>s.depth},
    distance: {label:'Расстояние до центра', short:'До центра', unit:'км', get:s=>s.distance},
    imbalance: {label:'Дисбаланс входов и выходов', short:'Дисбаланс', unit:'%', flow:true, get:(s,p)=>{const f=traffic(s,p); return f && f[0]+f[1] ? Math.abs(f[0]-f[1])/(f[0]+f[1])*100 : null;}},
    constant: {label:'Одинаково для всех', short:'Без показателя', unit:'', get:()=>1}
  };
  const defaults = {size:'total', color:'age', sizeInverse:false, colorInverse:false, period:data.periods.length-1, amplitude:100, labels:true};
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
  const markers = data.stations.flatMap(station=>station.points.map((point,index)=>({station,point,key:`${station.id}-${index}`})));
  const hitIndex = d3.Delaunay.from(markers,d=>d.point[0],d=>d.point[1]);
  const nearestStation = event => {
    const point=d3.zoomTransform(svg.node()).invert(d3.pointer(event,svg.node()));
    return markers[hitIndex.find(point[0],point[1])].station;
  };
  const nodes = viewport.append('g').attr('class','metric-layer').selectAll('g').data(markers,d=>d.key).join('g')
    .attr('class','station-node').attr('transform',d=>`translate(${d.point.join(',')})`)
    .attr('tabindex',0).attr('role','button').attr('aria-label',d=>`${d.station.name}, ${d.station.lineName}`);
  nodes.append('circle').attr('class','station-circle').attr('r',5).attr('fill','#fff').attr('stroke',d=>d.station.color);
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
    const rows=data.stations.map(s=>({value:rawValue(s,state[channel]),weight:weight(s,channel)})).filter(s=>s.weight!==null);
    return {count:rows.length,max:d3.max(rows,d=>d.weight)||1,extent:d3.extent(rows,d=>d.value)};
  }
  function format(value,key,short=false) {
    if(value===null || value===undefined) return 'нет данных';
    if(key==='constant') return '—';
    if(key==='year') return String(value);
    if(short && value>=1e6) return `${nf.format(value/1e6)} млн`;
    if(short && value>=1e3 && metrics[key].flow && key!=='imbalance') return `${nf.format(value/1e3)} тыс.`;
    return `${(metrics[key].flow && key!=='imbalance' ? integer : nf).format(value)}${metrics[key].unit ? ' '+metrics[key].unit : ''}`;
  }
  function stationHTML(station,detail=false) {
    const rows=[...new Set([state.size,state.color,'total','age','depth','distance'])].filter(k=>k!=='constant');
    return `${detail ? '<button class="close" id="detail-close" aria-label="Закрыть станцию">×</button>' : ''}<div class="station-name">${esc(station.name)}</div><div class="station-line"><span class="line-badge" style="background:${esc(station.color)}">${esc(station.line)}</span>${esc(station.lineName)}</div><div class="station-values">${rows.map(key=>`<div class="station-row"><span>${esc(metrics[key].short)}</span><strong>${esc(format(rawValue(station,key),key))}</strong></div>`).join('')}</div>${detail ? `<div class="station-date">${periodText(data.periods[state.period])}${station.opened ? '<br>Открытие: '+station.opened.split('-').reverse().join('.') : ''}</div>` : ''}`;
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
  }).on('pointermove',event=>{if(!byId('tooltip').hidden){const station=nearestStation(event);if(station.id!==hovered?.id){hovered=station;byId('tooltip').innerHTML=stationHTML(station);}placeTooltip(event);}}).on('pointerleave',()=>{hovered=null;byId('tooltip').hidden=true;})
    .on('click',event=>{event.stopPropagation();const station=nearestStation(event);selectStation(selected?.id===station.id?null:station);})
    .on('keydown',(event,d)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectStation(d.station);}});
  function placeTooltip(event) {
    const el=byId('tooltip');if(el.hidden) return;
    const [x,y]=d3.pointer(event,svg.node());
    el.style.left=`${Math.max(8,Math.min(width-el.offsetWidth-10,x+17))}px`;
    el.style.top=`${Math.max(8,Math.min(height-el.offsetHeight-12,y+12))}px`;
  }
  function update(animate=true) {
    const ss=channelStats('size'),cs=channelStats('color');
    const radius=d=>{const w=weight(d.station,'size');return w===null ? 4 : state.size==='constant' ? 7*state.amplitude/100 : Math.max(2.5,26*state.amplitude/100*Math.sqrt(w/ss.max));};
    const fill=d=>{const w=weight(d.station,'color');return w===null ? '#fff' : state.color==='constant' ? '#f1f0eb' : d3.interpolateLab('#f3f2ef','#2f3540')(w/cs.max);};
    const circles=nodes.select('.station-circle');circles.interrupt();
    (animate?circles.transition().duration(duration).ease(d3.easeCubicInOut):circles).attr('r',radius).attr('fill',fill)
      .attr('stroke',d=>weight(d.station,'size')===null || weight(d.station,'color')===null ? '#a9b0b5' : d.station.color)
      .attr('stroke-dasharray',d=>weight(d.station,'size')===null || weight(d.station,'color')===null ? '3 3' : null);
    nodes.attr('aria-label',d=>`${d.station.name}, ${d.station.lineName}. ${metrics[state.size].short}: ${format(rawValue(d.station,state.size),state.size)}. ${metrics[state.color].short}: ${format(rawValue(d.station,state.color),state.color)}.`);
    labels.style('display',state.labels?null:'none');
    for(const channel of ['size','color']) {
      byId(`${channel}-metric`).value=state[channel];
      document.querySelectorAll(`[data-channel="${channel}"]`).forEach(button=>button.setAttribute('aria-pressed',String(state[`${channel}Inverse`] === (button.dataset.inverse==='true'))));
    }
    byId('size-hint').textContent=state.size==='constant'?'Один размер для всех станций':state.sizeInverse?'Площадь кружка ∝ 1 / показатель':'Площадь кружка ∝ показатель';
    byId('color-hint').textContent=state.color==='constant'?'Одна светлота для всех станций':state.colorInverse?'Меньше значение — темнее станция':'Больше значение — темнее станция';
    byId('period').value=state.period;
    byId('period-section').hidden=!(metrics[state.size].flow || metrics[state.color].flow);
    byId('amplitude').value=state.amplitude;byId('amplitude-value').textContent=state.amplitude+'%';
    byId('labels').checked=state.labels;
    const zeroMessage=['size','color'].some(c=>state[`${c}Inverse`] && data.stations.some(s=>rawValue(s,state[c])===0))?' · 0 исключён из обратной шкалы':'';
    byId('coverage').textContent=`Данные: размер ${ss.count}/${data.stations.length} · светлота ${cs.count}/${data.stations.length}. Пунктир — нет значения${zeroMessage}.`;
    byId('map-caption').textContent=`${metrics[state.size].short}${state.sizeInverse?' ⁻¹':''} × ${metrics[state.color].short}${state.colorInverse?' ⁻¹':''}`;
    byId('legend').hidden=state.color==='constant'||!cs.count;
    byId('legend-title').textContent=metrics[state.color].label;
    byId('legend-start').textContent=format(cs.extent[state.colorInverse?1:0],state.color,true);
    byId('legend-end').textContent=format(cs.extent[state.colorInverse?0:1],state.color,true);
    // Use the same domain as the mark fill: zero-to-max, or reciprocal.
    const minWeight=state.colorInverse?1/cs.extent[1]:cs.extent[0];
    const pale=d3.interpolateLab('#f3f2ef','#2f3540')(minWeight/cs.max);
    document.querySelector('.gradient').style.background=`linear-gradient(to right,${pale},#2f3540)`;
    if(hovered&&!byId('tooltip').hidden) byId('tooltip').innerHTML=stationHTML(hovered);
    updateDetail();persist();
  }
  for(const channel of ['size','color']) {
    const select=byId(`${channel}-metric`);
    for(const [key,metric] of Object.entries(metrics)){const option=document.createElement('option');option.value=key;option.textContent=metric.label;select.append(option);}
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
  update(false);
})();
