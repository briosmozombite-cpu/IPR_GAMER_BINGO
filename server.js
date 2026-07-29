const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, 'public');
const rooms = new Map();
const ADMIN_KEY = process.env.ADMIN_KEY || 'IPR2026';
const appTotals = {entryIncome:0,cardIncome:0,prizesPaid:0,gamesStarted:0,history:[],winners:[]};

const money = n => Number(Number(n || 0).toFixed(2));
const sendJson = (res, status, data) => {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
};
const readBody = req => new Promise((resolve,reject)=>{
  let data='';
  req.on('data',chunk=>{ data+=chunk; if(data.length>1e6) req.destroy(); });
  req.on('end',()=>{ try{ resolve(data ? JSON.parse(data) : {}); }catch(err){ reject(err); } });
  req.on('error',reject);
});
const roomCode = () => {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code='';
  do { code=Array.from({length:5},()=>chars[Math.floor(Math.random()*chars.length)]).join(''); } while(rooms.has(code));
  return code;
};
const movement=(type,amount,detail)=>({id:crypto.randomUUID(),type,amount:money(amount),detail,time:Date.now()});

function card(id){
  let seed=(id*2654435761)>>>0;
  const rnd=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296};
  const out=[];
  for(let c=0;c<5;c++){
    const nums=[];
    while(nums.length<5){const n=1+c*15+Math.floor(rnd()*15);if(!nums.includes(n))nums.push(n)}
    nums.sort((a,b)=>a-b);
    for(let r=0;r<5;r++)out[r*5+c]={value:(r===2&&c===2)?'★':nums[r],free:r===2&&c===2};
  }
  return out;
}
function lines(){
  const list=[];
  for(let r=0;r<5;r++)list.push([0,1,2,3,4].map(c=>r*5+c));
  for(let c=0;c<5;c++)list.push([0,1,2,3,4].map(r=>r*5+c));
  list.push([0,6,12,18,24],[4,8,12,16,20]);
  return list;
}
const validBingo=(ids,drawn)=>ids.some(id=>{const c=card(Number(id));return lines().some(line=>line.every(i=>c[i].free||drawn.includes(c[i].value)))});
const validApagon=(ids,drawn)=>ids.some(id=>card(Number(id)).every(cell=>cell.free||drawn.includes(cell.value)));
const isApagon=room=>room.state.gameInCycle===10;
const eligiblePlayers=room=>room.state.players.filter(p=>!isApagon(room)||p.apagonQualified);
function recalc(room){const f=room.state.appFinance;f.net=money(f.entryIncome+f.cardIncome-f.prizesPaid)}
function addPlayerMove(p,type,amount,detail){p.history.unshift(movement(type,amount,detail));p.history=p.history.slice(0,100)}
function addAppMove(room,type,amount,detail){
  const item=movement(type,amount,detail);
  room.state.appFinance.history.unshift(item);room.state.appFinance.history=room.state.appFinance.history.slice(0,200);
  appTotals.history.unshift(item);appTotals.history=appTotals.history.slice(0,500);
}
function adminSnapshot(){
  const allPlayers=[...rooms.values()].flatMap(r=>r.state.players);
  const players=allPlayers.length;
  const connected=allPlayers.filter(p=>p.online).length;
  const ranking=allPlayers.map(p=>({name:p.name,wins:p.stats.wins||0,won:money(p.stats.won||0),games:p.stats.games||0})).sort((a,b)=>b.wins-a.wins||b.won-a.won).slice(0,20);
  const playerAccounts=[...rooms.values()].flatMap(room=>room.state.players.map(p=>({
    id:p.id,room:room.state.code,name:p.name,balance:money(p.balance),online:Boolean(p.online),host:Boolean(p.host)
  }))).sort((a,b)=>a.room.localeCompare(b.room)||a.name.localeCompare(b.name));
  return {...appTotals,ranking,playerAccounts,net:money(appTotals.entryIncome+appTotals.cardIncome-appTotals.prizesPaid),activeRooms:rooms.size,players,connected,generatedAt:Date.now()};
}
function chargeEntry(room,p){
  p.balance=money(p.balance-0.20);p.stats.spent=money(p.stats.spent+0.20);
  addPlayerMove(p,'Inscripción de 10 juegos',-0.20,`Sala ${room.state.code}`);
  room.state.appFinance.entryIncome=money(room.state.appFinance.entryIncome+0.20);appTotals.entryIncome=money(appTotals.entryIncome+0.20);
  addAppMove(room,'Inscripción',0.20,`${p.name} · Sala ${room.state.code}`);recalc(room);
}
function newPlayer(name,host,startingBalance=20){
  const safeBalance=Math.max(0,Math.min(100000,money(startingBalance||20)));
  return {id:crypto.randomUUID(),sessionToken:crypto.randomUUID(),name:String(name||'Jugador').trim().slice(0,24),host,online:true,lastSeen:Date.now(),ready:false,inGameView:false,cardIds:[],balance:safeBalance,cardCreditsPaid:0,apagonQualified:true,qualifyingGames:0,disqualificationReason:'',history:[],stats:{games:0,wins:0,apagones:0,spent:0,won:0}};
}
function publicState(room,viewerId){
  const taken={};for(const p of room.state.players)for(const id of p.cardIds||[])taken[id]=p.id;
  const viewer=room.state.players.find(p=>p.id===viewerId);
  const ranking=room.state.players.map(p=>({id:p.id,name:p.name,wins:p.stats.wins||0,won:money(p.stats.won||0),games:p.stats.games||0})).sort((a,b)=>b.wins-a.wins||b.won-a.won||a.name.localeCompare(b.name));
  return {...room.state,players:room.state.players.map(({sessionToken,history,stats,...p})=>p),takenCards:taken,myHistory:viewer?.history||[],myStats:viewer?.stats||{},ranking,lastWinners:room.state.lastWinners||[],appFinance:viewer?.host?room.state.appFinance:null};
}
function emitOne(res,event,data){try{res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)}catch{}}
function broadcast(room){for(const [id,res] of room.clients)emitOne(res,'state',publicState(room,id))}
function emit(room,event,data){for(const res of room.clients.values())emitOne(res,event,data)}
function clearTimers(room){clearInterval(room.timer);clearTimeout(room.countdownTimer);room.timer=null;room.countdownTimer=null}
function award(room,p,automatic=true){
  if(room.state.rewardApplied)return false;
  const apagon=isApagon(room),prize=apagon?money(room.state.apagonJackpot+room.state.gamePot):money(room.state.gamePot);
  clearTimers(room);room.state.phase='finished';room.state.winner=p.name;room.state.winnerId=p.id;room.state.auto=false;room.state.rewardApplied=true;
  p.balance=money(p.balance+prize);p.stats.wins++;p.stats.won=money(p.stats.won+prize);if(apagon)p.stats.apagones++;
  addPlayerMove(p,apagon?'Premio APAGÓN':'Premio de bingo',prize,`Sala ${room.state.code} · Juego ${room.state.gameInCycle}`);
  room.state.appFinance.prizesPaid=money(room.state.appFinance.prizesPaid+prize);appTotals.prizesPaid=money(appTotals.prizesPaid+prize);addAppMove(room,'Premio pagado',-prize,p.name);recalc(room);
  const winItem={id:crypto.randomUUID(),name:p.name,prize,apagon,game:room.state.gameInCycle,time:Date.now()};
  room.state.lastWinners.unshift(winItem);room.state.lastWinners=room.state.lastWinners.slice(0,10);appTotals.winners.unshift({...winItem,room:room.state.code});appTotals.winners=appTotals.winners.slice(0,50);
  room.state.chat.push({id:crypto.randomUUID(),kind:'system',name:'Sistema',text:apagon?`🔥 ${p.name} ganó el APAGÓN: ${prize.toFixed(2)} créditos`:`🏆 ${p.name} hizo BINGO y ganó ${prize.toFixed(2)} créditos`,time:Date.now()});
  broadcast(room);emit(room,'celebration',{name:p.name,prize,apagon,automatic});return true;
}
function checkWinner(room){
  for(const p of eligiblePlayers(room)){
    const ok=isApagon(room)?validApagon(p.cardIds,room.state.drawn):validBingo(p.cardIds,room.state.drawn);
    if(p.cardIds.length&&ok)return award(room,p,true);
  }
  return false;
}
function draw(room){
  if(room.state.phase!=='playing')return;
  const available=[];for(let n=1;n<=75;n++)if(!room.state.drawn.includes(n))available.push(n);
  if(!available.length)return;
  const n=available[Math.floor(Math.random()*available.length)];room.state.current=n;room.state.drawn.push(n);room.state.lastDrawAt=Date.now();
  if(!checkWinner(room))broadcast(room);
}
function setAuto(room){
  clearInterval(room.timer);room.timer=null;
  if(room.state.auto&&room.state.phase==='playing')room.timer=setInterval(()=>draw(room),Math.max(4,room.state.speed)*1000);
}
function beginCountdown(room){
  clearTimers(room);
  room.state.phase='countdown';room.state.countdownEndsAt=Date.now()+4000;room.state.drawn=[];room.state.current=null;room.state.winner=null;room.state.winnerId=null;room.state.rewardApplied=false;room.state.auto=false;
  for(const p of room.state.players)p.stats.games++;appTotals.gamesStarted++;
  broadcast(room);
  room.countdownTimer=setTimeout(()=>{
    if(room.state.phase!=='countdown')return;
    room.state.phase='playing';room.state.countdownEndsAt=null;room.state.auto=true;broadcast(room);draw(room);setAuto(room);
  },4000);
}


function cleanupRoom(room){
  const now=Date.now();
  for(const p of room.state.players){
    if(p.online) p.lastSeen=now;
  }
  if(room.state.phase==='lobby'){
    const expired=now>Number(room.state.selectionEndsAt||0);
    const removed=[];
    room.state.players=room.state.players.filter(p=>{
      if(p.host)return true;
      const inactive=!p.online&&now-Number(p.lastSeen||0)>120000;
      const noCards=expired&&!p.ready;
      if(inactive||noCards){removed.push(p.name);room.clients.get(p.id)?.end();room.clients.delete(p.id);return false}
      return true;
    });
    if(removed.length)room.state.chat.push({id:crypto.randomUUID(),kind:'system',name:'Sistema',text:`Se retiró por inactividad: ${removed.join(', ')}`,time:Date.now()});
  }
  if(!room.state.players.length){clearTimers(room);clearInterval(room.cleanupTimer);rooms.delete(room.state.code);return}
  if(!room.state.players.some(p=>p.host)){room.state.players[0].host=true;room.hostId=room.state.players[0].id}
  broadcast(room);
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host}`);
  try{
    if(req.method==='GET'&&url.pathname==='/health')return sendJson(res,200,{ok:true,service:'IPR GAMER Bingo',version:'6.2.0',rooms:rooms.size,uptime:Math.floor(process.uptime())});
    if(req.method==='POST'&&url.pathname==='/api/admin'){
      const b=await readBody(req);if(String(b.key||'')!==ADMIN_KEY)return sendJson(res,403,{error:'Clave de administrador incorrecta'});
      return sendJson(res,200,adminSnapshot());
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/credits'){
      const b=await readBody(req);if(String(b.key||'')!==ADMIN_KEY)return sendJson(res,403,{error:'Clave de administrador incorrecta'});
      const code=String(b.room||'').toUpperCase().trim(),room=rooms.get(code);
      if(!room)return sendJson(res,404,{error:'Sala no encontrada'});
      const p=room.state.players.find(x=>x.id===String(b.playerId||''));
      if(!p)return sendJson(res,404,{error:'Jugador no encontrado'});
      const action=String(b.action||'add');
      const before=money(p.balance);
      let delta=0;
      if(action==='reset'){
        const target=50;delta=money(target-before);p.balance=target;
      }else{
        const amount=money(Math.abs(Number(b.amount||0)));
        if(!Number.isFinite(amount)||amount<=0)return sendJson(res,400,{error:'Ingresa un monto válido'});
        delta=action==='remove'?-amount:amount;
        p.balance=money(Math.max(0,p.balance+delta));delta=money(p.balance-before);
      }
      const label=action==='reset'?'Reinicio de saldo de prueba':delta>=0?'Recarga administrativa':'Ajuste administrativo';
      addPlayerMove(p,label,delta,`Panel administrador · Sala ${code}`);
      addAppMove(room,label,0,`${p.name}: ${before.toFixed(2)} → ${p.balance.toFixed(2)} créditos`);
      broadcast(room);
      return sendJson(res,200,{ok:true,player:{id:p.id,room:code,name:p.name,balance:money(p.balance)},snapshot:adminSnapshot()});
    }
    if(req.method==='POST'&&url.pathname==='/api/create'){
      const b=await readBody(req),name=String(b.name||'').trim();if(!name)return sendJson(res,400,{error:'Escribe tu nombre'});
      const code=roomCode(),p=newPlayer(name,true,b.startingBalance);
      const room={hostId:p.id,clients:new Map(),timer:null,countdownTimer:null,cleanupTimer:null,state:{code,phase:'lobby',round:1,cycle:1,gameInCycle:1,apagonJackpot:0,gamePot:0,platformRate:0.20,minCardsForApagon:2,selectionEndsAt:Date.now()+90000,drawn:[],current:null,lastDrawAt:null,countdownEndsAt:null,winner:null,winnerId:null,rewardApplied:false,auto:false,speed:6,players:[p],chat:[],lastWinners:[],appFinance:{entryIncome:0,cardIncome:0,prizesPaid:0,net:0,history:[]}}};
      chargeEntry(room,p);room.cleanupTimer=setInterval(()=>cleanupRoom(room),30000);rooms.set(code,room);return sendJson(res,200,{code,playerId:p.id,sessionToken:p.sessionToken,state:publicState(room,p.id)});
    }
    if(req.method==='POST'&&url.pathname==='/api/join'){
      const b=await readBody(req),code=String(b.code||'').toUpperCase().trim(),room=rooms.get(code),name=String(b.name||'').trim();
      if(!name)return sendJson(res,400,{error:'Escribe tu nombre'});if(!room)return sendJson(res,404,{error:'Sala no encontrada'});
      const saved=room.state.players.find(x=>x.sessionToken===b.sessionToken);if(saved){saved.online=true;saved.lastSeen=Date.now();broadcast(room);return sendJson(res,200,{code,playerId:saved.id,sessionToken:saved.sessionToken,state:publicState(room,saved.id)})}
      if(room.state.phase!=='lobby')return sendJson(res,409,{error:'La partida ya comenzó'});
      const p=newPlayer(name,false,b.startingBalance);room.state.players.push(p);chargeEntry(room,p);room.state.chat.push({id:crypto.randomUUID(),kind:'system',name:'Sistema',text:`${p.name} entró a la sala`,time:Date.now()});broadcast(room);
      return sendJson(res,200,{code,playerId:p.id,sessionToken:p.sessionToken,state:publicState(room,p.id)});
    }
    if(req.method==='POST'&&url.pathname==='/api/resume'){
      const b=await readBody(req),room=rooms.get(String(b.code||'').toUpperCase()),p=room?.state.players.find(x=>x.sessionToken===b.sessionToken);
      if(!room||!p)return sendJson(res,404,{error:'Partida no disponible'});p.online=true;p.lastSeen=Date.now();return sendJson(res,200,{code:room.state.code,playerId:p.id,sessionToken:p.sessionToken,state:publicState(room,p.id)});
    }
    if(req.method==='GET'&&url.pathname==='/api/events'){
      const code=String(url.searchParams.get('code')||'').toUpperCase(),id=String(url.searchParams.get('playerId')||''),room=rooms.get(code),p=room?.state.players.find(x=>x.id===id);
      if(!room||!p){res.writeHead(404);return res.end()}
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});room.clients.set(id,res);p.online=true;p.lastSeen=Date.now();emitOne(res,'state',publicState(room,id));broadcast(room);
      const ping=setInterval(()=>{try{res.write(':ping\n\n')}catch{}},20000);req.on('close',()=>{clearInterval(ping);room.clients.delete(id);p.online=false;p.lastSeen=Date.now();broadcast(room)});return;
    }
    if(req.method==='POST'&&url.pathname==='/api/action'){
      const b=await readBody(req),room=rooms.get(String(b.code||'').toUpperCase()),p=room?.state.players.find(x=>x.id===b.playerId);
      if(!room||!p)return sendJson(res,404,{error:'Jugador no válido'});p.lastSeen=Date.now();
      if(['start','draw','auto','reset','settings'].includes(b.type)&&!p.host)return sendJson(res,403,{error:'Solo el anfitrión puede hacer eso'});
      switch(b.type){
        case 'chooseCards':{
          if(room.state.phase==='finished')return sendJson(res,409,{error:'El anfitrión debe presionar Siguiente juego antes de elegir nuevas cartillas'});
          if(room.state.phase!=='lobby')return sendJson(res,409,{error:'La partida ya comenzó'});
          const ids=[...new Set((b.cardIds||[]).map(Number))].filter(x=>x>=1&&x<=100).slice(0,8);if(ids.length<2)return sendJson(res,400,{error:'Debes elegir mínimo 2 cartillas'});
          for(const other of room.state.players)if(other.id!==p.id&&ids.some(id=>other.cardIds.includes(id)))return sendJson(res,409,{error:'Una cartilla ya fue elegida'});
          const extra=Math.max(0,ids.length-p.cardCreditsPaid);if(p.balance<extra)return sendJson(res,409,{error:`Saldo insuficiente: necesitas ${extra} crédito(s)`});
          if(extra){p.balance=money(p.balance-extra);p.cardCreditsPaid+=extra;p.stats.spent=money(p.stats.spent+extra);addPlayerMove(p,'Compra de cartillas',-extra,`${extra} cartilla(s)`);const platform=money(extra*room.state.platformRate),jack=money(extra*0.10),pot=money(extra-platform-jack);room.state.gamePot=money(room.state.gamePot+pot);room.state.apagonJackpot=money(room.state.apagonJackpot+jack);room.state.appFinance.cardIncome=money(room.state.appFinance.cardIncome+platform);appTotals.cardIncome=money(appTotals.cardIncome+platform);addAppMove(room,'Comisión por cartillas',platform,p.name);recalc(room)}
          p.cardIds=ids;p.ready=true;p.inGameView=true;broadcast(room);break;
        }
        case 'setView':{const wantsGame=Boolean(b.inGameView);if(wantsGame&&(room.state.phase==='countdown'||room.state.phase==='playing')&&(!p.ready||p.cardIds.length<2))return sendJson(res,409,{error:'No tienes cartillas confirmadas para volver a esta partida'});p.inGameView=wantsGame;broadcast(room);break;}
        case 'start':{
          if(room.state.phase!=='lobby')return sendJson(res,409,{error:'El juego ya está iniciando'});
          const eligible=eligiblePlayers(room).filter(x=>x.online&&x.ready&&x.cardIds.length>=2);if(!eligible.length)return sendJson(res,409,{error:'Debe existir al menos un jugador con 2 cartillas confirmadas'});
          for(const x of room.state.players){x.inGameView=eligible.some(e=>e.id===x.id);if(!x.inGameView&&x.cardIds.length<2){x.ready=false;x.disqualificationReason='No confirmó cartillas a tiempo'}}
          beginCountdown(room);break;
        }
        case 'draw':draw(room);break;
        case 'auto':room.state.auto=!room.state.auto;broadcast(room);setAuto(room);break;
        case 'settings':room.state.speed=Math.max(4,Number(b.speed)||6);broadcast(room);setAuto(room);break;
        case 'reset':{
          if(room.state.phase!=='finished')return sendJson(res,409,{error:'El juego todavía no terminó'});
          if(!isApagon(room)){for(const x of room.state.players){if(x.cardIds.length>=2&&x.apagonQualified)x.qualifyingGames++;else{x.apagonQualified=false;x.disqualificationReason='Jugó menos de 2 cartillas'}}room.state.gameInCycle++;}
          else{room.state.cycle++;room.state.gameInCycle=1;room.state.apagonJackpot=0;for(const x of room.state.players){x.apagonQualified=true;x.qualifyingGames=0;x.disqualificationReason=''}}
          clearTimers(room);room.state.phase='lobby';room.state.round++;room.state.selectionEndsAt=Date.now()+90000;room.state.gamePot=0;room.state.drawn=[];room.state.current=null;room.state.countdownEndsAt=null;room.state.winner=null;room.state.winnerId=null;room.state.lastDrawAt=null;room.state.rewardApplied=false;room.state.auto=false;
          for(const x of room.state.players){/* Conserva las cartillas del juego anterior como selección inicial. */x.ready=false;x.inGameView=false;x.cardCreditsPaid=0}broadcast(room);break;
        }
        case 'chat':{const text=String(b.text||'').trim().slice(0,180);if(!text)return sendJson(res,400,{error:'Escribe un mensaje'});room.state.chat.push({id:crypto.randomUUID(),kind:'user',name:p.name,text,time:Date.now()});room.state.chat=room.state.chat.slice(-60);broadcast(room);break}
        case 'reaction':{const emoji=String(b.emoji||'👏').slice(0,8);room.state.chat.push({id:crypto.randomUUID(),kind:'reaction',name:p.name,text:emoji,time:Date.now()});room.state.chat=room.state.chat.slice(-60);broadcast(room);emit(room,'reaction',{name:p.name,emoji});break}
        case 'leaveToLobby':{
          // El jugador permanece conectado a la sala, conserva su nombre y saldo,
          // pero deja de participar en la partida actual y vuelve al lobby de la sala.
          p.inGameView=false;
          if(room.state.phase==='countdown'||room.state.phase==='playing'){
            room.state.chat.push({id:crypto.randomUUID(),kind:'system',name:'Sistema',text:`${p.name} volvió temporalmente al lobby`,time:Date.now()});
            room.state.chat=room.state.chat.slice(-60);
          }
          broadcast(room);break;
        }
        case 'abandon':{
          room.clients.get(p.id)?.end();room.clients.delete(p.id);room.state.players=room.state.players.filter(x=>x.id!==p.id);
          if(!room.state.players.length){clearTimers(room);clearInterval(room.cleanupTimer);rooms.delete(room.state.code);return sendJson(res,200,{ok:true,roomClosed:true,balance:p.balance,name:p.name})}
          if(p.host){room.state.players[0].host=true;room.hostId=room.state.players[0].id}broadcast(room);return sendJson(res,200,{ok:true,balance:p.balance,name:p.name});
        }
        default:return sendJson(res,400,{error:'Acción desconocida'});
      }
      return sendJson(res,200,{ok:true});
    }
  }catch(err){return sendJson(res,400,{error:err.message||'Error'})}

  let file=url.pathname==='/'?path.join(ROOT,'index.html'):path.join(ROOT,decodeURIComponent(url.pathname));
  if(!file.startsWith(ROOT)){res.writeHead(403);return res.end()}
  fs.stat(file,(err,st)=>{if(err||!st.isFile()){res.writeHead(404);return res.end('No encontrado')}const ext=path.extname(file);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res)});
});

server.listen(PORT,HOST,()=>{
  console.log(`\nIPR GAMER v6.1.0 FAMILIA activo en http://localhost:${PORT}`);
  for(const x of Object.values(os.networkInterfaces()).flat())if(x&&x.family==='IPv4'&&!x.internal)console.log(`Celulares: http://${x.address}:${PORT}`);
});
function shutdown(signal){console.log(`\n${signal}: cerrando IPR GAMER...`);for(const room of rooms.values()){clearTimers(room);clearInterval(room.cleanupTimer)}server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),5000).unref()}
process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));
