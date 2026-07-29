const $=id=>document.getElementById(id);
let room=null,playerId=null,sessionToken=null,state=null,events=null,selected=new Set(),lastSpoken=null,countdownTick=null,wakeLock=null,announceTimer=null,reconnectTimer=null,resumeInProgress=false,soundEnabled=localStorage.getItem('iprSound')!=='off';
const audioPrefs=(()=>{try{return {...{music:true,effects:true,voice:true,musicVolume:.35,effectsVolume:.55},...JSON.parse(localStorage.getItem('iprAudioPrefs')||'{}')}}catch{return {music:true,effects:true,voice:true,musicVolume:.35,effectsVolume:.55}}})();
const getProfile=()=>{try{return JSON.parse(localStorage.getItem('iprGamerProfile')||'null')||{}}catch{return {}}};
const saveProfile=(p=me())=>{const current=getProfile();const profile={name:(p?.name||$('name').value.trim()||current.name||'').slice(0,24),balance:Number(p?.balance??current.balance??20)};localStorage.setItem('iprGamerProfile',JSON.stringify(profile));$('homeBalance').textContent=profile.balance.toFixed(2);if(!$('name').value)$('name').value=profile.name||'';return profile};
const traditional={1:'el primero de todos',2:'el patito',3:'San Cono',4:'la silla',5:'la mano',7:'el número de la suerte',8:'la samba',10:'la decena',11:'las piernas de la señorita',13:'la mala suerte',15:'la quinceañera',18:'la mayoría de edad',22:'los dos patitos',25:'Navidad',30:'las tres décadas',33:'la edad de Cristo',44:'las dos sillas',50:'medio siglo',55:'las dos manos',66:'las dos medias docenas',69:'arriba y abajo',75:'el último del bingo'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const api=async(path,body,retries=1)=>{let lastError;for(let attempt=0;attempt<=retries;attempt++){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Error de conexión');return data}catch(err){lastError=err;if(attempt<retries){$('connection').textContent='Conectando…';await sleep(1200)}}finally{clearTimeout(timer)}}throw new Error(lastError?.name==='AbortError'?'El servidor tardó demasiado. Intenta nuevamente.':lastError?.message||'Error de conexión')};
const toast=msg=>{$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2600)};
const activeView=()=>document.querySelector('.view.active')?.id;
const show=id=>{const current=activeView();document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));if(current!==id)window.scrollTo({top:0,behavior:'smooth'});setTimeout(syncMusicForView,0)};
const me=()=>state?.players.find(p=>p.id===playerId);
const AudioEngine=(()=>{
 let ctx=null,master=null,musicGain=null,effectsGain=null,mode='home',timer=null,nextAt=0,step=0;
 const themes={
  home:{tempo:1.05,chords:[[261.63,329.63,392],[293.66,369.99,440],[220,277.18,329.63],[246.94,311.13,369.99]]},
  lobby:{tempo:1.25,chords:[[261.63,329.63,392],[220,261.63,329.63],[174.61,220,261.63],[196,246.94,293.66]]},
  game:{tempo:.82,chords:[[220,261.63,329.63],[196,246.94,293.66],[174.61,220,261.63],[196,233.08,293.66]]},
  result:{tempo:.95,chords:[[261.63,329.63,392],[329.63,415.3,493.88],[392,493.88,587.33],[523.25,659.25,783.99]]}
 };
 function ensure(){if(ctx)return ctx;const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;ctx=new C();master=ctx.createGain();musicGain=ctx.createGain();effectsGain=ctx.createGain();master.gain.value=soundEnabled?1:0;musicGain.gain.value=audioPrefs.music?audioPrefs.musicVolume:0;effectsGain.gain.value=audioPrefs.effects?audioPrefs.effectsVolume:0;musicGain.connect(master);effectsGain.connect(master);master.connect(ctx.destination);return ctx}
 async function unlock(){const c=ensure();if(!c)return false;if(c.state==='suspended')await c.resume().catch(()=>{});apply();startMusic();return c.state==='running'}
 function note(freq,start,duration,gain=.025,type='sine',destination=musicGain){const c=ensure();if(!c||!destination)return;const o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(freq,start);g.gain.setValueAtTime(.0001,start);g.gain.exponentialRampToValueAtTime(Math.max(.0002,gain),start+.05);g.gain.exponentialRampToValueAtTime(.0001,start+duration);o.connect(g);g.connect(destination);o.start(start);o.stop(start+duration+.03)}
 function schedule(){if(!ctx||ctx.state!=='running'||!soundEnabled||!audioPrefs.music)return;const t=themes[mode]||themes.home;while(nextAt<ctx.currentTime+1.5){const chord=t.chords[step%t.chords.length];chord.forEach((f,i)=>note(f,nextAt,t.tempo*.92,.095-(i*.012),i===0?'triangle':'sine'));note(chord[0]/2,nextAt,t.tempo*.72,.055,'sine');if(mode==='game')note(chord[1]*2,nextAt+t.tempo*.52,.16,.035,'triangle');nextAt+=t.tempo;step++}}
 function startMusic(){if(!ensure()||timer)return;nextAt=ctx.currentTime+.08;timer=setInterval(schedule,300);schedule()}
 function stopMusic(){clearInterval(timer);timer=null}
 function setMode(next){if(!themes[next])next='home';if(mode!==next){mode=next;step=0;if(ctx)nextAt=ctx.currentTime+.12}startMusic()}
 function effect(freq=440,duration=.12,type='sine',gain=.08,delay=0){if(!soundEnabled||!audioPrefs.effects)return;const c=ensure();if(!c)return;note(freq,c.currentTime+delay,duration,gain,type,effectsGain)}
 function win(){[523,659,784,1046].forEach((f,i)=>effect(f,.34,'triangle',.14,i*.14));[392,523,659].forEach((f,i)=>effect(f,.65,'sine',.07,.62+i*.04))}
 function apply(){if(!ensure())return;master.gain.setTargetAtTime(soundEnabled?1:0,ctx.currentTime,.03);musicGain.gain.setTargetAtTime(soundEnabled&&audioPrefs.music?audioPrefs.musicVolume:0,ctx.currentTime,.08);effectsGain.gain.setTargetAtTime(soundEnabled&&audioPrefs.effects?audioPrefs.effectsVolume:0,ctx.currentTime,.03);if(soundEnabled&&audioPrefs.music)startMusic();else stopMusic()}
 return {unlock,setMode,effect,win,apply,startMusic,stopMusic};
})();
const saveAudioPrefs=()=>{localStorage.setItem('iprAudioPrefs',JSON.stringify(audioPrefs));AudioEngine.apply()};
const tone=(freq=440,duration=.12,type='sine',gain=.05)=>AudioEngine.effect(freq,duration,type,gain);
const winSound=()=>AudioEngine.win();
function updateSoundButton(){const b=$('soundToggle');if(b){b.textContent=soundEnabled?'🔊':'🔇';b.setAttribute('aria-label',soundEnabled?'Desactivar audio':'Activar audio')}const h=$('heroSound');if(h)h.textContent=soundEnabled?'🔊':'🔇'}
const speak=text=>{if(!soundEnabled||!audioPrefs.voice||!('speechSynthesis'in window))return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='es-PE';u.rate=.86;u.volume=Math.min(1,.65+audioPrefs.effectsVolume*.35);speechSynthesis.speak(u)};
function stopNarration(resetLast=false){clearTimeout(announceTimer);announceTimer=null;if('speechSynthesis'in window)speechSynthesis.cancel();if(resetLast)lastSpoken=null}
function syncMusicForView(){const view=activeView();const mode=view==='game'?'game':view==='result'?'result':view==='lobby'?'lobby':'home';AudioEngine.setMode(mode)}
document.addEventListener('pointerdown',()=>AudioEngine.unlock(),{passive:true});document.addEventListener('keydown',()=>AudioEngine.unlock(),{passive:true});
const letter=n=>n<=15?'B':n<=30?'I':n<=45?'N':n<=60?'G':'O';
function announce(n){if(!room||state?.phase!=='playing'||me()?.inGameView===false)return;stopNarration(false);tone(740,.1,'sine',.055);setTimeout(()=>{if(room&&state?.phase==='playing'&&me()?.inGameView!==false)tone(980,.12,'sine',.045)},100);const phrase=traditional[n]?`¡Sale ${traditional[n]}! Número ${n}.`:`¡Sale ${letter(n)} ${n}!`;$('spoken').textContent=phrase;if(soundEnabled)speak(phrase);announceTimer=setTimeout(()=>{if(soundEnabled&&room&&state?.phase==='playing'&&me()?.inGameView!==false)speak(`Repito: ${letter(n)}, ${n}.`)},1500)}
async function requestWakeLock(){try{if('wakeLock'in navigator&&document.visibilityState==='visible')wakeLock=await navigator.wakeLock.request('screen')}catch{}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){stopNarration(false);AudioEngine.stopMusic();return}if(room)requestWakeLock();syncMusicForView()});
function save(){localStorage.setItem('iprGamerSession',JSON.stringify({room,sessionToken,name:$('name').value.trim()}));saveProfile()}
function clearSession(){localStorage.removeItem('iprGamerSession')}
async function resumeConnection(){if(resumeInProgress||!room||!sessionToken||!navigator.onLine)return;resumeInProgress=true;try{const data=await api('/api/resume',{code:room,sessionToken},0);playerId=data.playerId;state=data.state;save();connect();render()}catch{}finally{resumeInProgress=false}}

function showFloatingReaction(d={}){
 const layer=document.createElement('div');
 layer.className='floating-reaction';
 layer.style.left=`${8+Math.random()*78}%`;
 layer.style.setProperty('--drift',`${-80+Math.random()*160}px`);
 layer.innerHTML=`<span>${escapeHtml(d.emoji||'🎉')}</span><small>${escapeHtml(d.name||'')}</small>`;
 document.body.appendChild(layer);
 setTimeout(()=>layer.remove(),2600);
}

function connect(){clearTimeout(reconnectTimer);if(events)events.close();$('connection').textContent='Conectando…';$('connection').classList.remove('online');events=new EventSource(`/api/events?code=${encodeURIComponent(room)}&playerId=${encodeURIComponent(playerId)}`);events.addEventListener('open',()=>{$('connection').textContent='Conectado';$('connection').classList.add('online')});events.addEventListener('state',e=>{state=JSON.parse(e.data);$('connection').textContent='Conectado';$('connection').classList.add('online');render()});events.addEventListener('celebration',e=>{const d=JSON.parse(e.data);showCelebration(d)});events.addEventListener('reaction',e=>{const d=JSON.parse(e.data);showFloatingReaction(d);tone(860,.09,'sine',.04)});events.onerror=()=>{$('connection').textContent=navigator.onLine?'Reconectando…':'Sin internet';$('connection').classList.remove('online');clearTimeout(reconnectTimer);reconnectTimer=setTimeout(resumeConnection,3500)}}
window.addEventListener('online',()=>{if(room){$('connection').textContent='Reconectando…';resumeConnection()}});window.addEventListener('offline',()=>{stopNarration(false);$('connection').textContent='Sin internet';$('connection').classList.remove('online')});
async function enter(data){room=data.code;playerId=data.playerId;sessionToken=data.sessionToken;state=data.state;save();connect();requestWakeLock();render()}
function inviteUrl(){
 const url=new URL(location.href);
 url.search='';url.hash='';
 url.searchParams.set('sala',String(room||'').trim().toUpperCase());
 return url.toString();
}
function renderPlayers(target){target.innerHTML=state.players.map(p=>`<div class="player"><span>${p.host?'👑 ':''}${escapeHtml(p.name)} ${p.id===playerId?'(tú)':''}</span><span class="${p.ready?'ready':'waiting-text'}">${p.online?'● conectado':'○ desconectado'} · ${p.ready?`${p.cardIds.length} cartillas`:'sin confirmar'}</span></div>`).join('')}
function renderChat(target){target.innerHTML=state.chat.map(m=>`<div class="message ${m.kind==='system'?'system':''}"><b>${escapeHtml(m.name)}:</b> ${escapeHtml(m.text)}</div>`).join('');target.scrollTop=target.scrollHeight}
function formatDate(ts){return new Date(ts).toLocaleString('es-PE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
function renderHistory(){const stats=state.myStats||{},history=state.myHistory||[];$('statGames').textContent=stats.games||0;$('statWins').textContent=stats.wins||0;$('statWon').textContent=Number(stats.won||0).toFixed(2);$('statSpent').textContent=Number(stats.spent||0).toFixed(2);$('playerHistory').innerHTML=history.length?history.map(m=>`<div class="history-row"><div><b>${escapeHtml(m.type)}</b><small>${escapeHtml(m.detail||'')} · ${formatDate(m.time)}</small></div><strong class="${Number(m.amount)>=0?'gain':'expense'}">${Number(m.amount)>=0?'+':''}${Number(m.amount).toFixed(2)}</strong></div>`).join(''):'<div class="notice">Todavía no tienes movimientos.</div>'}
function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function makeCard(id){let seed=(id*2654435761)>>>0;const rnd=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296};const out=[];for(let c=0;c<5;c++){const nums=[];while(nums.length<5){const n=1+c*15+Math.floor(rnd()*15);if(!nums.includes(n))nums.push(n)}nums.sort((a,b)=>a-b);for(let r=0;r<5;r++)out[r*5+c]={value:(r===2&&c===2)?'★':nums[r],free:r===2&&c===2}}return out}
function renderCards(){const p=me(),letters=['b','i','n','g','o'];$('cards').innerHTML=(p?.cardIds||[]).map(id=>`<div class="bingo-card"><div class="card-title">Cartilla ${id}</div><div class="bingo-letters"><b class="col-b">B</b><b class="col-i">I</b><b class="col-n">N</b><b class="col-g">G</b><b class="col-o">O</b></div><div class="card-grid">${makeCard(id).map((c,i)=>`<div class="cell col-${letters[i%5]} ${c.free?'free':''} ${c.free||state.drawn.includes(c.value)?'hit':''}">${c.value}</div>`).join('')}</div></div>`).join('')||'<div class="notice">Aún no elegiste cartillas.</div>'}
function renderPicker(){const taken=state.takenCards||{};const letters=['B','I','N','G','O'];$('cardPicker').innerHTML=Array.from({length:100},(_,i)=>i+1).map(id=>{const mine=me()?.cardIds?.includes(id),blocked=taken[id]&&taken[id]!==playerId,mini=makeCard(id);return `<button class="pick ${selected.has(id)?'selected':''} ${mine?'mine':''} ${blocked?'taken':''}" data-id="${id}" ${blocked?'disabled':''}><span class="pick-top"><b class="pick-title">Cartilla ${id}</b><span class="pick-state">${blocked?'Ocupada':selected.has(id)?'✓ Tu selección':mine?'Tu cartilla anterior':'Disponible'}</span></span><span class="mini-letters">${letters.map((l,j)=>`<b class="mini-col-${j}">${l}</b>`).join('')}</span><span class="mini-grid">${mini.map((c,j)=>`<span class="mini-col-${j%5} ${c.free?'mini-free':''}">${c.free?'★':c.value}</span>`).join('')}</span></button>`}).join('');$('selectedCount').textContent=selected.size;document.querySelectorAll('.pick:not(:disabled)').forEach(b=>b.onclick=()=>{const id=Number(b.dataset.id);selected.has(id)?selected.delete(id):selected.size<8?selected.add(id):toast('Máximo 8 cartillas');renderPicker()})}

function renderPremium(){
  const p=me(),stats=state.myStats||{};
  $('dashName').textContent=p?.name||'—';$('dashWins').textContent=stats.wins||0;$('dashCards').textContent=p?.cardIds?.length||0;$('dashWon').textContent=Number(stats.won||0).toFixed(2);
  $('gamePlayerName').textContent=p?.name||'—';$('gameWins').textContent=stats.wins||0;
  const medals=['🥇','🥈','🥉'];
  $('roomRanking').innerHTML=(state.ranking||[]).length?(state.ranking||[]).map((r,i)=>`<div class="rank-row ${r.id===playerId?'me-rank':''}"><span><b>${medals[i]||'#'+(i+1)}</b> ${escapeHtml(r.name)}${r.id===playerId?' (tú)':''}</span><strong>${r.wins} victoria${r.wins===1?'':'s'} · ${Number(r.won||0).toFixed(2)}</strong></div>`).join(''):'<div class="notice">Aún no hay posiciones.</div>';
  $('lastWinners').innerHTML=(state.lastWinners||[]).length?(state.lastWinners||[]).map(w=>`<div class="rank-row"><span>${w.apagon?'🔥':'🏆'} ${escapeHtml(w.name)}</span><strong>+${Number(w.prize||0).toFixed(2)}</strong></div>`).join(''):'<div class="notice">Todavía no hay ganadores.</div>';
}
function showCelebration(d){stopNarration(false);AudioEngine.stopMusic();const layer=$('celebrationLayer');if(!layer)return;layer.innerHTML=`<div class="celebration-card"><div class="celebration-trophy">${d.apagon?'🔥':'🏆'}</div><h2>${escapeHtml(d.name)}</h2><p>${d.apagon?'¡Ganó el APAGÓN!':'¡Hizo BINGO!'}</p><strong>+${Number(d.prize||0).toFixed(2)} créditos</strong></div>`;layer.classList.remove('hidden');winSound();setTimeout(()=>{layer.classList.add('hidden');if(room&&state?.phase==='finished')syncMusicForView()},4200)}

function showCountdown(){if(state.phase!=='countdown'){$('countdown').classList.add('hidden');clearInterval(countdownTick);countdownTick=null;return}const update=()=>{const ms=(state.countdownEndsAt||0)-Date.now();const n=Math.max(0,Math.ceil(ms/1000));$('countdown').classList.remove('hidden');$('countdownNumber').textContent=n>0?n:'¡Juega!';$('countdownNumber').style.animation='none';void $('countdownNumber').offsetWidth;$('countdownNumber').style.animation='pulse .8s ease'};update();if(!countdownTick)countdownTick=setInterval(update,250)}
function render(){if(!state)return;const p=me();saveProfile(p);$('roomCode').textContent=room;$('gameRoom').textContent=room;$('balance').textContent=Number(p?.balance||0).toFixed(2);$('gameBalance').textContent=Number(p?.balance||0).toFixed(2);$('resultBalance').textContent=Number(p?.balance||0).toFixed(2);$('inviteLink').value=inviteUrl();$('gameNo').textContent=state.gameInCycle;$('gamePot').textContent=Number((state.gamePot||0)+(state.gameInCycle===10?state.apagonJackpot||0:0)).toFixed(2);$('apagonBadge').textContent=state.gameInCycle===10?'⚡ APAGÓN':'Bingo normal';$('apagonBadge').classList.toggle('active',state.gameInCycle===10);const remain=Math.max(0,Math.ceil((Number(state.selectionEndsAt||0)-Date.now())/1000));if($('selectionTimer'))$('selectionTimer').textContent=`${String(Math.floor(remain/60)).padStart(2,'0')}:${String(remain%60).padStart(2,'0')}`;renderPlayers($('players'));renderPlayers($('gamePlayers'));renderChat($('chatLobby'));renderChat($('chatGame'));$('hostHelp').classList.toggle('hidden',!p?.host);$('openRoomAdmin').classList.toggle('hidden',!p?.host);$('start').classList.toggle('hidden',!p?.host);$('startFromGame').classList.toggle('hidden',!p?.host);$('next').classList.toggle('hidden',!p?.host);$('nextLobby').classList.toggle('hidden',!p?.host||state.phase!=='finished');$('hostControls').classList.toggle('hidden',!p?.host||state.phase!=='playing');$('toggleAuto').textContent=state.auto?'Pausar canto':'Reanudar canto';$('waiting').classList.toggle('hidden',state.phase!=='lobby'||!p?.inGameView);$('backLobby').classList.toggle('hidden',state.phase!=='lobby');const canChoose=state.phase==='lobby';$('chooseCards').disabled=!canChoose;$('chooseCards').textContent=canChoose?(p?.cardIds?.length?'Revisar o cambiar mis cartillas':'Elegir cartillas'):'Esperando siguiente juego';$('cardsStatus').textContent=state.phase==='finished'?'El anfitrión debe presionar “Siguiente juego”. Tus cartillas actuales quedarán reservadas para que puedas mantenerlas o cambiarlas.':state.phase==='lobby'?(p?.cardIds?.length?`Tienes ${p.cardIds.length} cartilla(s) reservada(s). Ábrelas para conservarlas o elegir otras.`:'Selecciona mínimo 2 cartillas para participar.'):'La selección está cerrada mientras la partida está en curso.';
 if(state.phase==='countdown'||state.phase==='playing')show(p?.ready?'game':'lobby');else if(state.phase==='finished')show(p?.inGameView===false?'lobby':'result');else if(state.phase==='lobby')show(p?.inGameView?'game':'lobby');
 $('phaseLabel').textContent=state.phase==='lobby'?'Esperando':state.phase==='countdown'?'Preparados':state.phase==='playing'?(state.auto?'Canto automático':'Canto pausado'):'Finalizado';const ball=$('ball');ball.innerHTML=state.current?`<span class="ball-letter">${letter(state.current)}</span><span class="ball-number">${state.current}</span>`:'<span class="ball-letter">—</span><span class="ball-number">—</span>';if(state.current&&state.current!==lastSpoken){ball.classList.remove('ball-pop');void ball.offsetWidth;ball.classList.add('ball-pop')}$('spoken').textContent=state.current?`Bolilla ${letter(state.current)} ${state.current}`:'Última bolilla';$('drawn').innerHTML=(state.drawn||[]).map(n=>`<span class="drawn-${letter(n).toLowerCase()}">${letter(n)} ${n}</span>`).join('');
 if(state.phase!=='playing'||p?.inGameView===false)stopNarration(false);if(state.phase==='playing'&&p?.inGameView!==false&&state.current&&state.current!==lastSpoken){lastSpoken=state.current;announce(state.current)}renderCards();renderHistory();renderPremium();$('winner').textContent=state.winner?`🏆 ${state.winner}`:'Juego finalizado';showCountdown()}
function openCards(){if(!state)return;if(state.phase==='finished')return toast('El anfitrión debe presionar Siguiente juego antes de elegir nuevas cartillas');if(state.phase!=='lobby')return toast('La partida ya comenzó');selected=new Set(me()?.cardIds||[]);renderPicker();$('cardsModal').classList.add('show');$('cardsModal').setAttribute('aria-hidden','false');document.body.style.overflow='hidden'}
function closeCards(){$('cardsModal').classList.remove('show');$('cardsModal').setAttribute('aria-hidden','true');document.body.style.overflow=''}
async function sendChat(input){const text=input.value.trim();if(!text)return;await api('/api/action',{code:room,playerId,type:'chat',text});input.value=''}
async function startGame(){try{await api('/api/action',{code:room,playerId,type:'start'})}catch(e){toast(e.message)}}
async function returnToRoomLobby(message='¿Volver al lobby de la sala?'){
 if(!confirm(message))return;
 stopNarration(true);
 try{await api('/api/action',{code:room,playerId,type:'leaveToLobby'})}catch(e){return toast(e.message)}
 toast('Volviste al lobby de la sala');
}
async function leaveRoomCompletely(){
 if(!confirm('¿Estás seguro de que quieres salir completamente de esta sala?'))return;
 saveProfile();
 stopNarration(true);AudioEngine.stopMusic();
 try{await api('/api/action',{code:room,playerId,type:'abandon'})}catch{}
 events?.close();events=null;clearSession();room=null;playerId=null;sessionToken=null;state=null;lastSpoken=null;
 history.replaceState({},'',location.pathname);show('home');$('connection').textContent='Desconectado';$('connection').classList.remove('online');
 const profile=getProfile();$('name').value=profile.name||'';$('homeBalance').textContent=Number(profile.balance??20).toFixed(2);toast('Saliste de la sala');
}
$('create').onclick=async()=>{try{const name=$('name').value.trim();if(!name)return toast('Escribe tu nombre');$('create').disabled=true;$('create').textContent='Creando sala…';const profile=saveProfile();await enter(await api('/api/create',{name,startingBalance:profile.balance}))}catch(e){toast(e.message)}finally{$('create').disabled=false;$('create').textContent='Crear una sala nueva'}};
$('join').onclick=async()=>{try{const name=$('name').value.trim(),code=$('joinCode').value.trim().toUpperCase();if(!name)return toast('Escribe tu nombre');if(!code)return toast('Escribe el código');$('join').disabled=true;$('join').textContent='Conectando…';const saved=JSON.parse(localStorage.getItem('iprGamerSession')||'null');const token=saved?.room===code?saved.sessionToken:null;const profile=saveProfile();await enter(await api('/api/join',{name,code,sessionToken:token,startingBalance:profile.balance}))}catch(e){toast(e.message)}finally{$('join').disabled=false;$('join').textContent='Unirse a la sala'}};
$('chooseCards').onclick=openCards;$('closeCards').onclick=closeCards;$('cardsModal').onclick=e=>{if(e.target===$('cardsModal'))closeCards()};
const confirmSelectedCards=async e=>{e?.preventDefault?.();const btn=$('confirmCards');try{if(selected.size<2)return toast('Elige mínimo 2 cartillas');btn.disabled=true;btn.textContent='Confirmando…';await api('/api/action',{code:room,playerId,type:'chooseCards',cardIds:[...selected]});closeCards();toast('Cartillas confirmadas')}catch(err){toast(err.message)}finally{btn.disabled=false;btn.textContent='Confirmar cartillas'}};$('confirmCards').addEventListener('click',confirmSelectedCards,{passive:false});$('confirmCards').addEventListener('touchend',e=>{e.preventDefault();confirmSelectedCards(e)},{passive:false});
$('backLobby').onclick=async()=>{try{await api('/api/action',{code:room,playerId,type:'setView',inGameView:false})}catch(e){toast(e.message)}};
$('start').onclick=startGame;$('startFromGame').onclick=startGame;const prepareNext=async()=>{try{await api('/api/action',{code:room,playerId,type:'reset'});toast('Siguiente juego preparado: conserva tus cartillas o cámbialas')}catch(e){toast(e.message)}};$('nextLobby').onclick=prepareNext;$('toggleAuto').onclick=()=>api('/api/action',{code:room,playerId,type:'auto'}).catch(e=>toast(e.message));$('drawNow').onclick=()=>api('/api/action',{code:room,playerId,type:'draw'}).catch(e=>toast(e.message));$('next').onclick=prepareNext;
function invitationText(){return `🎮 Te invito a jugar Bingo en IPR GAMER\n\n🏠 Sala: ${room}\n👇 Abre este enlace, escribe tu nombre y entra directamente:\n${inviteUrl()}`}
$('copyInvite').onclick=async()=>{try{if(navigator.share){await navigator.share({title:'IPR GAMER Bingo',text:invitationText()});toast('Invitación compartida')}else{await navigator.clipboard.writeText(invitationText());toast('Invitación copiada')}}catch(e){if(e?.name!=='AbortError')toast('No se pudo compartir')}};
$('shareWhatsApp').onclick=()=>{const url=`https://wa.me/?text=${encodeURIComponent(invitationText())}`;window.open(url,'_blank','noopener,noreferrer')};
$('copyCode').onclick=async()=>{await navigator.clipboard.writeText(room);toast('Código copiado')};
$('sendLobby').onclick=()=>sendChat($('chatInputLobby')).catch(e=>toast(e.message));$('sendGame').onclick=()=>sendChat($('chatInputGame')).catch(e=>toast(e.message));$('chatInputLobby').onkeydown=e=>{if(e.key==='Enter')$('sendLobby').click()};$('chatInputGame').onkeydown=e=>{if(e.key==='Enter')$('sendGame').click()};document.querySelectorAll('[data-emoji]').forEach(b=>b.onclick=()=>api('/api/action',{code:room,playerId,type:'reaction',emoji:b.dataset.emoji}).catch(e=>toast(e.message)));
$('leaveLobby').onclick=leaveRoomCompletely;$('leaveGame').onclick=()=>returnToRoomLobby('¿Abandonar esta partida y volver al lobby de la sala?');$('leaveResult').onclick=()=>returnToRoomLobby('¿Volver al lobby de la sala?');

function openAdminModal(fromRoom=false){$('adminModal').classList.add('show');$('adminModal').setAttribute('aria-hidden','false');document.body.style.overflow='hidden';if(fromRoom&&room){$('creditRoom').value=room;$('creditContext').textContent=`Sala actual: ${room}. Ingresa la clave y pulsa Ingresar / Actualizar.`}else{$('creditContext').textContent='Panel general. Para recargar a jugadores de una sala, también puedes abrirlo desde el lobby como anfitrión.'}setTimeout(()=>$('adminKey').focus(),80)}
function closeAdminModal(){$('adminModal').classList.remove('show');$('adminModal').setAttribute('aria-hidden','true');document.body.style.overflow=''}
let adminAccounts=[];
function renderAdminAccounts(data){
 adminAccounts=data.playerAccounts||[];
 const roomFilter=$('creditRoom').value.trim().toUpperCase();
 const filtered=roomFilter?adminAccounts.filter(p=>p.room===roomFilter):adminAccounts;
 $('creditPlayer').innerHTML='<option value="">Selecciona un jugador</option>'+filtered.map(p=>`<option value="${p.id}" data-room="${p.room}">${escapeHtml(p.name)} · ${p.room} · ${Number(p.balance).toFixed(2)}</option>`).join('');
 $('creditPlayers').innerHTML=filtered.length?filtered.map(p=>`<div class="credit-player-row"><div><b>${p.host?'👑 ':''}${escapeHtml(p.name)}</b><small>Sala ${p.room} · ${p.online?'Conectado':'Desconectado'}</small></div><strong>${Number(p.balance).toFixed(2)} créditos</strong></div>`).join(''):'<div class="notice">No hay jugadores en esa sala.</div>';
}
async function loadAdmin(){try{const key=$('adminKey').value.trim();if(!key)return toast('Escribe la clave');const data=await api('/api/admin',{key},0);$('adminRooms').textContent=data.activeRooms||0;$('adminPlayers').textContent=data.players||0;$('adminConnected').textContent=data.connected||0;$('adminGames').textContent=data.gamesStarted||0;$('adminEntries').textContent=Number(data.entryIncome||0).toFixed(2);$('adminCards').textContent=Number(data.cardIncome||0).toFixed(2);$('adminPrizes').textContent=Number(data.prizesPaid||0).toFixed(2);$('adminNet').textContent=Number(data.net||0).toFixed(2);$('adminHistory').innerHTML=(data.history||[]).length?(data.history||[]).map(m=>`<div class="history-row"><div><b>${escapeHtml(m.type)}</b><small>${escapeHtml(m.detail||'')} · ${formatDate(m.time)}</small></div><strong class="${Number(m.amount)>=0?'gain':'expense'}">${Number(m.amount)>=0?'+':''}${Number(m.amount).toFixed(2)}</strong></div>`).join(''):'<div class="notice">Aún no hay movimientos.</div>';renderAdminAccounts(data);$('adminContent').classList.remove('hidden');toast('Panel actualizado')}catch(e){toast(e.message)}}
async function adjustCredits(action){
 try{
  const key=$('adminKey').value.trim(),playerId=$('creditPlayer').value;
  const option=$('creditPlayer').selectedOptions[0],roomCode=(option?.dataset.room||$('creditRoom').value).trim().toUpperCase();
  if(!key)return toast('Escribe la clave de administrador');
  if(!roomCode)return toast('Escribe o selecciona una sala');
  if(!playerId)return toast('Selecciona un jugador');
  const amount=Number($('creditAmount').value||0);
  if(action!=='reset'&&amount<=0)return toast('Ingresa un monto válido');
  const data=await api('/api/admin/credits',{key,room:roomCode,playerId,action,amount},0);
  toast(`${data.player.name}: saldo ${Number(data.player.balance).toFixed(2)} créditos`);
  await loadAdmin();
 }catch(e){toast(e.message)}
}
$('openAdmin').onclick=()=>openAdminModal(false);$('openRoomAdmin').onclick=()=>openAdminModal(true);$('closeAdmin').onclick=closeAdminModal;$('loadAdmin').onclick=loadAdmin;$('creditRoom').oninput=()=>renderAdminAccounts({playerAccounts:adminAccounts});$('creditPlayer').onchange=()=>{const o=$('creditPlayer').selectedOptions[0];if(o?.dataset.room)$('creditRoom').value=o.dataset.room};$('addCredits').onclick=()=>adjustCredits('add');$('removeCredits').onclick=()=>adjustCredits('remove');$('resetCredits').onclick=()=>adjustCredits('reset');$('adminKey').onkeydown=e=>{if(e.key==='Enter')loadAdmin()};$('adminModal').onclick=e=>{if(e.target===$('adminModal'))closeAdminModal()};
$('soundToggle').onclick=async()=>{soundEnabled=!soundEnabled;localStorage.setItem('iprSound',soundEnabled?'on':'off');updateSoundButton();await AudioEngine.unlock();AudioEngine.apply();if(soundEnabled)tone(880,.14,'sine',.08);else speechSynthesis?.cancel?.();toast(soundEnabled?'Audio activado':'Audio desactivado')};updateSoundButton();
function openAudioModal(){AudioEngine.unlock();$('audioModal').classList.add('show');$('audioModal').setAttribute('aria-hidden','false');document.body.style.overflow='hidden';$('musicEnabled').checked=!!audioPrefs.music;$('effectsEnabled').checked=!!audioPrefs.effects;$('voiceEnabled').checked=!!audioPrefs.voice;$('musicVolume').value=Math.round(audioPrefs.musicVolume*100);$('effectsVolume').value=Math.round(audioPrefs.effectsVolume*100);$('musicValue').textContent=Math.round(audioPrefs.musicVolume*100)+'%';$('effectsValue').textContent=Math.round(audioPrefs.effectsVolume*100)+'%'}
function closeAudioModal(){$('audioModal').classList.remove('show');$('audioModal').setAttribute('aria-hidden','true');document.body.style.overflow=''}
$('audioSettings').onclick=openAudioModal;$('closeAudio').onclick=closeAudioModal;$('audioModal').onclick=e=>{if(e.target===$('audioModal'))closeAudioModal()};
$('musicEnabled').onchange=e=>{audioPrefs.music=e.target.checked;saveAudioPrefs()};$('effectsEnabled').onchange=e=>{audioPrefs.effects=e.target.checked;saveAudioPrefs();tone(760,.12,'triangle',.08)};$('voiceEnabled').onchange=e=>{audioPrefs.voice=e.target.checked;saveAudioPrefs();if(e.target.checked)speak('Locutor activado')};
$('musicVolume').oninput=e=>{audioPrefs.musicVolume=Number(e.target.value)/100;$('musicValue').textContent=e.target.value+'%';saveAudioPrefs()};$('effectsVolume').oninput=e=>{audioPrefs.effectsVolume=Number(e.target.value)/100;$('effectsValue').textContent=e.target.value+'%';saveAudioPrefs()};
$('previewMusic').onclick=async()=>{soundEnabled=true;audioPrefs.music=true;if(audioPrefs.musicVolume<.30)audioPrefs.musicVolume=.35;localStorage.setItem('iprSound','on');$('musicEnabled').checked=true;$('musicVolume').value=Math.round(audioPrefs.musicVolume*100);$('musicValue').textContent=Math.round(audioPrefs.musicVolume*100)+'%';updateSoundButton();saveAudioPrefs();const ok=await AudioEngine.unlock();syncMusicForView();toast(ok?'Música ambiental activada':'El navegador bloqueó el audio: toca nuevamente Probar ambiente')};$('previewWin').onclick=()=>{soundEnabled=true;audioPrefs.effects=true;localStorage.setItem('iprSound','on');$('effectsEnabled').checked=true;updateSoundButton();saveAudioPrefs();winSound()};
AudioEngine.apply();
$('joinCode').addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5)});
let entryMode='create';
window.addEventListener('beforeunload',e=>{stopNarration(false);if(room){e.preventDefault();e.returnValue=''}});
(async()=>{
 const profile=getProfile();
 $('homeBalance').textContent=Number(profile.balance??20).toFixed(2);
 if(profile.name)$('name').value=profile.name;
 const params=new URLSearchParams(location.search);
 const invitedRaw=params.get('sala')||params.get('room')||params.get('codigo')||'';
 const invited=invitedRaw.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);
 const saved=JSON.parse(localStorage.getItem('iprGamerSession')||'null');
 show('home');
 if(invited){
  if(saved?.room&&saved.room!==invited)clearSession();
  selectEntryMode('join');
  $('joinCode').value=invited;
  $('entrySection')?.classList.add('open');
  setWizardStep(2);
  // Conserva el nombre guardado para que el invitado solo confirme y entre.
  $('name').value=profile.name||'';
  setTimeout(()=>{
   $('entrySection')?.scrollIntoView({behavior:'smooth',block:'start'});
   (profile.name?$('wizardContinue2'):$('name'))?.focus();
  },180);
  return;
 }
 if(saved?.name)$('name').value=saved.name;
 if(saved?.room&&saved?.sessionToken){try{await enter(await api('/api/resume',{code:saved.room,sessionToken:saved.sessionToken},0));return}catch{clearSession()}}
})();
// Portada y flujo guiado v6.0
window.addEventListener('load',()=>setTimeout(()=>$('splash')?.classList.add('hide'),1250));

function setWizardStep(step){
  [1,2,3].forEach(n=>{
    $('wizardStep'+n)?.classList.toggle('active',n===step);
    const dot=document.querySelector(`[data-step-dot="${n}"]`);
    dot?.classList.toggle('active',n===step);dot?.classList.toggle('done',n<step);
  });
  const titles={1:'¿Qué deseas hacer?',2:entryMode==='create'?'¿Quién está creando la sala?':'Ingresa tus datos',3:'Todo listo para entrar'};
  if($('wizardTitle'))$('wizardTitle').textContent=titles[step];
  setTimeout(()=>{if(step===2)$('name')?.focus()},120);
}
function selectEntryMode(mode){
 entryMode=mode==='join'?'join':'create';
 const createMode=entryMode==='create';
 $('tabCreate')?.classList.toggle('active',createMode);$('tabJoin')?.classList.toggle('active',!createMode);
 $('createPane')?.classList.toggle('active',createMode);$('joinPane')?.classList.toggle('active',!createMode);
 $('joinCodeWrap')?.classList.toggle('hidden',createMode);
 if($('summaryIcon'))$('summaryIcon').textContent=createMode?'🎮':'👥';
 if($('summaryAction'))$('summaryAction').textContent=createMode?'Crear una sala nueva':'Unirme a la sala '+($('joinCode')?.value||'');
 if($('summaryDetail'))$('summaryDetail').textContent=createMode?'Como anfitrión podrás compartir el código con los jugadores.':`Entrarás como ${$('name')?.value.trim()||'jugador'} usando el código indicado.`;
}
const openEntry=(mode='create')=>{
 selectEntryMode(mode);$('entrySection')?.classList.add('open');setWizardStep(1);
 setTimeout(()=>$('entrySection')?.scrollIntoView({behavior:'smooth',block:'start'}),80);
};
$('tabCreate')?.addEventListener('click',()=>selectEntryMode('create'));
$('tabJoin')?.addEventListener('click',()=>selectEntryMode('join'));
$('wizardContinue1')?.addEventListener('click',()=>setWizardStep(2));
$('wizardBack1')?.addEventListener('click',()=>setWizardStep(1));
$('wizardBack2')?.addEventListener('click',()=>setWizardStep(2));
$('wizardContinue2')?.addEventListener('click',()=>{
 const name=$('name')?.value.trim();if(!name)return toast('Escribe tu nombre o apodo');
 if(entryMode==='join'&&!$('joinCode')?.value.trim())return toast('Escribe el código de sala');
 selectEntryMode(entryMode);setWizardStep(3);
});
$('heroPlay')?.addEventListener('click',()=>openEntry('create'));
$('heroJoin')?.addEventListener('click',()=>openEntry('join'));
$('heroSound')?.addEventListener('click',()=>$('soundToggle')?.click());


// PWA instalable v6.1
let deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;$('installApp')?.classList.remove('hidden')});
$('installApp')?.addEventListener('click',async()=>{if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;$('installApp').classList.add('hidden')}else{toast(/iphone|ipad|ipod/i.test(navigator.userAgent)?'En iPhone: Compartir → Agregar a pantalla de inicio':'Usa el menú del navegador → Instalar aplicación')}});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
setInterval(()=>{if(state?.phase==='lobby'&&$('selectionTimer')){const remain=Math.max(0,Math.ceil((Number(state.selectionEndsAt||0)-Date.now())/1000));$('selectionTimer').textContent=`${String(Math.floor(remain/60)).padStart(2,'0')}:${String(remain%60).padStart(2,'0')}`}},1000);
